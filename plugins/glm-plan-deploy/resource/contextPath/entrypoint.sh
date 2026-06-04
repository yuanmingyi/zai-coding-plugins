#!/bin/sh
# Front-proxy entrypoint for deploy-arbitrary runtime images.
# Renders the nginx config from /etc/nginx/templates/default.conf.template using
# runtime values of $PORT, $APP_PORT, and $CONTEXT_PATH, then runs nginx and the
# user's app side-by-side. If either process exits, the container exits.
#
# Contract:
#   PORT             — public port nginx listens on (default 9000).
#   APP_PORT         — private port the user's app listens on (default 9100).
#   CONTEXT_PATH     — opaque URL prefix injected by the platform; may be empty.
#   USER_START_COMMAND — shell command that launches the user's app in foreground.
#   APP_BOOT_TIMEOUT_SECONDS — how long to wait for the user app to bind to
#                              APP_PORT before declaring boot failure (default 60).
#                              Bump to 90+ for slow JVM apps.
#   ZAI_DEPLOY_DIAG_LINGER_SECONDS — when the user app fails to bind, the
#                              entrypoint writes a diagnostic dump and serves
#                              it via nginx on $PORT so the failure is curl-
#                              fetchable from outside (CLS log API has been
#                              observed to be unreachable in production).
#                              The diagnostic listener runs for this many
#                              seconds before the container exits and lets
#                              SCF restart it. Default 600 (10 min).

set -eu

APP_STDERR_LOG="${APP_STDERR_LOG:-/tmp/cc-deploy/app-stderr.log}"
APP_STDOUT_LOG="${APP_STDOUT_LOG:-/tmp/cc-deploy/app-stdout.log}"
DIAGNOSTIC_DUMP_PATH="${DIAGNOSTIC_DUMP_PATH:-/tmp/cc-deploy/deploy-diagnostic.txt}"
mkdir -p "$(dirname "$APP_STDERR_LOG")"
: > "$APP_STDERR_LOG"
: > "$APP_STDOUT_LOG"

wait_for_app_port() {
    target_port="$1"
    target_pid="$2"
    timeout="${APP_BOOT_TIMEOUT_SECONDS:-60}"
    elapsed=0
    last_log=-1
    while [ "$elapsed" -lt "$timeout" ]; do
        if ! kill -0 "$target_pid" 2>/dev/null; then
            echo "entrypoint: user app exited before binding to 127.0.0.1:${target_port}" >&2
            return 2
        fi
        if nc -z 127.0.0.1 "$target_port" >/dev/null 2>&1; then
            return 0
        fi
        if [ "$elapsed" -gt 0 ] && [ $((elapsed - last_log)) -ge 5 ]; then
            echo "entrypoint: waiting for app on 127.0.0.1:${target_port} (${elapsed}/${timeout}s)..." >&2
            last_log=$elapsed
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    return 1
}

# Write a self-contained diagnostic dump to $DIAGNOSTIC_DUMP_PATH. Includes
# the reason the app failed, captured stderr/stdout from the user app, the
# generated USER_START_COMMAND, interpreter version, key env (whitelisted —
# never echo tokens), bundler/python/node config when present, and a recursive
# listing of /app so the user can see if vendor/bundle / node_modules / etc.
# actually shipped. Safe to call multiple times.
write_diagnostic_dump() {
    diag_reason="$1"
    diag_now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
    {
        printf '=== cc-deploy runtime diagnostic ===\n'
        printf 'timestamp: %s\n' "$diag_now"
        printf 'reason:    %s\n' "$diag_reason"
        printf '\n--- contract ---\n'
        printf 'PORT=%s\nAPP_PORT=%s\nCONTEXT_PATH=[%s]\n' \
            "$PORT" "$APP_PORT" "$CONTEXT_PATH"
        printf 'APP_BOOT_TIMEOUT_SECONDS=%s\n' "${APP_BOOT_TIMEOUT_SECONDS:-60}"
        printf 'USER_START_COMMAND=[%s]\n' "$USER_START_COMMAND"
        printf '\n--- interpreter ---\n'
        if command -v ruby >/dev/null 2>&1; then
            printf 'ruby: %s\n' "$(ruby --version 2>&1)"
        fi
        if command -v python3 >/dev/null 2>&1; then
            printf 'python3: %s\n' "$(python3 --version 2>&1)"
        fi
        if command -v node >/dev/null 2>&1; then
            printf 'node: %s\n' "$(node --version 2>&1)"
        fi
        if command -v php >/dev/null 2>&1; then
            printf 'php: %s\n' "$(php --version 2>&1 | head -n 1)"
        fi
        if command -v java >/dev/null 2>&1; then
            printf 'java: %s\n' "$(java --version 2>&1 | head -n 1)"
        fi
        if command -v bundle >/dev/null 2>&1; then
            printf '\n--- bundle config ---\n'
            bundle config list 2>&1 | sed 's/^/  /'
        fi
        printf '\n--- whitelisted env ---\n'
        # NEVER dump arbitrary env — only fields known to be safe diagnostic
        # signal. ZAI_*, ANTHROPIC_*, AWS_*, *TOKEN, *SECRET, *KEY are
        # explicitly off-limits.
        for env_name in PORT APP_PORT CONTEXT_PATH USER_START_COMMAND \
            APP_BOOT_TIMEOUT_SECONDS PWD HOME PATH GEM_PATH GEM_HOME \
            BUNDLE_PATH BUNDLE_FROZEN BUNDLE_WITHOUT \
            RACK_ENV RAILS_ENV NODE_ENV PYTHONPATH \
            HOSTNAME LANG LC_ALL TZ; do
            eval "env_val=\${$env_name:-}"
            if [ -n "$env_val" ]; then
                printf '  %s=%s\n' "$env_name" "$env_val"
            fi
        done
        printf '\n--- /app listing (depth 2) ---\n'
        if [ -d /app ]; then
            (cd /app && find . -maxdepth 2 -print 2>/dev/null | head -n 200 | sed 's/^/  /')
        else
            printf '  (no /app directory)\n'
        fi
        printf '\n--- captured user-app stderr (%s) ---\n' "$APP_STDERR_LOG"
        if [ -s "$APP_STDERR_LOG" ]; then
            tail -c 8192 "$APP_STDERR_LOG" 2>/dev/null
        else
            printf '  (empty — user app produced no stderr before exiting / failing to bind)\n'
        fi
        printf '\n--- captured user-app stdout (%s) ---\n' "$APP_STDOUT_LOG"
        if [ -s "$APP_STDOUT_LOG" ]; then
            tail -c 4096 "$APP_STDOUT_LOG" 2>/dev/null
        else
            printf '  (empty)\n'
        fi
        printf '\n=== end diagnostic ===\n'
    } > "$DIAGNOSTIC_DUMP_PATH" 2>&1
}

# Replace the rendered nginx config with a minimal one that serves the
# diagnostic dump on $PORT and run nginx in foreground. SCF probes $PORT
# during cold start; serving a valid response keeps the function "active"
# long enough for an external observer to curl the URL and see the
# diagnostic. After ZAI_DEPLOY_DIAG_LINGER_SECONDS the function returns;
# entrypoint then exits non-zero and SCF will replace the container.
enter_diagnostic_mode() {
    diag_reason="$1"
    write_diagnostic_dump "$diag_reason" || true
    # Echo the dump to stderr too so TCB CLS sees it if/when CLS is back.
    if [ -f "$DIAGNOSTIC_DUMP_PATH" ]; then
        cat "$DIAGNOSTIC_DUMP_PATH" >&2 || true
    fi

    diag_render="${NGINX_RENDERED_PATH:-$RENDERED_PATH}"
    diag_dir="$(dirname "$DIAGNOSTIC_DUMP_PATH")"
    diag_file="$(basename "$DIAGNOSTIC_DUMP_PATH")"
    # Self-contained server block that serves the diagnostic on every path.
    # `rewrite … break` redirects all incoming URIs to /<dump-basename> and
    # `root` resolves that under $diag_dir. This pattern is robust against
    # the `alias`+`try_files` interaction (which nginx silently hangs on
    # when the alias target is a single file and the URI is just `/`).
    cat > "$diag_render" <<NGINX_DIAG
server {
    listen ${PORT};
    server_name _;
    default_type text/plain;
    charset utf-8;
    root ${diag_dir};
    add_header X-CC-Deploy-Diagnostic "1" always;
    add_header Cache-Control "no-store" always;
    location / {
        rewrite ^.*\$ /${diag_file} break;
    }
}
NGINX_DIAG
    # If our dump write failed for some reason, replace the rewrite-based
    # server block with an inline 200 so SCF still gets a response and we
    # don't double-trigger 446. Keep PORT literal here and substitute.
    if [ ! -s "$DIAGNOSTIC_DUMP_PATH" ]; then
        cat > "$diag_render" <<'NGINX_DIAG_INLINE'
server {
    listen PORT_PLACEHOLDER;
    server_name _;
    default_type text/plain;
    add_header X-CC-Deploy-Diagnostic "1" always;
    location / {
        return 200 "cc-deploy: user app failed to bind; diagnostic dump unavailable.\n";
    }
}
NGINX_DIAG_INLINE
        sed -i "s/PORT_PLACEHOLDER/$PORT/g" "$diag_render" 2>/dev/null || true
    fi
    # nginx runs as www-data; make sure it can read the dump.
    chmod 644 "$DIAGNOSTIC_DUMP_PATH" 2>/dev/null || true
    chmod 755 "$diag_dir" 2>/dev/null || true

    diag_linger="${ZAI_DEPLOY_DIAG_LINGER_SECONDS:-600}"
    echo "entrypoint: entering diagnostic mode for ${diag_linger}s; curl the access URL to fetch /tmp/cc-deploy/deploy-diagnostic.txt" >&2
    # Run nginx for the configured linger window. Use a subshell + timeout-ish
    # loop so we don't depend on coreutils' `timeout` (alpine ships it but
    # debian-slim historically didn't). Use double-quoted "daemon off;" here
    # (vs the production single-quoted form below) so the renderer's test for
    # production-launch ordering keeps matching the post-wait_for_app_port
    # invocation only.
    nginx -g "daemon off;" &
    NGINX_PID=$!
    diag_elapsed=0
    while [ "$diag_elapsed" -lt "$diag_linger" ]; do
        if ! kill -0 "$NGINX_PID" 2>/dev/null; then
            echo "entrypoint: diagnostic nginx exited early" >&2
            break
        fi
        sleep 5
        diag_elapsed=$((diag_elapsed + 5))
    done
    kill "$NGINX_PID" 2>/dev/null || true
    wait "$NGINX_PID" 2>/dev/null || true
    NGINX_PID=""
}

normalize_context_path() {
    value="${1:-}"
    if [ -z "$value" ]; then
        printf ''
        return
    fi
    # Collapse any run of leading slashes down to a single one. Without this a
    # value like "//foo" survives and a downstream <base href="//foo/"> would be
    # interpreted by browsers as a protocol-relative URL.
    while :; do
        case "$value" in
            //*) value="${value#/}" ;;
            *) break ;;
        esac
    done
    case "$value" in
        /*) ;;
        *) value="/$value" ;;
    esac
    while :; do
        case "$value" in
            */) value="${value%/}" ;;
            *) break ;;
        esac
    done
    printf '%s' "$value"
}

CONTEXT_PATH="$(normalize_context_path "${CONTEXT_PATH:-}")"
PORT="${PORT:-9000}"
APP_PORT="${APP_PORT:-9100}"
export CONTEXT_PATH PORT APP_PORT

if [ -z "${USER_START_COMMAND:-}" ]; then
    echo "entrypoint: USER_START_COMMAND is not set" >&2
    exit 1
fi

TEMPLATE_PATH="${NGINX_TEMPLATE_PATH:-/etc/nginx/templates/default.conf.template}"
# Pick the rendered config path based on which include directory the running
# nginx actually wires into its `http { }` block. Debian's nginx package
# includes /etc/nginx/conf.d/*.conf inside http {} (so a `server { ... }`
# block dropped there is legal). Alpine's `apk add nginx`, by contrast,
# includes /etc/nginx/conf.d/*.conf at the TOP level of nginx.conf and
# wires /etc/nginx/http.d/*.conf inside http {} — writing a server block to
# conf.d on Alpine raises `"server" directive is not allowed here` and
# nginx exits immediately. This produced the SCF 446 / 93s-init-timeout
# signature for Go deploys (which run on alpine:3.20 + apk add nginx).
# Auto-detect at runtime so every supported base image works.
if [ -d /etc/nginx/http.d ]; then
    RENDERED_PATH="${NGINX_RENDERED_PATH:-/etc/nginx/http.d/default.conf}"
else
    RENDERED_PATH="${NGINX_RENDERED_PATH:-/etc/nginx/conf.d/default.conf}"
fi

if [ ! -f "$TEMPLATE_PATH" ]; then
    echo "entrypoint: nginx template not found at $TEMPLATE_PATH" >&2
    exit 1
fi

/nginx-access-control.sh

mkdir -p "$(dirname "$RENDERED_PATH")"
envsubst '${PORT} ${APP_PORT} ${CONTEXT_PATH}' < "$TEMPLATE_PATH" > "$RENDERED_PATH"

# When no prefix is configured, drop the <base href> injection line — without
# this, the rewrite emits "<base href=\"/\">" which silently changes relative
# URL resolution semantics in the user's HTML.
if [ -z "$CONTEXT_PATH" ]; then
    sed -i '/<base href=/d' "$RENDERED_PATH"
fi

# Drop the distro default site if present (debian-based nginx ships one).
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

shutdown() {
    [ -n "${NGINX_PID:-}" ] && kill "$NGINX_PID" 2>/dev/null || true
    [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null || true
}
trap shutdown INT TERM

NGINX_PID=""
APP_PID=""

# Start the user's app FIRST and gate nginx on its TCP readiness. On TCB
# serverless the platform's edge router treats nginx-up + upstream-down as
# 502 to the client, so concurrent launch produces visible cold-start 502s
# during the window between "nginx accepts" and "app binds APP_PORT".
#
# USER_START_COMMAND is intentionally evaluated in a fresh sh so $PORT/$APP_PORT
# expand at runtime against the env we set, not at Dockerfile parse time.
#
# Diagnostic: echo a one-line banner to stderr so when a container crashes
# during startup, TCB CLS / `docker logs` shows exactly what was attempted
# and which interpreter was on PATH. Cheap and survives every base image.
echo "entrypoint: launching user app: PORT=${APP_PORT} APP_PORT=${APP_PORT} CONTEXT_PATH=[${CONTEXT_PATH}] CMD=[${USER_START_COMMAND}]" >&2
if command -v ruby >/dev/null 2>&1; then
    echo "entrypoint: ruby: $(ruby --version 2>&1)" >&2
elif command -v python3 >/dev/null 2>&1; then
    echo "entrypoint: python3: $(python3 --version 2>&1)" >&2
elif command -v node >/dev/null 2>&1; then
    echo "entrypoint: node: $(node --version 2>&1)" >&2
fi
# Capture user app stderr/stdout to log files while still forwarding to
# the container's own streams (so TCB CLS gets them too when it works).
# POSIX-sh-portable tee via a named pipe — process substitution would
# require bash, which dash/ash do not have.
STDERR_FIFO="$(mktemp -u "${APP_STDERR_LOG}.fifo.XXXXXX" 2>/dev/null || echo "${APP_STDERR_LOG}.fifo")"
STDOUT_FIFO="$(mktemp -u "${APP_STDOUT_LOG}.fifo.XXXXXX" 2>/dev/null || echo "${APP_STDOUT_LOG}.fifo")"
rm -f "$STDERR_FIFO" "$STDOUT_FIFO"
mkfifo "$STDERR_FIFO"
mkfifo "$STDOUT_FIFO"
tee -a "$APP_STDERR_LOG" < "$STDERR_FIFO" >&2 &
STDERR_TEE_PID=$!
tee -a "$APP_STDOUT_LOG" < "$STDOUT_FIFO" &
STDOUT_TEE_PID=$!
PORT="$APP_PORT" sh -c "$USER_START_COMMAND" >"$STDOUT_FIFO" 2>"$STDERR_FIFO" &
APP_PID=$!

if ! wait_for_app_port "$APP_PORT" "$APP_PID"; then
    echo "entrypoint: user app did not bind to 127.0.0.1:${APP_PORT} within ${APP_BOOT_TIMEOUT_SECONDS:-60}s" >&2
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
    # Drain the tee processes so the log files are flushed before we read them.
    kill "$STDERR_TEE_PID" 2>/dev/null || true
    kill "$STDOUT_TEE_PID" 2>/dev/null || true
    wait "$STDERR_TEE_PID" 2>/dev/null || true
    wait "$STDOUT_TEE_PID" 2>/dev/null || true
    rm -f "$STDERR_FIFO" "$STDOUT_FIFO" 2>/dev/null || true
    enter_diagnostic_mode "user app did not bind to 127.0.0.1:${APP_PORT} within ${APP_BOOT_TIMEOUT_SECONDS:-60}s"
    # enter_diagnostic_mode runs nginx for ZAI_DEPLOY_DIAG_LINGER_SECONDS then returns.
    exit 1
fi

nginx -g 'daemon off;' &
NGINX_PID=$!

# Portable supervisor: poll until either child exits, then report its status.
# (The bash-only "wait without-PID" form is unsupported on dash, which ships as
# /bin/sh on every debian-slim base image used by this plugin.)
EXIT_CODE=0
while :; do
    if ! kill -0 "$NGINX_PID" 2>/dev/null; then
        set +e
        wait "$NGINX_PID"
        EXIT_CODE=$?
        set -e
        echo "entrypoint: nginx exited with code $EXIT_CODE" >&2
        break
    fi
    if ! kill -0 "$APP_PID" 2>/dev/null; then
        set +e
        wait "$APP_PID"
        EXIT_CODE=$?
        set -e
        echo "entrypoint: user app exited with code $EXIT_CODE" >&2
        break
    fi
    sleep 1
done

shutdown
wait 2>/dev/null || true
exit "$EXIT_CODE"
