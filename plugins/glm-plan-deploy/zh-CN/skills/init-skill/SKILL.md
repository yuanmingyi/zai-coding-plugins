---
name: init-skill
description: 初始化部署环境。仅在 init 命令调用时使用。
context: fork
allowed-tools: Bash, Read, Grep
---

# 初始化技能

严格按以下步骤执行一次。

### 步骤 1：调用确定性初始化脚本

运行一次：

```bash
node /absolute/path/to/glm-plan-deploy/scripts/plugin-cli.js init --json
```

脚本负责：
- 解析部署 API 基础 URL 和认证令牌
- 校验认证
- 调用 `POST /client/tcb/init`
- 解析 JSON envelope
- 返回带有预格式化 `summary` 的结构化 JSON

### 步骤 2：展示脚本结果

- 如果脚本返回 `success: true`，向用户转述其 `summary`。
- 如果脚本返回 `success: false`，逐字转述其 `message` 并停止。

## 约束

- 只运行一次 init 脚本。
- 初始化后不要自动开始部署。
