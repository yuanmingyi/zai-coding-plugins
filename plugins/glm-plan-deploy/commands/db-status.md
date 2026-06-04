---
allowed-tools: all
description: Check remote database migration status for the deployed arbitrary project
---

# DB Status Command

Check the migration status of the remote database bound to the current
arbitrary deployment. The agent invokes one scripted helper that detects the
project migration system, uploads a sanitized source archive containing
checked-in migration files, and asks the intermediate deploy API server to run
a safe migration-status check with server-resolved DB credentials.
The remote DB is reachable only from the TCB function environment, so status
checks must run through the server-owned TCB migration runner. The agent must
not fall back to local, CNB, direct Java server, TCB, SQL, or database API
access.

Use this command for explicit DB inspection, manual drift investigation, or
preflight checks outside deploy. The deploy command has its own safe
`--databaseSync auto|check|apply|skip` gate for checked-in migration changes.

## Invoke the agent

Capture `PLUGIN_ROOT` from `$CLAUDE_PLUGIN_ROOT` and include both absolute
paths in the Agent prompt:

```text
Check database migration status for the project at the current working directory: ${TARGET_PROJECT_DIR}
PLUGIN_ROOT=<absolute path captured from $CLAUDE_PLUGIN_ROOT>
```

## What the agent does

The agent runs:

```bash
node "${PLUGIN_ROOT}/scripts/plugin-cli.js" db-status-arbitrary --json \
  --cwd "${TARGET_PROJECT_DIR}" \
  [--bindingId ...] [--framework ...] [--migrationCommand ...] [--agentWorkDir ...]
```

If no stored binding exists, the helper returns `needsUserInput` and the
agent asks for `--bindingId`. The agent must not call TCB or SQL APIs
directly.

If the helper reports a missing runner capability or incomplete migration
status result, relay that terminal result and stop.

## Output rule

Relay the agent output verbatim. Do not summarize or reformat it.
