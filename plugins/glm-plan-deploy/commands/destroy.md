---
allowed-tools: Skill
description: Destroy the deployment environment for the current account
---

# Destroy Command

### Invoke the skill

Invoke @glm-plan-deploy:destroy-skill to destroy the deployment environment.

The skill resolves the deploy API base URL and auth token, asks for explicit confirmation, calls `POST ${ZAI_DEPLOY_API_BASE}/client/tcb/uninit`, and reports the result.
