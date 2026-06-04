---
name: deploy-skill
description: Run Node.js script to deploy the user project in current folder. Only use when invoked by deploy command.
context: fork
allowed-tools: Bash, Read, Grep
---

# Deploy Skill

This command is currently unsupported and must not run the legacy standard deploy flow.

### Step 1: Report that the command is unavailable

Reply with:

```text
❌ `/glm-plan-deploy:deploy` is currently unsupported.
- Use `/glm-plan-deploy:deploy-arbitrary` instead.
```

## Constraints

- Do not run the legacy standard deploy script.
- Do not provide the removed standard deploy instructions.
