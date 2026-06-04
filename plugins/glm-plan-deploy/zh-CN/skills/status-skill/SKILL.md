---
name: status-skill
description: 运行 nodejs 脚本以获取最后一次部署的状态。仅在 status 命令调用时使用。
context: fork
allowed-tools: Bash, Read, Grep
---

# 状态技能

## 步骤 1：检测项目类型

**先从 env vars 解析设置路径。** 以下两个路径都由环境变量控制；`.zai/deploy/*.json` 字符串仅在对应 env var 未设置或为空时作为回退。绝不要硬编码回退路径 — 始终解析并使用 env-var 值。

```bash
ZAI_EO_SETTINGS_PATH="${ZAI_EO_SETTINGS_PATH:-.zai/deploy/settings.json}"
ZAI_PROJECT_SETTINGS_PATH="${ZAI_PROJECT_SETTINGS_PATH:-.zai/deploy/tcb-settings.json}"
```

检查当前项目目录中哪些已解析设置文件存在：

1. `${ZAI_EO_SETTINGS_PATH}` — 标准部署（通过 `deploy-skill` 部署）
2. `${ZAI_PROJECT_SETTINGS_PATH}` — 任意部署（基于 Docker，通过 `deploy-arbitrary` 部署）

如果两者都存在，运行**步骤 2A** 和**步骤 2B** 查询两者状态，然后在**步骤 3** 中展示合并结果。

如果只存在其中一个，运行对应步骤并在**步骤 3** 中展示。

如果两者都不存在，告诉用户尚未配置任何部署并停止。

## 步骤 2A：标准部署状态

运行一次：
```bash
node /absolute/path/to/glm-plan-deploy/scripts/index.cjs status
```

## 步骤 2B：任意部署状态

运行一次：

```bash
node /absolute/path/to/glm-plan-deploy/scripts/plugin-cli.js status-arbitrary --json
```

脚本负责：
- 解析部署 API 基础 URL、认证令牌和设置路径
- 加载 `${ZAI_PROJECT_SETTINGS_PATH}`
- 查找最新的 `taskId`
- 调用 `GET /client/tcb/getTask`
- 返回带有预格式化 `summary` 的结构化 JSON

如果脚本返回 `noDeployment: true`，将其视为“未找到任意部署记录”，并继续到**步骤 3**。

## 步骤 3：展示结果

如果收集到了两种项目类型的结果，分别在单独标题下展示（例如 “Standard Deploy” 和 “Arbitrary Deploy”）。

对每个结果，检查状态：

**Success:** 在默认浏览器中打开部署 URL。

**Failed:** 向用户显示错误消息。如果提供了日志 URL，用默认浏览器打开。下载并分析部署日志和/或审计结果，以提供可执行反馈。

**Other status:** 向用户显示状态。
