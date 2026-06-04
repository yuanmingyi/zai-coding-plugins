---
allowed-tools: Skill
description: Initialize the deployment environment for the current account
---

# Init Command

### Invoke the skill

Invoke @glm-plan-deploy:init-skill to initialize the deployment environment.

The skill resolves the deploy API base URL and auth token, calls `POST ${ZAI_DEPLOY_API_BASE}/client/tcb/init`, and reports the result.
