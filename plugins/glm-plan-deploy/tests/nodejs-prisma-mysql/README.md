# Node.js Prisma MySQL Test Project

Express application that uses Prisma with a MySQL database. This fixture verifies that the deploy-arbitrary analyzer detects a real Node.js database project, its required `DATABASE_URL`, and the Prisma migration command.

## Local Development

```bash
npm install
npx prisma generate
npx prisma migrate deploy
PORT=9000 npm start
```

## Expected Deployment Parameters

- **Language/Runtime**: Node.js 20
- **Build command**: `npm ci --omit=dev`
- **Build output files**: Source files
- **Runtime dependencies**: Node production dependencies
- **Startup command**: `npm start`
- **Database**: MySQL via `DATABASE_URL`
- **Migration command**: `npx prisma migrate deploy`
- **Port**: 9000 (via PORT env var)

## Verify

```bash
curl http://localhost:9000
# {"status":"ok","language":"nodejs","framework":"express","database":"mysql"}

curl http://localhost:9000/todos
# Requires DATABASE_URL and a reachable migrated MySQL database.
```
