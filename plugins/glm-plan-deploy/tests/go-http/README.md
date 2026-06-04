# Go HTTP Test Project

Minimal Go HTTP server for testing deploy-arbitrary agent.

## Local Development

```bash
go build -o server .
PORT=9000 ./server
```

## Cross-Compile for Linux

```bash
# For Linux amd64 (production)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o server .

# For Linux arm64 (Apple Silicon local testing)
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o server .
```

## Expected Deployment Parameters

- **Language/Runtime**: Go 1.21
- **Build command**: `CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build -ldflags="-w -s" -o server .`
- **Build output files**: `server` (single binary)
- **Runtime dependencies**: None (statically linked binary)
- **Startup command**: `./server`
- **Port**: 9000 (via PORT env var)

## Verify

```bash
curl http://localhost:9000
# {"status": "ok", "language": "go", "framework": "net/http"}
```
