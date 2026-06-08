# Deploy Arbitrary Agent Test Cases

Test projects for validating the deploy-arbitrary agent workflow.

## New Workflow Overview

The deploy-arbitrary agent now uses a two-stage Docker build process:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AGENT OUTPUT                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  deploy-package/                                                            │
│  ├── Dockerfile.build    # Build image (source + compilers/tools)           │
│  ├── Dockerfile.run      # Runtime image (minimal, outputs only)            │
│  ├── deploy.sh           # Orchestration script                             │
│  └── <source-files>      # Project source code                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            deploy.sh EXECUTION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Step 1: docker build -f Dockerfile.build → app-build image                 │
│  Step 2: docker run app-build → extract outputs to ./build-output/          │
│  Step 3: docker build -f Dockerfile.run → app runtime image                 │
│  Step 4: docker push (if REGISTRY set)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Test Workflow

1. **Set architecture** → Set `CC_DEPLOY_BUILD_ARCH` environment variable
2. **Run the agent** → Get `deploy-package/` with source + Dockerfiles + deploy.sh
3. **Extract and run deploy.sh** → Builds both images, extracts outputs
4. **Run container** → `docker run -p 9000:9000 <app-name>`
5. **Verify** → `curl http://localhost:9000` should return expected response

## Environment Variables

### CC_DEPLOY_BUILD_ARCH

**IMPORTANT: Set this BEFORE running the deploy-arbitrary agent.**

Controls the target architecture for builds. The agent reads this variable to determine the correct build commands for compiled languages (Go, Rust).

| Value   | Description            | When to use                             |
| ------- | ---------------------- | --------------------------------------- |
| `amd64` | Linux x86_64 (default) | Production server, Intel/AMD Linux      |
| `arm64` | Linux ARM64            | Apple Silicon Mac (M1/M2/M3), ARM Linux |

```bash
# For Apple Silicon Mac (local testing) - SET BEFORE RUNNING AGENT
export CC_DEPLOY_BUILD_ARCH=arm64

# For production or Intel/AMD (default)
export CC_DEPLOY_BUILD_ARCH=amd64
# or unset (defaults to amd64)
```

### Agent Log Audit (optional)

`run-tests.sh` can optionally audit the Claude agent log for deploy-arbitrary instruction compliance after each agent run.

```bash
# Enable audit and fail if weighted adherence score is below 70
AGENT_LOG_AUDIT=true AGENT_LOG_AUDIT_MIN_SCORE=70 ./plugins/glm-plan-deploy/tests/run-tests.sh -a ruby-sinatra

# Use balanced scoring and fail on a specific policy check (deterministic gate)
AGENT_LOG_AUDIT=true AGENT_LOG_AUDIT_SCORE_PROFILE=balanced \
AGENT_LOG_AUDIT_FAIL_ON_CHECKS=consolidated_helper_invoked \
./plugins/glm-plan-deploy/tests/run-tests.sh -a ruby-sinatra
```

Supported environment variables:

| Variable                         | Description                                                        |
| -------------------------------- | ------------------------------------------------------------------ |
| `AGENT_LOG_AUDIT`                | Enable post-agent log auditing (`true`/`false`, default `false`)   |
| `AGENT_LOG_AUDIT_MIN_SCORE`      | Fail the test run if audit score is below this threshold (`0-100`) |
| `AGENT_LOG_AUDIT_JSON`           | Save JSON audit report to `<project>/agent-log-audit.json`         |
| `AGENT_LOG_AUDIT_SCORE_PROFILE`  | Score profile (`strict` or `balanced`; `strict` default)           |
| `AGENT_LOG_AUDIT_FAIL_ON_CHECKS` | Fail if listed check IDs are `FAIL` (comma-separated)              |
| `CLAUDE_PROJECTS_DIR`            | Claude project logs root (default `~/.claude/projects`)            |

Standalone usage:

```bash
node plugins/glm-plan-deploy/scripts/auditDeployArbitraryAgentLog.js /path/to/claude/project/log-dir
node plugins/glm-plan-deploy/scripts/auditDeployArbitraryAgentLog.js --json --min-score 70 /path/to/claude/project/log-dir
node plugins/glm-plan-deploy/scripts/auditDeployArbitraryAgentLog.js --score-profile balanced --fail-on-check consolidated_helper_invoked /path/to/claude/project/log-dir
```

### Headless Claude Code process test

`runDeployArbitraryAgentHeadlessTest.js` runs the deploy-arbitrary agent through Claude Code print/headless mode, finds the generated Claude `.jsonl` transcript, verifies the deploy result from the log, and scores whether the agent followed the deploy-arbitrary markdown instructions. The process score is capped by both a weighted checklist and the percentage of compliant tool actions. The test fails unless the deployment succeeds and the process score is at least 90 by default.

When Claude Code delegates to the deploy-arbitrary subagent, the runner evaluates both the parent session log and matching child logs under `<session-id>/subagents/*.jsonl`, so the score includes the actual helper command run by the subagent.

```bash
cd plugins/glm-plan-deploy/scripts
npm run test:agent-headless -- \
  --project-dir "$(pwd)/../tests/python-flask" \
  --repo-root "$(cd ../../.. && pwd)" \
  --session-cwd "$(pwd)/../tests/python-flask"
```

Useful options:

| Option                  | Description                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `--project-dir`         | Absolute application directory to deploy. Required.                                                       |
| `--repo-root`           | Absolute repository root containing `plugins/glm-plan-deploy`. Defaults to the current working directory. |
| `--session-cwd`         | Directory used as the Claude CLI working directory and log-project key. Defaults to `--project-dir`.      |
| `--claude-cli`          | Claude CLI command. Defaults to `CLAUDE_CLI` or `claude`.                                                 |
| `--claude-projects-dir` | Claude project logs root. Defaults to `~/.claude/projects`.                                               |
| `--log-file`            | Evaluate an existing `.jsonl` file without running Claude.                                                |
| `--min-score`           | Minimum process adherence score from 0 to 100. Defaults to 90.                                            |
| `--json`                | Print the full machine-readable report.                                                                   |

## Test Projects

### Default Deploy Fixtures

| Language           | Directory         | Port | Expected Response                        |
| ------------------ | ----------------- | ---- | ---------------------------------------- |
| Python (Flask)     | `python-flask/`   | 9000 | `{"status": "ok", "language": "python"}` |
| Node.js (Express)  | `nodejs-express/` | 9000 | `{"status": "ok", "language": "nodejs"}` |
| Go                 | `go-http/`        | 9000 | `{"status": "ok", "language": "go"}`     |
| Java (Spring Boot) | `java-spring/`    | 9000 | `{"status": "ok", "language": "java"}`   |
| Ruby (Sinatra)     | `ruby-sinatra/`   | 9000 | `{"status": "ok", "language": "ruby"}`   |
| PHP                | `php-simple/`     | 9000 | `{"status": "ok", "language": "php"}`    |
| Rust (Actix)       | `rust-actix/`     | 9000 | `{"status": "ok", "language": "rust"}`   |

### Diagnostic Fixtures

| Purpose                                  | Directory                  | Port | Expected Response                             |
| ---------------------------------------- | -------------------------- | ---- | --------------------------------------------- |
| TCB/nginx real visitor IP probe          | `nodejs-real-ip-probe/`    | 9000 | Raw socket and forwarded IP headers           |
| Raw static context-path resource routing | `raw-static-path-routing/` | 9000 | HTML fixture with relative and absolute paths |

`raw-static-path-routing/` verifies both relative and root-absolute HTML `href` paths, plus relative and root-absolute JavaScript redirects, under a non-root deployment context path.

### Database Fixtures

These projects are intentionally not included in the default `run-tests.sh all` list because they require an explicit database choice:

- `--databaseMode managed` for supported managed MySQL scenarios.
- `--databaseMode external` when the database is user-provided, such as PostgreSQL.

| Language                        | Directory                | Database   | Migration Source                   | Verifies                                                            |
| ------------------------------- | ------------------------ | ---------- | ---------------------------------- | ------------------------------------------------------------------- |
| Node.js (Express + Prisma)      | `nodejs-prisma-mysql/`   | MySQL      | `prisma/migrations/`               | Prisma MySQL detection, `DATABASE_URL`, `npx prisma migrate deploy` |
| Python (Flask + SQLAlchemy)     | `python-flask-postgres/` | PostgreSQL | `migrations/001_init.sql`          | PostgreSQL detection and external database flow                     |
| Java (Spring Boot + JPA/Flyway) | `java-spring-mysql/`     | MySQL      | `src/main/resources/db/migration/` | Spring Data JPA MySQL detection and managed MySQL flow              |

## Running Tests

### Manual Test Steps

```bash
# 1. Set architecture FIRST (required for Apple Silicon, optional for Intel/AMD)
export CC_DEPLOY_BUILD_ARCH=arm64  # or amd64 (default)

# 2. Navigate to a test project
cd plugins/glm-plan-deploy/tests/python-flask

# 3. Run the deploy-arbitrary agent
# (In Claude Code, invoke /glm-plan-deploy:deploy-arbitrary)
# The agent will create deploy-package/ with:
#   - Dockerfile.build
#   - Dockerfile.run
#   - deploy.sh
#   - source files

# 4. After agent completes, run deploy.sh
cp -R deploy-package /tmp/deploy-test
cd /tmp/deploy-test/deploy-package
chmod +x deploy.sh
APP_NAME=test-python CC_DEPLOY_BUILD_ARCH=${CC_DEPLOY_BUILD_ARCH:-amd64} ./deploy.sh

# 5. Run the container
docker run -d -p 9000:9000 --name test-python test-python

# 6. Verify
curl http://localhost:9000
# Should return: {"status": "ok", "language": "python"}

# 7. Cleanup
docker stop test-python && docker rm test-python
docker rmi test-python test-python-build
```

### Using /test-agent Command

```bash
# Set architecture first (for Apple Silicon)
export CC_DEPLOY_BUILD_ARCH=arm64

# Test a specific project
/glm-plan-deploy:test-agent go-http

# Test all projects
/glm-plan-deploy:test-agent all
```

### Verifying Database Fixtures

The database fixtures are covered by analyzer-level unit tests:

```bash
cd plugins/glm-plan-deploy/scripts
node ./node_modules/vitest/vitest.mjs run __tests__/arbitrary.dbFixtures.test.js
```

For a full deploy-agent run, invoke a database fixture directly and provide the database mode expected by the scenario:

```bash
# Managed MySQL through the deploy API server, using the test runner
DEPLOY_ARBITRARY_FLAGS="--databaseMode managed" ./plugins/glm-plan-deploy/tests/run-tests.sh -a nodejs-prisma-mysql

# External PostgreSQL that the user/network provides
DEPLOY_ARBITRARY_FLAGS="--databaseMode external" ./plugins/glm-plan-deploy/tests/run-tests.sh -a python-flask-postgres
```

## Project Requirements

Each test project must:

1. Read port from `PORT` environment variable (default fallback allowed)
2. Listen on `0.0.0.0` (not `127.0.0.1` or `localhost`)
3. Return JSON response at root endpoint (`/`)
4. Be minimal but complete (no unnecessary dependencies)
5. Use `.env.example` only for database examples; never commit real database secrets

## Generated Files

The agent generates the following files (all in `.gitignore`):

| File               | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `Dockerfile.build` | Multi-stage Dockerfile for building with source + tools |
| `Dockerfile.run`   | Minimal runtime Dockerfile                              |
| `deploy.sh`        | Orchestration script for server-side execution          |
| `deploy-package/`  | Final deployment package                                |
| `.tmp-deploy/`     | Temporary directory for packaging                       |
| `build-output/`    | Build outputs extracted by deploy.sh                    |
