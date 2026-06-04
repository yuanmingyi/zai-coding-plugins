---
name: status-skill
description: Run nodejs script to get status of the last deployment. Only use when invoked by status command.
context: fork
allowed-tools: Bash, Read, Grep
---

# Status Skill

## Step 1: Detect Project Types

**Resolve settings paths from env vars first.** Both paths below are controlled by environment variables; the `.zai/deploy/*.json` strings are only fallbacks when the respective env var is unset or empty. Never hardcode the fallback path — always resolve and use the env-var value.

```bash
ZAI_EO_SETTINGS_PATH="${ZAI_EO_SETTINGS_PATH:-.zai/deploy/settings.json}"
ZAI_PROJECT_SETTINGS_PATH="${ZAI_PROJECT_SETTINGS_PATH:-.zai/deploy/tcb-settings.json}"
```

Check which of the resolved settings files exist in the current project directory:

1. `${ZAI_EO_SETTINGS_PATH}` — standard deploy (deployed via `deploy-skill`)
2. `${ZAI_PROJECT_SETTINGS_PATH}` — arbitrary deploy (Docker-based, deployed via `deploy-arbitrary`)

If both exist, run **Step 2A** and **Step 2B** to query status from both, then present combined results in **Step 3**.

If only one exists, run the corresponding step and present in **Step 3**.

If neither exists, tell the user no deployment has been configured yet and stop.

## Step 2A: Standard Deploy Status

Run once:
```bash
node /absolute/path/to/glm-plan-deploy/scripts/index.cjs status
```

## Step 2B: Arbitrary Deploy Status

Run once:

```bash
node /absolute/path/to/glm-plan-deploy/scripts/plugin-cli.js status-arbitrary --json
```

The script is responsible for:
- resolving deploy API base URL, auth token, and settings path
- loading `${ZAI_PROJECT_SETTINGS_PATH}`
- finding the latest `taskId`
- calling `GET /client/tcb/getTask`
- returning structured JSON with a preformatted `summary`

If the script returns `noDeployment: true`, treat that as "no deployment record was found for the arbitrary deploy" and continue to **Step 3**.

## Step 3: Present Results

If results were collected from both project types, present them under separate headings (e.g., "Standard Deploy" and "Arbitrary Deploy").

For each result, check the status:

**Success:** Open the deployment URL in default browser.

**Failed:** Display error message to the user. If a log URL is provided, open it with the default browser. Download and analyze the deploy log and/or audit result to provide actionable feedback.

**Other status:** Show status to the user.
