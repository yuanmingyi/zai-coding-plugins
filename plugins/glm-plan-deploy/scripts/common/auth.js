"use strict";

const path = require("path");

const DEFAULT_DEPLOY_API_BASE = "https://open.bigmodel.cn/api/cc-deploy";
const AUTH_TOKEN_MESSAGE = [
  "❌ **Authentication token not configured**",
  "- The deployment API requires a Zhipu (智谱) API key for authentication.",
  "- Please set one of the following environment variables:",
  "  - `ZAI_API_TOKEN` — Zhipu deploy API token (preferred)",
  "  - `ANTHROPIC_AUTH_TOKEN` — Falls back to this if `ZAI_API_TOKEN` is not set",
  "- You can obtain your API key from https://open.bigmodel.cn",
].join("\n");

class AuthConfigurationError extends Error {
  constructor(message = AUTH_TOKEN_MESSAGE) {
    super(message);
    this.name = "AuthConfigurationError";
    this.code = "AUTH_TOKEN_MISSING";
    this.userMessage = AUTH_TOKEN_MESSAGE;
  }
}

function stripAnthropicSuffix(value) {
  return String(value || "").replace(/\/anthropic\/?$/, "");
}

function resolveDeployApiBase(env = process.env) {
  if (env.ZAI_API_BASE_URL) {
    return env.ZAI_API_BASE_URL;
  }

  if (env.ANTHROPIC_BASE_URL) {
    return `${stripAnthropicSuffix(env.ANTHROPIC_BASE_URL)}/cc-deploy`;
  }

  return DEFAULT_DEPLOY_API_BASE;
}

function resolveDeployApiToken(env = process.env) {
  return env.ZAI_API_TOKEN || env.ANTHROPIC_AUTH_TOKEN || "";
}

function resolveSettingsPath(filePath, cwd = process.cwd()) {
  if (!filePath) {
    return null;
  }

  return path.resolve(cwd, filePath);
}

function resolveDeployContext(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();

  return {
    cwd,
    baseUrl: resolveDeployApiBase(env),
    token: resolveDeployApiToken(env),
    projectSettingsPath: resolveSettingsPath(
      env.ZAI_PROJECT_SETTINGS_PATH || ".zai/deploy/tcb-settings.json",
      cwd,
    ),
    standardSettingsPath: resolveSettingsPath(
      env.ZAI_EO_SETTINGS_PATH || ".zai/deploy/settings.json",
      cwd,
    ),
  };
}

function assertDeployToken(token) {
  if (!token) {
    throw new AuthConfigurationError();
  }

  return token;
}

module.exports = {
  AUTH_TOKEN_MESSAGE,
  AuthConfigurationError,
  DEFAULT_DEPLOY_API_BASE,
  assertDeployToken,
  resolveDeployApiBase,
  resolveDeployApiToken,
  resolveDeployContext,
  stripAnthropicSuffix,
};
