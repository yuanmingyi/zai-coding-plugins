---
allowed-tools: Skill
description: Get the result of last deployment
---

# Status Command

### Invoke the skill

Invoke @glm-plan-deploy:status-skill to query the result of the last deployment.

The skill queries the status of the last arbitrary deploy task. The settings path is resolved from the `ZAI_PROJECT_SETTINGS_PATH` environment variable (fallback `.zai/deploy/tcb-settings.json`); the default is used only when the env var is unset, and must never be hardcoded.
