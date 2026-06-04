# Go Deployment Example

## Supported Versions

- Go 1.21, 1.22, 1.23

## Local Dependencies

```bash
# Download dependencies
go mod download
# or
go mod tidy
```

## Build Commands

Go requires compilation to a binary before deployment.

```bash
# Standard build (for current OS/arch)
go build -o server .

# Cross-compile for Linux using CC_DEPLOY_BUILD_ARCH
CGO_ENABLED=0 GOOS=linux GOARCH=${CC_DEPLOY_BUILD_ARCH:-amd64} go build -o server .

# Explicit amd64 (production)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o server .

# Explicit arm64 (Apple Silicon local testing)
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o server .

# Optimized production build (smaller binary)
CGO_ENABLED=0 GOOS=linux GOARCH=${CC_DEPLOY_BUILD_ARCH:-amd64} go build -ldflags="-w -s" -o server .
```

### Architecture-Specific Builds

| CC_DEPLOY_BUILD_ARCH | GOARCH | When to use |
|----------------------|--------|-------------|
| `amd64` (default) | `amd64` | Production server, Intel/AMD Linux |
| `arm64` | `arm64` | Apple Silicon Mac local testing |

### Special Cases

| Scenario | Build Command | Notes |
|----------|---------------|-------|
| Standard | `go build -o server .` | Basic build |
| Cross-compile | `GOOS=linux GOARCH=amd64 go build -o server .` | Required when building on non-Linux |
| CGO disabled | `CGO_ENABLED=0 go build -o server .` | For Alpine-based containers |
| Optimized | `go build -ldflags="-w -s" -o server .` | Strips debug info, smaller binary |

## Output Directory

| Build Type | Output | Contents |
|------------|--------|----------|
| Standard | `.` (root) | Single binary file |
| Custom | Specified via `-o` flag | Single binary file |

## Files to Include

- `server` (or named binary) - The compiled executable
- `config/` - Configuration files (if external)
- `templates/` - HTML templates (if using html/template)
- `static/`, `public/` - Static assets (if serving)

## Files to Exclude

- `*.go` - Source files (not needed at runtime)
- `go.mod`, `go.sum` - Build files (not needed at runtime)
- `vendor/` - Dependencies (compiled into binary)
- `*_test.go` - Test files
- `.git/`

## Startup Commands

```bash
# Direct execution
./server

# With environment variables
PORT=9000 ./server
```

## Common Ports

- Default: 8080 (dev)
- **Production: 9000 (REQUIRED)** - Application must use `PORT` environment variable

## Environment Variables

```bash
# Common Go environment variables
GIN_MODE=release          # For Gin framework
# REQUIRED: Production port
PORT=9000
```

## Port Configuration Requirement

**The production environment REQUIRES port 9000.** Your application must read the port from the `PORT` environment variable.

### Minimal code changes:

| Framework | Before | After |
|-----------|--------|-------|
| net/http | `http.ListenAndServe(":8080", nil)` | `http.ListenAndServe(":"+os.Getenv("PORT"), nil)` |
| Gin | `r.Run(":8080")` | `r.Run(":" + os.Getenv("PORT"))` |
| Echo | `e.Start(":8080")` | `e.Start(":" + os.Getenv("PORT"))` |
| Fiber | `app.Listen(":8080")` | `app.Listen(":" + os.Getenv("PORT"))` |

## Important Notes

1. **Cross-compilation is required** when building on macOS/Windows for Linux deployment
2. **CGO_ENABLED=0** is recommended for Alpine containers to avoid glibc issues
3. Go binaries are statically linked - no runtime dependencies needed
4. Use `alpine:latest` for minimal container size since only the binary is needed
5. Include `go.sum` in deploy context to keep dependency resolution deterministic
6. Prefer pinned base versions (for example `golang:1.22-alpine`) over floating `latest` tags
