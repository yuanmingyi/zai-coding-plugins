# Node.js Deployment Example

## Supported Versions

- Node.js 18.x, 20.x, 22.x (LTS versions recommended)

## Local Dependencies

```bash
# Install dependencies locally before deployment (lockfile-aware)
if [ -f package-lock.json ]; then
  npm ci --omit=dev
elif [ -f yarn.lock ]; then
  yarn install --production=true
elif [ -f pnpm-lock.yaml ]; then
  pnpm install --prod
else
  npm install --omit=dev
fi
```

## Build Commands

Use the same package manager selected by lockfile:
- `PM_INSTALL`: one of `npm ci --omit=dev`, `yarn install --frozen-lockfile --production=true`, `pnpm install --frozen-lockfile --prod`, or `npm install --omit=dev` (no lockfile fallback)
- `PM_BUILD`: one of `npm run build`, `yarn build`, or `pnpm build`

| Framework | Build Command | Notes |
|-----------|---------------|-------|
| Express | `PM_INSTALL` (or `PM_INSTALL && PM_BUILD` if TypeScript) | Installs runtime dependencies; compile if needed |
| Next.js | `PM_INSTALL && PM_BUILD` | Installs dependencies and creates `.next/` directory |
| Nuxt.js | `PM_INSTALL && PM_BUILD` | Installs dependencies and creates `.nuxt/` / `.output/` |
| Vite/React | `PM_INSTALL && PM_BUILD` | Installs dependencies and creates `dist/` directory |
| NestJS | `PM_INSTALL && PM_BUILD` | Installs dependencies and creates `dist/` directory |

### TypeScript Projects

```bash
# Compile TypeScript to JavaScript
npm run build
# or
npx tsc
```

## Output Directory

| Framework | Output Directory | Contents |
|-----------|------------------|----------|
| Express | `.` (root) | Source files + node_modules |
| Next.js | `.next/` | Compiled application |
| Vite/React | `dist/` | Static files (use static hosting) |
| NestJS | `dist/` | Compiled JavaScript |

## Files to Include

- `*.js`, `*.mjs` - JavaScript files
- `package.json` + lock file (`package-lock.json` or `yarn.lock` or `pnpm-lock.yaml`) - Dependencies
- `.next/`, `dist/`, `.output/` - Build output (framework-specific)
- `public/` - Static assets
- `views/` - Template files (if using templating)

## Files to Exclude

- `node_modules/` - Reinstalled in container
- `src/` - TypeScript source (if compiled)
- `*.ts` - TypeScript files (if compiled)
- `tests/`, `__tests__/`, `*.test.js`, `*.spec.js`
- `.git/`
- `.env` - Use environment variables instead

## Startup Commands

| Framework | Development | Production |
|-----------|-------------|------------|
| Express | `node server.js` | `node server.js` or `pm2 start server.js` |
| Next.js | `npm run dev` | `npm start` (requires `next start` in scripts) |
| NestJS | `npm run start:dev` | `node dist/main.js` |

## Common Ports

- Express: 3000 (dev)
- Next.js: 3000 (dev)
- NestJS: 3000 (dev)
- **Production: 9000 (REQUIRED)** - Application must use `PORT` environment variable

## Environment Variables

```bash
NODE_ENV=production
# REQUIRED: Production port
PORT=9000
```

## Port Configuration Requirement

**The production environment REQUIRES port 9000.** Your application must read the port from the `PORT` environment variable.

### Minimal code changes:

| Framework | Before | After |
|-----------|--------|-------|
| Express | `app.listen(3000)` | `app.listen(process.env.PORT \|\| 3000)` |
| Next.js | `"start": "next start"` | `"start": "next start -p $PORT"` in package.json |
| NestJS | `app.listen(3000)` | `app.listen(process.env.PORT \|\| 3000)` |

## Reliability Notes

1. Keep package-manager choice consistent across local build and Docker build (do not switch npm/yarn/pnpm mid-pipeline).
2. Prefer lockfile-backed install commands for deterministic dependency trees.
3. Prefer pinned Node base tags (for example `node:20-slim`) over `latest`.
