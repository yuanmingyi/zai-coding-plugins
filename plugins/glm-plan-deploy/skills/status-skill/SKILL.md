---
name: status-skill
description: Run nodejs script to get status of the last deployment. Only use when invoked by status command.
context: fork
allowed-tools: Bash, Read, Grep
---

# Status Skill

## Step 1: Check Deployment Settings

**Resolve the settings path from the env var first.** The `.zai/deploy/*.json` string is only a fallback when the env var is unset or empty. Never hardcode the fallback path — always resolve and use the env-var value.

```bash
ZAI_PROJECT_SETTINGS_PATH="${ZAI_PROJECT_SETTINGS_PATH:-.zai/deploy/tcb-settings.json}"
```

Check whether the resolved settings file exists in the current project directory. This file is created by the `deploy-arbitrary` command.

If it does not exist, tell the user no deployment has been configured yet and stop.

## Step 2: Query Arbitrary Deploy Status

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

If the script returns `noDeployment: true`, treat that as "no deployment record was found" and continue to **Step 3**.

## Step 3: Present Results

Check the status:

**Success:** Open the deployment URL in default browser.

**Failed:** Display error message to the user. If a log URL is provided, open it with the default browser. Download and analyze the deploy log and/or audit result to provide actionable feedback.

**Other status:** Show status to the user.
