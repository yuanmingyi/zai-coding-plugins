"use strict";

const { resolveDeployContext } = require("../common/auth");
const {
  isDeploymentNotFoundError,
  isTransientConnectivityError,
  requestJson,
} = require("../common/http");
const { normalizeAccessControl } = require("./accessControl");

async function runArbitraryPollTask(options = {}) {
  try {
    const context = resolveDeployContext(options);
    const taskId = options.taskId;
    if (!taskId) {
      return failure("Missing required polling input: `taskId`.");
    }

    const timeoutSeconds = Number(options.timeoutSeconds);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      return failure(
        "Missing required polling input: `timeoutSeconds` must be a positive number.",
      );
    }

    const pollIntervalMs = normalizePollInterval(options.pollIntervalMs);
    const sleepFn = options.sleepFn || defaultSleep;
    const nowFn = options.nowFn || Date.now;

    const startedAt = nowFn();
    const snapshots = [];
    let lastObserved = null;

    while (true) {
      let data;
      try {
        const response = await requestJson({
          url: `${context.baseUrl}/client/tcb/getTask?taskId=${encodeURIComponent(taskId)}`,
          token: context.token,
          fetchImpl: options.fetchImpl,
        });
        data = response.data || {};
      } catch (error) {
        if (isDeploymentNotFoundError(error)) {
          return finishPollResult(
            failure(
              `Deployment task no longer exists: ${taskId}`,
              apiFailureDetails(error),
            ),
            startedAt,
            nowFn(),
          );
        }
        // A transient pre-response connectivity blip (e.g. an undici
        // UND_ERR_CONNECT_TIMEOUT) is not a deploy failure — the task keeps
        // running server-side. Keep polling until the overall timeout
        // budget is exhausted instead of aborting on the first blip.
        if (isTransientConnectivityError(error)) {
          const currentTime = nowFn();
          if (currentTime - startedAt >= timeoutSeconds * 1000) {
            return finishPollResult(
              failure(
                `Deployment task polling timed out after ${timeoutSeconds}s.`,
                apiFailureDetails(error),
              ),
              startedAt,
              currentTime,
            );
          }
          await sleepFn(pollIntervalMs);
          continue;
        }
        return finishPollResult(
          failure(error.message, apiFailureDetails(error)),
          startedAt,
          nowFn(),
        );
      }

      const snapshot = snapshotTask(data);
      lastObserved = snapshot;
      if (!isSameSnapshot(snapshots[snapshots.length - 1], snapshot)) {
        snapshots.push(snapshot);
        await notifyStatusChange(options.onStatusChange, {
          taskId,
          projectId: data.projectId || null,
          ...snapshot,
        });
      }

      if (data.status === "Success" || data.status === "Failed") {
        return finishPollResult(
          {
            success: true,
            taskId,
            projectId: data.projectId || null,
            status: data.status,
            currentStep: data.currentStep || null,
            stepMessage: data.stepMessage || null,
            accessControl: normalizeAccessControl(data.accessControl),
            accessUrl: data.accessUrl || null,
            errorMessage: data.errorMessage || null,
            detailLog: data.detailLog || null,
            imageUri: data.imageUri || null,
            cnbBuildSn: data.cnbBuildSn || null,
            finishTime: data.finishTime || null,
            snapshots,
            summary: `Deployment task ${taskId} reached terminal state: ${data.status}`,
          },
          startedAt,
          nowFn(),
        );
      }

      const currentTime = nowFn();
      if (currentTime - startedAt >= timeoutSeconds * 1000) {
        return finishPollResult(
          {
            success: false,
            message: `Deployment task polling timed out after ${timeoutSeconds}s.`,
            summary: `Deployment task polling timed out after ${timeoutSeconds}s.`,
            lastObserved,
            snapshots,
          },
          startedAt,
          currentTime,
        );
      }

      await sleepFn(pollIntervalMs);
    }
  } catch (error) {
    return failure(error.message, apiFailureDetails(error));
  }
}

async function notifyStatusChange(callback, snapshot) {
  if (typeof callback !== "function") return;
  try {
    await callback(snapshot);
  } catch (_) {
    // Progress output must never change polling behavior.
  }
}

function finishPollResult(result, startedAt, finishedAt) {
  return {
    ...result,
    startedAt,
    finishedAt,
    elapsedSeconds: Math.max(0, Math.round((finishedAt - startedAt) / 1000)),
  };
}

function snapshotTask(data) {
  return {
    status: data.status || "Unknown",
    currentStep: data.currentStep || null,
    stepMessage: data.stepMessage || null,
  };
}

function isSameSnapshot(left, right) {
  return (
    left &&
    right &&
    left.status === right.status &&
    left.currentStep === right.currentStep &&
    left.stepMessage === right.stepMessage
  );
}

function normalizePollInterval(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval <= 0) {
    return 5000;
  }
  return interval;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  runArbitraryPollTask,
};
