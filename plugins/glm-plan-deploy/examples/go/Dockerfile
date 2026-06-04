# Go Runtime Dockerfile
# For pre-built Go binaries
#
# Build the binary first with architecture-specific flags:
#   amd64: CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o server .
#   arm64: CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o server .
#
# Or use CC_DEPLOY_BUILD_ARCH:
#   CGO_ENABLED=0 GOOS=linux GOARCH=${CC_DEPLOY_BUILD_ARCH:-amd64} go build -o server .
#
# Build Docker image:
#   docker build --platform linux/${CC_DEPLOY_BUILD_ARCH:-amd64} -t go-server .

# Use ARG for build-time architecture (defaults to amd64)
ARG TARGETARCH=amd64
FROM --platform=linux/${TARGETARCH} alpine:latest

# Install basic tools and timezone data
RUN apk add --no-cache tzdata ca-certificates && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata

# Set working directory
WORKDIR /app

# Copy the pre-built binary (must match target architecture)
COPY server /app/server

# Make executable
RUN chmod +x /app/server

# Port configuration (REQUIRED: production uses port 9000)
ENV PORT=9000
EXPOSE 9000

# Start the web service
# The application MUST read port from PORT environment variable
CMD ["/app/server"]
