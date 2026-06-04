---
allowed-tools: all
description: Apply checked-in database migrations to the remote database for the deployed arbitrary project
---

# DB Sync Command

Apply checked-in, versioned migration files to the remote database bound to
the current arbitrary deployment. The agent invokes one scripted helper. DB
credentials are resolved only by the intermediate deploy API server.
The remote DB is reachable only from the TCB function environment, so apply
operations must run through the server-owned TCB migration runner. The agent
must not fall back to local, CNB, direct Java server, TCB, SQL, or database
API access.

Use this command when the user intentionally wants a database operation outside
deploy. The deploy command can apply checked-in migrations through
`--databaseSync apply --databaseSyncConfirm`, but neither workflow should infer
destructive SQL from manual live row/cell edits.

## Invoke the agent

Capture `PLUGIN_ROOT` from `$CLAUDE_PLUGIN_ROOT` and include both absolute
paths in the Agent prompt:

```text
Sync database migrations for the project at the current working directory: ${TARGET_PROJECT_DIR}
PLUGIN_ROOT=<absolute path captured from $CLAUDE_PLUGIN_ROOT>
```

## What the agent does

The first helper call omits `--confirm`:

```bash
node "${PLUGIN_ROOT}/scripts/plugin-cli.js" db-sync-arbitrary --json \
  --cwd "${TARGET_PROJECT_DIR}" \
  [--bindingId ...] [--framework ...] [--migrationCommand ...] [--agentWorkDir ...]
```

If the helper asks for confirmation, show the message to the user. Only after
the user explicitly confirms, rerun the same command with `--confirm`.

The helper rejects unsafe live-diff commands such as `prisma db push`; it only
supports checked-in, versioned migrations.

If the helper reports a missing runner capability or incomplete migration
apply result, relay that terminal result and stop.

## Output rule

Relay the agent output verbatim. Do not summarize or reformat it.
