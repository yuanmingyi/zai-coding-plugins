---
name: init-skill
description: Initialize the deployment environment. Only use when invoked by init command.
context: fork
allowed-tools: Bash, Read, Grep
---

# Init Skill

Follow the steps below exactly once.

### Step 1: Invoke the deterministic init script

Run once:

```bash
node /absolute/path/to/glm-plan-deploy/scripts/plugin-cli.js init --json
```

The script is responsible for:
- resolving deploy API base URL and auth token
- validating authentication
- calling `POST /client/tcb/init`
- parsing the JSON envelope
- returning structured JSON with a preformatted `summary`

### Step 2: Present the script result

- If the script returns `success: true`, relay its `summary` to the user.
- If the script returns `success: false`, relay its `message` exactly and stop.

## Constraints

- Run the init script exactly once.
- Do not start a deployment automatically after initialization.
