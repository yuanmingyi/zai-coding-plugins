# Z.ai Coding Plugins Marketplace

[中文文档](./README_CN.md)

A collection of plugins to enhance coding productivity and provide GLM Coding Plan relate service for Claude Code.

## Available Plugins

| Plugin | Description                                              | Command |
|--------|----------------------------------------------------------|---------|
| **glm-plan-usage** | Query quota and usage statistics for GLM Coding Plan     | `/glm-plan-usage:usage-query` |
| **glm-plan-bug** | Submit case feedback and bug reports for GLM Coding Plan | `/glm-plan-bug:case-feedback` |
| **glm-plan-deploy** | Quick deploy current project for GLM Coding Plan users | `/glm-plan-deploy:deploy-arbitrary` |

## Prerequisites

- Node.js 18 or higher
- Install Claude Code CLI

## Quick Start

### Install the marketplace within Claude Code to access the plugins.

1. Install the Marketplace

```shell
claude plugin marketplace add yuanmingyi/zai-coding-plugins
```

2. Install Plugins from the Marketplace

```shell
claude plugin install glm-plan-usage@zai-coding-plugins
```

```shell
claude plugin install glm-plan-bug@zai-coding-plugins
```

```shell
claude plugin install glm-plan-deploy@zai-coding-plugins
```

### Using the Plugins

1. Navigate to your project and start Claude Code:

```bash
claude
```

2. Use the installed plugins with the following commands:

```bash
/glm-plan-usage:usage-query
```

```bash
/glm-plan-bug:case-feedback Your feedback message here
```

```bash
/glm-plan-deploy:deploy-arbitrary
```

```bash
/glm-plan-deploy:status

```bash
/glm-plan-deploy:delete-project
```

## Usage Examples

### Query GLM Coding Plan Usage Statistics

Check your current quota and usage:

```bash
/glm-plan-usage:usage-query
```

### Submit GLM Coding Plan Feedback

Report issues or provide feedback:

```bash
/glm-plan-bug:case-feedback I have an issue with my plan
```

### Deploy the project to cloud

Deploy the current folder to cloud with one command：

```bash
/glm-plan-deploy:deploy-arbitrary
```

Query the result of the last deployment for the current project:

```bash
/glm-plan-deploy:status
```

Delete the deployed project in the cloud

```base
/glm-plan-deploy:delete-project
```

## Contributing

We welcome contributions! Please feel free to submit issues or pull requests.

## License

Apache License 2.0