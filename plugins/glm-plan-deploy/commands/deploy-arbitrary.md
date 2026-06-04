---
allowed-tools: all
description: Deploy project with arbitrary language and tech stack by specifying custom build commands and parameters
---

# Deploy Arbitrary Command

Deploy projects of any programming language or framework. The agent invokes a
single scripted helper that analyses the project, renders Dockerfiles,
validates the build, uploads the source archive, drives the remote
build/deploy task, and renders the final report.

## Invoke the agent

Before delegating to `@glm-plan-deploy:deploy-arbitrary`, capture
`PLUGIN_ROOT` from `$CLAUDE_PLUGIN_ROOT` — Claude Code injects this env var
for every tool invocation. Read it with `echo "$CLAUDE_PLUGIN_ROOT"` (or
`node -p "process.env.CLAUDE_PLUGIN_ROOT"`). Do not try to derive the plugin
path from cwd, the project's `plugins/` directory, or any kind of search; a
real-world deploy runs from a user project that has no checkout of the
plugin's source repo.

Include both absolute paths in the Agent prompt:

```text
Deploy the project at the current working directory: ${TARGET_PROJECT_DIR}
ENTRY_PATH=$ARGUMENTS
PLUGIN_ROOT=<absolute path captured from $CLAUDE_PLUGIN_ROOT>
```

Plugin scripts are invoked via `${PLUGIN_ROOT}/scripts/...`, never via paths
relative to the target project directory.

If `$ARGUMENTS` is non-empty, pass it to the agent as `ENTRY_PATH`; the helper
receives it as `--path <path>`.

## What the agent does

The agent runs one consolidated helper that resolves auth and endpoint
settings, calls `GET /client/tcb/status`, detects runtime/build/start/output
settings, detects database intent, asks the user to choose managed/external/skip
database handling when needed, flags fixed runtime ports that do not honour
`PORT`, runs the local build/install validation step, generates Docker
artifacts for the supported runtimes (including SPA base-path injection for
vite/astro/angular/nuxt), asks the deploy API server to plan/prepare managed
MySQL bindings when selected, detects checked-in DB migration/schema changes,
runs a server-side migration status gate when needed, assembles and uploads the
source archive, creates and polls the deployment task, verifies the final
access URL, and formats the final boxed report.
Static Node frontend builds use an nginx-only runtime image; process runtimes
use the front-proxy + entrypoint pattern that handles the platform's opaque
`CONTEXT_PATH`.

The generated nginx runtime also supports server-managed access control. The
helper sends `runtimeCapabilities.nginxAccessControl =
runtime-nginx-x-envoy-external-address-v1` when creating a deploy task. If the
deploy API server has an allowlist policy enabled, it snapshots the policy and
injects base64-encoded nginx real-IP and allow/deny directives into the
runtime env. The client never sends allowlist CIDRs or proxy/header settings.
When verification receives the configured restricted response, typically 403,
the deploy is reported as successful but not publicly verifiable from the
current IP.

When the detector cannot resolve a field confidently (language/version,
build command, output dir, service root, start command, database mode/type,
deploy-time database sync confirmation, fixed-port fix) the helper returns
`needsUserInput: true`. The agent asks the user once, then re-invokes the
helper with the corresponding override flag(s). The agent never calls TCB SQL
APIs directly; all database provisioning, secret/binding materialization, and
migration status/apply execution goes through the intermediate deploy API
server.

Deploy-time database sync is safe by default:

- Default `--databaseSync auto` fingerprints checked-in migration/schema files
  and checks the remote DB only when project-side migration files changed.
- `--databaseSync check` forces a remote status check before deploy.
- `--databaseSync apply --databaseSyncConfirm` applies checked-in migrations
  before deploy.
- `--databaseSync skip` bypasses the database gate when the user intentionally
  manages DB changes outside deploy.
- For external databases, explicit `check` or `apply` requires
  `--databaseBindingId`; otherwise the helper asks whether to provide a binding
  or skip DB sync.

The remote DB is reachable only from the TCB function environment, so migration
commands must run through the server-owned TCB migration runner. The agent must
not run Prisma/Flyway/Alembic/Rails/etc. locally or in CNB.

Current API limitation: pre-deploy DB sync needs an existing `projectId` so the
migration archive can be attached to the remote project. On first deploy, the
helper returns a database `needsUserInput` boundary unless the user chooses
`--databaseSync skip`; after the project exists, use deploy sync or the
separate db-sync workflow.

## When to use

- Deploying non-Node.js projects (Python, Ruby, PHP, Go, Java, Rust, …).
- Node.js projects with a custom build pipeline or static frontend.
- Anywhere you need the full Dockerfile + nginx + entrypoint pipeline.

Environment lifecycle operations are out of scope for this command and must
not be suggested as deployment-failure workarounds.

## Orchestrator output rule

After the agent returns, relay its output **verbatim** to the user. Do not
summarise, reformat, wrap in a code fence, condense, or add a success /
failure sentence. The agent (via the helper's `finalReport`) produces the
authoritative final output.
