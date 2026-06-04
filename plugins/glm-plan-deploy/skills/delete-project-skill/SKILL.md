---
name: delete-project-skill
description: Delete project with all its deployments. Only use when invoked by delete-project command.
context: fork
allowed-tools: Bash
---

# Delete Project Skill

Run the commands verbatim. All user-facing text comes from the scripts — do not paraphrase, reformat, or infer values yourself.

### Step 1: Preview

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.js" delete-project --preview --json
```

Parse the JSON result and branch:

1. `success: false` → relay `message` verbatim and stop.
2. `projectListPrompt` is present (no project is configured locally and the server has projects) → go to **Step 1A**.
3. `confirmationPrompt` is present → go to **Step 2** with `projectId = result.projectId` and `projectName = result.projectName`.

### Step 1A: Pick a remote project (only when the user has no local project)

Relay `result.projectListPrompt` verbatim and wait for the user's reply.

Map the reply to a `projectId` from `result.projects`:

- A number `N` (1-based) → `result.projects[N-1].projectId`.
- A raw string matching `result.projects[i].projectId` → that projectId.
- Anything else → tell the user the reply was not understood and stop.

Re-run the preview with the chosen project:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.js" delete-project --preview --projectId <projectId> --json
```

The follow-up result must include `confirmationPrompt`. From this point onward every delete invocation must carry both `--projectId <projectId>` and `--projectName <projectName>` taken from the chosen entry in `result.projects`.

### Step 2: Confirm and delete

Relay `confirmationPrompt` verbatim. Proceed only if the user's reply is `yes` (case-insensitive). Otherwise stop and report that deletion was cancelled.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.js" delete-project [--projectId <projectId>] [--projectName <projectName>] --json
```

Pass `--projectId` and `--projectName` only when they were set in Step 1A.

- `success: true` → relay `summary` verbatim.
- `success: false` → relay `message` verbatim and stop.

## Constraints

- Use only Bash, and run each scripted command at most once per step.
- Never perform Step 2 without the explicit user confirmation from `confirmationPrompt`.
- Do not read settings files, format prompts, or substitute placeholders by hand — pass through the strings the scripts return.
