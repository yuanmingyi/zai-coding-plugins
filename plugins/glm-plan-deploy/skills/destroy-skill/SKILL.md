---
name: destroy-skill
description: Destroy the deployment environment. Only use when invoked by destroy command.
context: fork
allowed-tools: Bash, Read, Grep
---

# Destroy Skill

Follow the steps below exactly once.

### Step 1: Ask for confirmation

Before making the destructive API call, ask the user for explicit confirmation with a clear warning that this action is not recoverable and will destroy all deployed projects.

If the user does not explicitly confirm, stop and report that destruction was cancelled.

### Step 2: Invoke the deterministic destroy script

After confirmation, run once:

```bash
node /absolute/path/to/glm-plan-deploy/scripts/plugin-cli.js destroy --json
```

The script is responsible for:
- resolving deploy API base URL and auth token
- validating authentication
- calling `POST /client/tcb/uninit`
- parsing the JSON envelope
- returning structured JSON with a preformatted `summary`

### Step 3: Present the script result

- If the script returns `success: true`, relay its `summary` to the user.
- If the script returns `success: false`, relay its `message` exactly and stop.

## Constraints

- Do not destroy anything without explicit user confirmation.
- Run the destroy script exactly once after confirmation.
