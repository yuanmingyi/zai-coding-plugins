#!/bin/bash
# Deploy Script - Language-agnostic Docker build orchestrator
# DO NOT MODIFY - This is an immutable resource file
#
# This script is copied into deploy-package/ by the deploy-arbitrary agent.
# It orchestrates the two-stage Docker build process on the deploy server.
#
# Required files in same directory:
#   - Dockerfile.build  (builds source with compilers/tools, outputs to /output)
#   - Dockerfile.run    (minimal runtime image, copies from ./build-output/)
#
# Environment variables:
#   - APP_NAME              App name from the deploy task (default: app).
#                           Docker image names are derived from this value and
#                           normalized to lowercase repository-safe names.
#   - TAG                   Image tag (default: latest)
#   - PORT                  Port for the app and smoke test (default: 9000)
#   - TEST_RUN              Set to 1 to run smoke test after build (default: 0)
#   - CC_DEPLOY_BUILD_ARCH  Target architecture: amd64|arm64 (default: amd64)
#   - CONTEXT_PATH          Platform-assigned URL prefix (default: "" = root).
#                           Forwarded as a docker build-arg so framework
#                           builds (Vite --base, Astro --base, Angular
#                           --base-href, NUXT_APP_BASE_URL, etc.) can bake
#                           the prefix into the SPA bundle. Zero user source
#                           modification — fixes the runtime-link-rewriting
#                           gap that nginx sub_filter cannot solve.

set -euo pipefail

APP_NAME="${APP_NAME:-app}"
TAG="${TAG:-latest}"
PORT="${PORT:-9000}"
ARCH="${CC_DEPLOY_BUILD_ARCH:-amd64}"
TCR_DOMAIN="${TCR_DOMAIN:-}"
TCR_NAMESPACE="${TCR_NAMESPACE:-}"
# Per-build identifier. CNB resolves `${DOCKER_IMAGE_NAME}:latest` to a digest and
# short-circuits the SCF function update when the digest looks unchanged.
# Two failure modes were observed in production:
#   1. Two deploys of the same source produce digest-identical images
#      (BuildKit cache + deterministic layers) → SCF keeps serving the
#      old image even when the embedded nginx config changed.
#   2. Operators have no traceable tag to roll back to.
# Fix: stamp every runtime image with a unique label (changes the manifest
# digest) AND push a companion `cc-deploy-<id>` tag alongside `:latest`.
DEPLOY_BUILD_ID="${DEPLOY_BUILD_ID:-$(date +%s)-${RANDOM:-0}}"

normalize_docker_image_name() {
    printf '%s' "$1" \
        | tr '[:upper:]' '[:lower:]' \
        | sed -e 's/[^a-z0-9][^a-z0-9]*/-/g' -e 's/^-*//' -e 's/-*$//'
}

DOCKER_IMAGE_NAME="$(normalize_docker_image_name "${APP_NAME}")"
DOCKER_IMAGE_NAME="${DOCKER_IMAGE_NAME:-app}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_OUTPUT_DIR="${SCRIPT_DIR}/build-output"

log_info() { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; }

cleanup() { docker rm -f "${DOCKER_IMAGE_NAME}-build-container" 2>/dev/null || true; }
trap cleanup EXIT

# Step 0.5: Verify CONTEXT_PATH propagation
log_info "CONTEXT_PATH=[${CONTEXT_PATH:-<unset>}]"
log_info "DOCKER_IMAGE_NAME=[${DOCKER_IMAGE_NAME}]"
log_info "Dockerfile.build contents:"
head -20 "${SCRIPT_DIR}/Dockerfile.build"

# Step 1: Build image
log_info "Building build image..."
docker build --platform "linux/${ARCH}" \
    --build-arg "TARGETARCH=${ARCH}" \
    --build-arg "CONTEXT_PATH=${CONTEXT_PATH:-}" \
    -f "${SCRIPT_DIR}/Dockerfile.build" -t "${DOCKER_IMAGE_NAME}-build" "${SCRIPT_DIR}" || {
    log_error "Build image creation failed"; exit 1
}

# Step 2: Extract outputs
log_info "Extracting build outputs..."
rm -rf "${BUILD_OUTPUT_DIR}" && mkdir -p "${BUILD_OUTPUT_DIR}"
docker run --rm --platform "linux/${ARCH}" \
    -v "${BUILD_OUTPUT_DIR}:/output-mount" "${DOCKER_IMAGE_NAME}-build" || {
    log_error "Build output extraction failed"; exit 1
}

[ -z "$(ls -A "${BUILD_OUTPUT_DIR}")" ] && { log_error "No build outputs found"; exit 1; }

# Step 2.1: Verify build output contains CONTEXT_PATH prefix (diagnostic)
if [ -n "${CONTEXT_PATH:-}" ]; then
    log_info "Verifying CONTEXT_PATH prefix in build output..."
    if [ -f "${BUILD_OUTPUT_DIR}/index.html" ]; then
        log_info "index.html head:"
        head -15 "${BUILD_OUTPUT_DIR}/index.html"
        if grep -q "${CONTEXT_PATH}" "${BUILD_OUTPUT_DIR}/index.html"; then
            log_info "OK: index.html contains CONTEXT_PATH prefix"
        else
            log_error "MISSING: index.html does NOT contain CONTEXT_PATH=[${CONTEXT_PATH}]"
        fi
    fi
fi

# Step 2.5: Stage runtime-only sidecar files (nginx config + entrypoint).
# Dockerfile.run COPYs these but Dockerfile.build CMDs for compiled runtimes
# (Go, Rust, Java) only copy the produced binary/jar to /output-mount, not the
# whole /build/ tree. Copy them into the runtime build context explicitly so
# every language ends up with the files Dockerfile.run expects.
for sidecar in nginx.conf.template entrypoint.sh nginx-access-control.sh nginx-static-context-path.envsh; do
    if [ -f "${SCRIPT_DIR}/${sidecar}" ]; then
        cp "${SCRIPT_DIR}/${sidecar}" "${BUILD_OUTPUT_DIR}/${sidecar}"
    else
        log_error "Missing required sidecar file: ${sidecar}"; exit 1
    fi
done
chmod +x "${BUILD_OUTPUT_DIR}/entrypoint.sh"
chmod +x "${BUILD_OUTPUT_DIR}/nginx-access-control.sh"
chmod +x "${BUILD_OUTPUT_DIR}/nginx-static-context-path.envsh"

# Step 3: Runtime image
log_info "Building runtime image (DEPLOY_BUILD_ID=${DEPLOY_BUILD_ID})..."
cp "${SCRIPT_DIR}/Dockerfile.run" "${BUILD_OUTPUT_DIR}/Dockerfile"
docker build --platform "linux/${ARCH}" \
    --label "com.cc-deploy.build-id=${DEPLOY_BUILD_ID}" \
    -f "${BUILD_OUTPUT_DIR}/Dockerfile" -t "${DOCKER_IMAGE_NAME}" "${BUILD_OUTPUT_DIR}" || {
    log_error "Runtime image creation failed"; exit 1
}

# Step 3.5: Smoke test (optional)
if [ "${TEST_RUN:-0}" = "1" ]; then
    log_info "Running smoke test on port ${PORT}..."
    TEST_CONTAINER="${DOCKER_IMAGE_NAME}-test-$(date +%s)"

    # Ensure cleanup of test container on failure
    trap 'docker rm -f "${TEST_CONTAINER}" 2>/dev/null || true; cleanup' EXIT

    # Run container in background, mapping the configured port
    docker run -d --name "${TEST_CONTAINER}" -p "${PORT}:${PORT}" -e "PORT=${PORT}" "${DOCKER_IMAGE_NAME}"

    # Wait for container to be ready (polling)
    MAX_RETRIES=10
    COUNT=0
    SUCCESS=0
    while [ $COUNT -lt $MAX_RETRIES ]; do
        sleep 2
        HTTP_CODE=$(curl -s -o /tmp/test_response.txt -w "%{http_code}" "http://localhost:${PORT}" || echo "000")
        if [ "$HTTP_CODE" = "200" ]; then
            SUCCESS=1
            break
        fi
        COUNT=$((COUNT + 1))
        log_info "Waiting for container to start... (attempt $COUNT/$MAX_RETRIES)"
    done

    if [ $SUCCESS -eq 1 ]; then
        log_info "Smoke test passed!"
        docker rm -f "${TEST_CONTAINER}" >/dev/null
        # Restore original cleanup trap
        trap cleanup EXIT
    else
        log_error "Smoke test failed with status ${HTTP_CODE}"
        if [ -f /tmp/test_response.txt ]; then
            log_error "Response body:"
            cat /tmp/test_response.txt
            echo ""
        fi
        log_error "Container logs:"
        docker logs "${TEST_CONTAINER}"
        docker rm -f "${TEST_CONTAINER}" >/dev/null
        exit 1
    fi
fi

# Step 4: Push (if tcrDomain and tcrNamespace set)
if [ -n "${TCR_DOMAIN}" ] && [ -n "${TCR_NAMESPACE}" ]; then
    FULL_IMAGE="${TCR_DOMAIN}/${TCR_NAMESPACE}/${DOCKER_IMAGE_NAME}:${TAG}"
    UNIQUE_IMAGE="${TCR_DOMAIN}/${TCR_NAMESPACE}/${DOCKER_IMAGE_NAME}:cc-deploy-${DEPLOY_BUILD_ID}"
    docker tag "${DOCKER_IMAGE_NAME}" "${FULL_IMAGE}"
    docker tag "${DOCKER_IMAGE_NAME}" "${UNIQUE_IMAGE}"

    # Login to registry (credentials set on deploy server)
    if [ -n "${TCR_DOMAIN:-}" ] && [ -n "${TCR_USERNAME:-}" ] && [ -n "${TCR_PASS:-}" ]; then
        log_info "Logging into registry..."
        docker login "${TCR_DOMAIN}" --username="${TCR_USERNAME}" --password="${TCR_PASS}" || {
            log_error "Registry login failed"; exit 1
        }
    fi

    docker push "${FULL_IMAGE}" || { log_error "Push failed"; exit 1; }
    log_info "Pushed: ${FULL_IMAGE}"
    docker push "${UNIQUE_IMAGE}" || { log_error "Push failed"; exit 1; }
    log_info "Pushed: ${UNIQUE_IMAGE}"
fi

log_info "Done! Run: docker run -p ${PORT}:${PORT} ${DOCKER_IMAGE_NAME}"
