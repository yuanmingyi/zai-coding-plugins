"use strict";

const path = require("path");

const {
  AuthConfigurationError,
  resolveDeployContext,
} = require("../common/auth");
const { formatArbitraryPreflightResult } = require("../common/format");
const { isProjectNotFoundError, requestJson } = require("../common/http");
const {
  loadArbitrarySettings,
  readJsonFile,
  removeFileIfExists,
  saveArbitrarySettings,
} = require("../common/settings");
const { normalizeAccessControl } = require("./accessControl");

const PROJECT_GONE_MESSAGE = [
  "❌ **Project no longer exists**",
  "- The previously configured project has been deleted or is invalid.",
  "- Local settings have been cleaned up.",
  "- Run `/glm-plan-deploy:deploy-arbitrary` to create a new deployment.",
].join("\n");

const FIRST_DEPLOY_NOTICE_NEW_ENV = [
  "ℹ️ First-time deploy detected: the platform will provision a CloudBase environment for this account before the build starts.",
  "This step can take several minutes; subsequent deploys reuse the same env and skip provisioning.",
].join(" ");

const FIRST_DEPLOY_NOTICE_PROVISIONING = [
  "ℹ️ A CloudBase environment for this account is still being provisioned by the platform.",
  "The deploy task will wait for it to reach `normal` status, which can take several minutes.",
].join(" ");

function buildStatusUrl(baseUrl, projectId) {
  const url = new URL(`${baseUrl}/client/tcb/status`);
  if (projectId) {
    url.searchParams.set("projectId", projectId);
  }
  return url.toString();
}

function parsePositiveNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Deploy API returned invalid \`${fieldName}\` config`);
  }
  return value;
}

function parseNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Deploy API returned invalid \`${fieldName}\` config`);
  }
  return value;
}

function normalizeEnvStatus(value) {
  return String(value || "").toLowerCase();
}

function formatEnvUnusableMessage(env, envStatus) {
  const lines = [
    "❌ **Deployment environment is not usable**",
    `- envStatus: \`${envStatus}\``,
    `- isReady: \`${String(env.isReady === true)}\``,
  ];
  if (env.errorMessage) {
    lines.push(`- errorMessage: ${env.errorMessage}`);
  }
  if (envStatus === "isolated") {
    lines.push(
      "- The CloudBase environment is isolated; contact support — it cannot be redeployed to.",
    );
  } else if (envStatus === "failed") {
    lines.push(
      "- The CloudBase environment failed to provision. Inspect the error message above and retry after the underlying issue is resolved.",
    );
  }
  return lines.join("\n");
}

function hasSettingsChanged(rawSettings, nextSettings) {
  const left = rawSettings == null ? null : JSON.stringify(rawSettings);
  const right = nextSettings == null ? null : JSON.stringify(nextSettings);
  return left !== right;
}

async function runArbitraryPreflight(options = {}) {
  const context = resolveDeployContext(options);

  try {
    const rawSettings = readJsonFile(context.projectSettingsPath);
    const settings = loadArbitrarySettings(context.projectSettingsPath, {
      cwd: context.cwd,
      projectName: path.basename(context.cwd),
      endpoint: context.baseUrl,
    });

    if (rawSettings && hasSettingsChanged(rawSettings, settings)) {
      saveArbitrarySettings(context.projectSettingsPath, settings);
    }

    const projectId = options.projectId || settings.projectId || null;

    let response;
    try {
      response = await requestJson({
        url: buildStatusUrl(context.baseUrl, projectId),
        token: context.token,
        fetchImpl: options.fetchImpl,
      });
    } catch (error) {
      if (projectId && isProjectNotFoundError(error)) {
        removeFileIfExists(context.projectSettingsPath);
        return failure(PROJECT_GONE_MESSAGE);
      }
      throw error;
    }

    const data = response.data || {};
    const config = data.config || {};
    const timeoutSeconds = parsePositiveNumber(config.timeout, "timeout");
    const maxRetries = parseNonNegativeInteger(config.retryTimes, "retryTimes");
    const uploadSizeLimit = parsePositiveNumber(
      config.uploadSizeLimit,
      "uploadSizeLimit",
    );
    const env = data.env || {};
    const project = data.project || null;
    const envStatus = normalizeEnvStatus(env.envStatus);

    if (envStatus === "failed" || envStatus === "isolated") {
      return failure(formatEnvUnusableMessage(env, envStatus));
    }

    if (projectId) {
      // The customer had a project recorded locally. If the server no longer
      // knows about it, clean up and stop so the next run starts fresh.
      if (!project || project.projectId == null) {
        removeFileIfExists(context.projectSettingsPath);
        return failure(PROJECT_GONE_MESSAGE);
      }

      const nextSettings = {
        ...settings,
        projectId: project.projectId || settings.projectId,
      };
      if (
        hasSettingsChanged(
          readJsonFile(context.projectSettingsPath),
          nextSettings,
        )
      ) {
        saveArbitrarySettings(context.projectSettingsPath, nextSettings);
      }
    }

    let firstDeployNotice = null;
    if (envStatus === "not_initialized") {
      firstDeployNotice = FIRST_DEPLOY_NOTICE_NEW_ENV;
    } else if (envStatus === "creating") {
      firstDeployNotice = FIRST_DEPLOY_NOTICE_PROVISIONING;
    }

    const result = {
      success: true,
      projectId: (project && project.projectId) || projectId,
      envStatus,
      // Per spec, isReady is true iff envStatus === "normal". Enforce that
      // invariant locally so a buggy server response can't lie to the agent.
      envReady: envStatus === "normal" && env.isReady === true,
      firstDeployNotice,
      timeoutSeconds,
      maxRetries,
      uploadSizeLimit,
      accessControl: normalizeAccessControl(data.accessControl),
      databaseCapabilities: data.database || null,
    };
    result.summary = formatArbitraryPreflightResult(result);
    return result;
  } catch (error) {
    let message;
    if (error instanceof AuthConfigurationError && error.userMessage) {
      message = error.userMessage;
    } else if (error instanceof SyntaxError) {
      message = `Invalid deploy settings file: ${context.projectSettingsPath}`;
    } else {
      message = error.message;
    }
    return failure(message, apiFailureDetails(error));
  }
}

function apiFailureDetails(error) {
  if (!error || !error.apiRecord) return {};
  return {
    apiRecord: error.apiRecord,
    apiRecords: [error.apiRecord],
  };
}

function failure(message, extra = {}) {
  return {
    success: false,
    message,
    summary: message,
    ...extra,
  };
}

module.exports = {
  FIRST_DEPLOY_NOTICE_NEW_ENV,
  FIRST_DEPLOY_NOTICE_PROVISIONING,
  PROJECT_GONE_MESSAGE,
  runArbitraryPreflight,
};
