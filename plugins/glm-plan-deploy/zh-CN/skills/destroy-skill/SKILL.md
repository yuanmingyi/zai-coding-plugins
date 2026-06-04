---
name: destroy-skill
description: 销毁部署环境。仅在 destroy 命令调用时使用。
context: fork
allowed-tools: Bash, Read, Grep
---

# 销毁技能

严格按以下步骤执行一次。

### 步骤 1：请求确认

在进行破坏性 API 调用之前，向用户请求明确确认，并清楚警告此操作不可恢复且会销毁所有已部署项目。

如果用户没有明确确认，停止并报告销毁已取消。

### 步骤 2：调用确定性销毁脚本

确认后，运行一次：

```bash
node /absolute/path/to/glm-plan-deploy/scripts/plugin-cli.js destroy --json
```

脚本负责：
- 解析部署 API 基础 URL 和认证令牌
- 校验认证
- 调用 `POST /client/tcb/uninit`
- 解析 JSON envelope
- 返回带有预格式化 `summary` 的结构化 JSON

### 步骤 3：展示脚本结果

- 如果脚本返回 `success: true`，向用户转述其 `summary`。
- 如果脚本返回 `success: false`，逐字转述其 `message` 并停止。

## 约束

- 没有明确用户确认时不要销毁任何内容。
- 确认后只运行一次 destroy 脚本。
