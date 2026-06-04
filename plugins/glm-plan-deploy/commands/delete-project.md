---
allowed-tools: Skill
description: Delete project with all its deployments
---

# Delete Project Command

### Invoke the skill

Invoke @glm-plan-deploy:delete-project-skill to delete the current project and all its deployments.

The skill resolves the `ZAI_PROJECT_SETTINGS_PATH` environment variable (falling back to `.zai/deploy/tcb-settings.json` only when unset) and reads that file for the project ID. When the current folder has no project configured, the skill calls `GET ${ZAI_DEPLOY_API_BASE}/client/tcb/projects`, lists the remote projects, and asks the user which one to delete. After the user confirms, the skill calls `POST ${ZAI_DEPLOY_API_BASE}/client/tcb/deleteProject` with `{ projectId }`. The server v2 no longer exposes BASIC/ADVANCED env scopes — there is no envType prompt.
