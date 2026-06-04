---
name: delete-project-skill
description: 删除项目及其所有部署。仅在 delete-project 命令调用时使用。
context: fork
allowed-tools: Bash
---

# 删除项目技能

逐字运行命令。所有面向用户的文本都来自脚本 — 不要自行改写、重新格式化或推断值。

服务器 v2 取消了 BASIC / ADVANCED env 模型。每个 project-id 只对应一个项目，删除只有一次调用：`POST /client/tcb/deleteProject { projectId }`。不再有 `envType` 标志。

### 步骤 1：预览

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.js" delete-project --preview --json
```

解析 JSON 结果并分支：

1. `success: false` → 逐字转述 `message` 并停止。
2. 存在 `projectListPrompt`（本地未配置项目且服务器上有项目）→ 转到**步骤 1A**。
3. 存在 `confirmationPrompt` → 进入**步骤 2**，并设置 `projectId = result.projectId` 和 `projectName = result.projectName`。

### 步骤 1A：选择远程项目（仅当用户没有本地项目时）

逐字转述 `result.projectListPrompt` 并等待用户回复。

将回复映射到 `result.projects` 中的 `projectId`：

- 数字 `N`（从 1 开始）→ `result.projects[N-1].projectId`。
- 与 `result.projects[i].projectId` 匹配的原始字符串 → 该 projectId。
- 其他任何内容 → 告诉用户无法理解该回复并停止。

使用所选项目重新运行预览：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.js" delete-project --preview --projectId <projectId> --json
```

后续结果必须包含 `confirmationPrompt`。从此之后，每次删除调用都必须同时携带取自 `result.projects` 所选条目的 `--projectId <projectId>` 和 `--projectName <projectName>`。

### 步骤 2：确认并删除

逐字转述 `confirmationPrompt`。仅当用户回复为 `yes`（大小写不敏感）时继续。否则停止并报告删除已取消。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.js" delete-project [--projectId <projectId>] [--projectName <projectName>] --json
```

仅当步骤 1A 中已设置 `projectId` 和 `projectName` 时传入它们。

- `success: true` → 逐字转述 `summary`。
- `success: false` → 逐字转述 `message` 并停止。

## 约束

- 仅使用 Bash，并且每个步骤最多运行一次脚本化命令。
- 没有来自 `confirmationPrompt` 的明确用户确认时，绝不要执行步骤 2。
- 不要读取设置文件、格式化提示或手动替换占位符 — 透传脚本返回的字符串。
