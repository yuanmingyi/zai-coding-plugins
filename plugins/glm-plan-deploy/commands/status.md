---
allowed-tools: Skill
description: Get the result of last deployment
---

# Status Command

### Invoke the skill

Invoke @glm-plan-deploy:status-skill to query the result of the last deployment.

The skill handles two project types automatically. Both paths are resolved from environment variables; the defaults shown in parentheses are fallbacks used only when the env var is unset, and must never be hardcoded:
- **Standard deploy** — path from `ZAI_EO_SETTINGS_PATH` env var (fallback `.zai/deploy/settings.json`): runs the Node.js script
- **Arbitrary deploy** — path from `ZAI_PROJECT_SETTINGS_PATH` env var (fallback `.zai/deploy/tcb-settings.json`): calls the `GET /client/tcb/getTask` API

If both settings files exist, the skill queries status from both deployment projects and presents the results together.
