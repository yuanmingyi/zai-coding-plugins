"use strict";

const path = require("path");

const {
  AuthConfigurationError,
  resolveDeployContext,
} = require("../common/auth");
const { formatArbitraryStatusResult } = require("../common/format");
const {
  getLatestTaskId,
  loadArbitrarySettings,
  saveArbitrarySettings,
} = require("../common/settings");
const { isDeploymentNotFoundError, requestJson } = require("../common/http");
const { normalizeAccessControl } = require("../arbitrary/accessControl");

async function runStatusArbitrary(options = {}) {
  const context = resolveDeployContext(options);

  try {
    const settings = loadArbitrarySettings(context.projectSettingsPath, {
      cwd: context.cwd,
      projectName: path.basename(context.cwd),
      endpoint: context.baseUrl,
    });

    const taskId = getLatestTaskId(settings);
    if (!taskId) {
      const result = {
        success: true,
        noDeployment: true,
      };
      result.summary = formatArbitraryStatusResult(result);
      return result;
    }

    const response = await requestJson({
      url: `${context.baseUrl}/client/tcb/getTask?taskId=${encodeURIComponent(taskId)}`,
      token: context.token,
      fetchImpl: options.fetchImpl,
    });

    const data = response.data || {};
    const result = {
      success: true,
      taskId,
      status: data.status || "Unknown",
      currentStep: data.currentStep || null,
      stepMessage: data.stepMessage || null,
      accessUrl: data.accessUrl || null,
      accessControl: normalizeAccessControl(data.accessControl),
      errorMessage: data.errorMessage || null,
      detailLog: data.detailLog || null,
      startTime: data.startTime || null,
      finishTime: data.finishTime || null,
    };
    result.summary = formatArbitraryStatusResult(result);
    return result;
  } catch (error) {
    if (isDeploymentNotFoundError(error)) {
      const settings = loadArbitrarySettings(context.projectSettingsPath, {
        cwd: context.cwd,
        projectName: path.basename(context.cwd),
        endpoint: context.baseUrl,
      });
      const staleTaskId = getLatestTaskId(settings);
      if (staleTaskId) {
        settings.deployments = (settings.deployments || []).filter(
          (item) => item.taskId !== staleTaskId,
        );
        saveArbitrarySettings(context.projectSettingsPath, settings);
      }

      const result = {
        success: true,
        noDeployment: true,
      };
      result.summary = formatArbitraryStatusResult(result);
      return result;
    }

    const message =
      error instanceof AuthConfigurationError && error.userMessage
        ? error.userMessage
        : error.message;

    return {
      success: false,
      message,
      summary: message,
    };
  }
}

module.exports = {
  runStatusArbitrary,
};
