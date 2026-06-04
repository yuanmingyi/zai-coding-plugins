# Rust Runtime Dockerfile
# For pre-built Rust binaries
#
# Build the binary first with architecture-specific target:
#   amd64: cargo build --release --target x86_64-unknown-linux-musl
#   arm64: cargo build --release --target aarch64-unknown-linux-musl
#
# Ensure you have the musl targets installed:
#   rustup target add x86_64-unknown-linux-musl
#   rustup target add aarch64-unknown-linux-musl
#
# Build Docker image:
#   docker build --platform linux/${CC_DEPLOY_BUILD_ARCH:-amd64} -t rust-app .

# Use ARG for build-time architecture (defaults to amd64)
ARG TARGETARCH=amd64
FROM --platform=linux/${TARGETARCH} alpine:latest

# Install CA certificates for HTTPS requests
RUN apk add --no-cache ca-certificates tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata

# Set working directory
WORKDIR /app

# Copy the pre-built binary (must match target architecture)
# Adjust the binary name to match your project
COPY app /app/app

# Make binary executable
RUN chmod +x /app/app

# Port configuration (REQUIRED: production uses port 9000)
ENV PORT=9000
EXPOSE 9000

# Set environment
ENV RUST_LOG=info

# Start the application
CMD ["/app/app"]
