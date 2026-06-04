# Node.js Express Test Project

Minimal Express application for testing deploy-arbitrary agent.

## Local Development

```bash
npm install
PORT=9000 node server.js
```

## Expected Deployment Parameters

- **Language/Runtime**: Node.js 20
- **Build command**: None (no transpilation needed)
- **Build output files**: None (source files used directly)
- **Runtime dependencies**: `npm ci --production`
- **Startup command**: `node server.js`
- **Port**: 9000 (via PORT env var)

## Verify

```bash
curl http://localhost:9000
# {"status": "ok", "language": "nodejs", "framework": "express"}
```
