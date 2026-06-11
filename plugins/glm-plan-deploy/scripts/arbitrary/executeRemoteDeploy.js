"use strict";

const { runArbitraryClassifyFailure } = require("./classifyFailure");
const {
  collectClaudeLogPaths: defaultCollectClaudeLogPaths,
  formatDebugLogsFallback,
} = require("./claudeLogPaths");
const { runArbitraryControllerDeploy } = require("./controllerDeploy");
const { runFormatArbitraryDeployReport } = require("./formatDeployReport");
const { runArbitraryPackageProject } = require("./packageProject");
const { runArbitraryPollTask } = require("./pollTask");
const { withTiming } = require("./prepareLocal");
const { runArbitraryVerifyAccessUrl } = require("./verifyAccessUrl");

async function runArbitraryExecuteRemoteDeploy(options = {}) {
  const localElapsedSeconds =
    options.localElapsedSeconds != null
      ? Number(options.localElapsedSeconds) || null
      : null;

  const packageProjectImpl =
    options.packageProjectImpl || runArbitraryPackageProject;
  const classifyFailureImpl =
    options.classifyFailureImpl || runArbitraryClassifyFailure;
  const controllerDeployImpl =
    options.controllerDeployImpl || runArbitraryControllerDeploy;
  const pollTaskImpl = options.pollTaskImpl || runArbitraryPollTask;
  const verifyAccessUrlImpl =
    options.verifyAccessUrlImpl || runArbitraryVerifyAccessUrl;
  const formatReportImpl =
    options.formatReportImpl || runFormatArbitraryDeployReport;
  const collectClaudeLogPathsImpl =
    options.collectClaudeLogPathsImpl || defaultCollectClaudeLogPaths;

  const claudeLogPaths = collectClaudeLogPathsImpl({
    cwd: options.cwd,
    env: options.env,
  });

  const nowFn = options.nowFn || Date.now;
  const startedAt = nowFn();

  const packageResult = await packageProjectImpl({
    cwd: options.cwd,
    agentWorkDir: options.agentWorkDir,
    serviceRoot: options.serviceRoot,
  });
  if (!packageResult.success) {
    const classification = await classifyKnownPackageFailure(
      classifyFailureImpl,
      packageResult,
    );
    return await attachFinalReport(
      withTiming(
        failure("packageProject", packageResult.message, {
          summary: packageResult.summary || packageResult.message,
          classification,
          packageResult,
        }),
        startedAt,
        nowFn,
      ),
      localElapsedSeconds,
      claudeLogPaths,
      formatReportImpl,
    );
  }

  const controllerResult = await controllerDeployImpl({
    cwd: options.cwd,
    env: options.env,
    fetchImpl: options.fetchImpl,
    now: options.now,
    area: options.area,
    packageDir: packageResult.packageDir,
    uploadSizeLimit: options.uploadSizeLimit,
    appName: options.appName,
    projectId: options.projectId,
    database: options.database,
    databaseBindings: options.databaseBindings,
  });
  if (!controllerResult.success) {
    const stage = controllerResult.stage || "initUpload";
    return await attachFinalReport(
      withTiming(
        failure(stage, controllerResult.message, {
          summary: controllerResult.summary || controllerResult.message,
          classification: failClosedHelperClassification(
            stage,
            controllerResult.message,
            controllerResult.classification,
          ),
          packageDir: packageResult.packageDir,
          apiRecords: controllerResult.apiRecords || [],
          apiRecord:
            controllerResult.apiRecord ||
            last(controllerResult.apiRecords || []),
          packageResult,
          controllerResult,
        }),
        startedAt,
        nowFn,
      ),
      localElapsedSeconds,
      claudeLogPaths,
      formatReportImpl,
    );
  }

  await notifyTaskCreated(options.onTaskCreated, controllerResult);

  const pollResult = await pollTaskImpl({
    cwd: options.cwd,
    env: options.env,
    fetchImpl: options.fetchImpl,
    taskId: controllerResult.taskId,
    timeoutSeconds: options.timeoutSeconds,
    pollIntervalMs: options.pollIntervalMs,
    sleepFn: options.sleepFn,
    nowFn: options.nowFn,
    onStatusChange: options.onTaskStatusChange,
  });
  const pollElapsedSeconds = normalizeDuration(pollResult.elapsedSeconds);
  const accessControl =
    pollResult.accessControl || controllerResult.accessControl || null;
  if (!pollResult.success) {
    return await attachFinalReport(
      withTiming(
        failure("pollTask", pollResult.message, {
          summary: pollResult.summary || pollResult.message,
          classification: failClosedHelperClassification(
            "pollTask",
            pollResult.message,
            pollResult.classification,
          ),
          packageDir: packageResult.packageDir,
          uploadedFiles: controllerResult.uploadedFiles || [],
          taskId: controllerResult.taskId,
          projectId: controllerResult.projectId || null,
          accessControl,
          snapshots: pollResult.snapshots || [],
          lastObserved: pollResult.lastObserved || null,
          pollElapsedSeconds,
          apiRecords: pollResult.apiRecords || [],
          apiRecord: pollResult.apiRecord || last(pollResult.apiRecords || []),
          packageResult,
          controllerResult,
          pollResult,
        }),
        startedAt,
        nowFn,
      ),
      localElapsedSeconds,
      claudeLogPaths,
      formatReportImpl,
    );
  }

  if (pollResult.status === "Failed") {
    const classification = await classifyFailureImpl({
      errorMessage: pollResult.errorMessage || null,
      stepMessage: pollResult.stepMessage || null,
      detailLog: pollResult.detailLog || null,
    });
    const platformException = extractTencentCloudException(
      pollResult.detailLog,
    );
    const message = formatPollFailureReason({
      pollResult,
      controllerResult,
      classification,
      platformException,
    });
    const summary = formatPollFailureAction({
      pollResult,
      controllerResult,
      classification,
      platformException,
    });
    return await attachFinalReport(
      withTiming(
        failure("pollTask", message, {
          summary,
          packageDir: packageResult.packageDir,
          uploadedFiles: controllerResult.uploadedFiles || [],
          taskId: pollResult.taskId || controllerResult.taskId,
          projectId: pollResult.projectId || controllerResult.projectId || null,
          status: pollResult.status,
          currentStep: pollResult.currentStep || null,
          stepMessage: pollResult.stepMessage || null,
          errorMessage: pollResult.errorMessage || null,
          detailLog: pollResult.detailLog || null,
          imageUri: pollResult.imageUri || null,
          cnbBuildSn: pollResult.cnbBuildSn || null,
          accessControl,
          finishTime: pollResult.finishTime || null,
          snapshots: pollResult.snapshots || [],
          pollElapsedSeconds,
          classification,
          platformException,
          packageResult,
          controllerResult,
          pollResult,
        }),
        startedAt,
        nowFn,
      ),
      localElapsedSeconds,
      claudeLogPaths,
      formatReportImpl,
    );
  }

  const verifyResult = await verifyAccessUrlImpl({
    accessUrl: pollResult.accessUrl,
    accessControl,
    fetchImpl: options.verifyFetchImpl || options.fetchImpl,
  });
  if (!verifyResult.success) {
    if (!isInconclusiveVerificationFailure(pollResult, verifyResult)) {
      return await attachFinalReport(
        withTiming(
          failure("verifyAccessUrl", verifyResult.message, {
            summary: verifyResult.summary || verifyResult.message,
            classification: failClosedHelperClassification(
              "verifyAccessUrl",
              verifyResult.message,
              verifyResult.classification,
            ),
            packageDir: packageResult.packageDir,
            uploadedFiles: controllerResult.uploadedFiles || [],
            taskId: pollResult.taskId || controllerResult.taskId,
            projectId:
              pollResult.projectId || controllerResult.projectId || null,
            accessUrl: pollResult.accessUrl || null,
            accessControl,
            verificationStatus: verifyResult.status || null,
            verificationBody: verifyResult.body || null,
            usedDiagnosticRequest: Boolean(verifyResult.usedDiagnosticRequest),
            snapshots: pollResult.snapshots || [],
            pollElapsedSeconds,
            packageResult,
            controllerResult,
            pollResult,
            verifyResult,
          }),
          startedAt,
          nowFn,
        ),
        localElapsedSeconds,
        claudeLogPaths,
        formatReportImpl,
      );
    }

    return await attachFinalReport(
      withTiming(
        {
          success: true,
          stage: "completed",
          packageDir: packageResult.packageDir,
          uploadedFiles: controllerResult.uploadedFiles || [],
          taskId: pollResult.taskId || controllerResult.taskId,
          projectId: pollResult.projectId || controllerResult.projectId || null,
          status: pollResult.status,
          currentStep: pollResult.currentStep || null,
          stepMessage: pollResult.stepMessage || null,
          accessUrl: pollResult.accessUrl || null,
          accessControl,
          verificationStatus: verifyResult.status || null,
          verificationError:
            verifyResult.message || verifyResult.summary || "Unknown error",
          verified: false,
          usedDiagnosticRequest: Boolean(verifyResult.usedDiagnosticRequest),
          expectedAccessDenied: false,
          snapshots: pollResult.snapshots || [],
          pollElapsedSeconds,
          summary: formatSuccessSummary({
            taskId: pollResult.taskId || controllerResult.taskId,
            verifyResult,
          }),
          verificationClassification: verifyResult.classification || null,
          packageResult,
          controllerResult,
          pollResult,
          verifyResult,
        },
        startedAt,
        nowFn,
      ),
      localElapsedSeconds,
      claudeLogPaths,
      formatReportImpl,
    );
  }

  if (!verifyResult.verified) {
    const classification = await classifyFailureImpl({
      verificationBody: verifyResult.body || null,
    });
    return await attachFinalReport(
      withTiming(
        failure("verifyAccessUrl", verifyResult.summary, {
          summary: verifyResult.summary,
          packageDir: packageResult.packageDir,
          uploadedFiles: controllerResult.uploadedFiles || [],
          taskId: pollResult.taskId || controllerResult.taskId,
          projectId: pollResult.projectId || controllerResult.projectId || null,
          status: pollResult.status,
          currentStep: pollResult.currentStep || null,
          stepMessage: pollResult.stepMessage || null,
          accessUrl: pollResult.accessUrl || null,
          accessControl,
          verificationStatus: verifyResult.status || null,
          verificationBody: verifyResult.body || null,
          usedDiagnosticRequest: Boolean(verifyResult.usedDiagnosticRequest),
          snapshots: pollResult.snapshots || [],
          pollElapsedSeconds,
          classification,
          packageResult,
          controllerResult,
          pollResult,
          verifyResult,
        }),
        startedAt,
        nowFn,
      ),
      localElapsedSeconds,
      claudeLogPaths,
      formatReportImpl,
    );
  }

  return await attachFinalReport(
    withTiming(
      {
        success: true,
        stage: "completed",
        packageDir: packageResult.packageDir,
        uploadedFiles: controllerResult.uploadedFiles || [],
        taskId: pollResult.taskId || controllerResult.taskId,
        projectId: pollResult.projectId || controllerResult.projectId || null,
        status: pollResult.status,
        currentStep: pollResult.currentStep || null,
        stepMessage: pollResult.stepMessage || null,
        accessUrl: pollResult.accessUrl || null,
        accessControl,
        snapshots: pollResult.snapshots || [],
        pollElapsedSeconds,
        verificationStatus: verifyResult.status || null,
        usedDiagnosticRequest: Boolean(verifyResult.usedDiagnosticRequest),
        expectedAccessDenied: Boolean(verifyResult.expectedAccessDenied),
        summary: formatSuccessSummary({
          taskId: pollResult.taskId || controllerResult.taskId,
          verifyResult,
        }),
      },
      startedAt,
      nowFn,
    ),
    localElapsedSeconds,
    claudeLogPaths,
    formatReportImpl,
  );
}

async function notifyTaskCreated(callback, controllerResult) {
  if (typeof callback !== "function") return;
  try {
    await callback({
      taskId: controllerResult.taskId || null,
      projectId: controllerResult.projectId || null,
      status: controllerResult.status || null,
      currentStep: controllerResult.currentStep || null,
      stepMessage: controllerResult.stepMessage || null,
      accessControl: controllerResult.accessControl || null,
    });
  } catch (_) {
    // Progress output must never change deploy behavior.
  }
}

async function classifyKnownPackageFailure(classifyFailureImpl, packageResult) {
  const classification = await classifyFailureImpl({
    detailLog: packageResult.message || packageResult.summary || "",
  });
  if (
    !classification ||
    classification.success !== true ||
    classification.category === "UNKNOWN_FAILURE"
  ) {
    return terminalHelperFailureClassification(
      "packageProject",
      packageResult.message || packageResult.summary,
    );
  }
  return classification;
}

function failClosedHelperClassification(stage, message, classification) {
  if (
    classification &&
    classification.success === true &&
    classification.category !== "UNKNOWN_FAILURE"
  ) {
    return classification;
  }
  return terminalHelperFailureClassification(stage, message);
}

function last(items) {
  return items.length ? items[items.length - 1] : null;
}

function terminalHelperFailureClassification(stage, message) {
  return {
    success: true,
    retryable: false,
    category: "REMOTE_HELPER_TERMINAL_FAILURE",
    reason: message || null,
    suggestedFix: `Relay the returned finalReport and stop. The ${stage} helper failure is terminal unless a future scripted result explicitly sets classification.retryable === true; do not run prompt-level curl, env, token, DNS, proxy, fetch, or direct API diagnostics.`,
  };
}

function formatPollFailureReason({
  pollResult,
  controllerResult,
  classification,
  platformException,
}) {
  if (
    classification &&
    classification.category === "REMOTE_FUNCTION_CREATING"
  ) {
    const code =
      platformException && platformException.code
        ? ` (code=${platformException.code})`
        : "";
    return `CloudBase function update was rejected because the SCF function is still Creating${code}.`;
  }

  return (
    pollResult.errorMessage ||
    pollResult.stepMessage ||
    `Deployment task ${pollResult.taskId || controllerResult.taskId} failed.`
  );
}

function formatPollFailureAction({
  pollResult,
  controllerResult,
  classification,
  platformException,
}) {
  const parts = [];
  parts.push(
    pollResult.summary ||
      `Deployment task ${pollResult.taskId || controllerResult.taskId} reached terminal state: ${pollResult.status || "Failed"}`,
  );
  if (
    classification &&
    classification.category !== "UNKNOWN_FAILURE" &&
    classification.suggestedFix
  ) {
    parts.push(classification.suggestedFix);
  }
  if (platformException && platformException.requestId) {
    parts.push(`Tencent requestId=${platformException.requestId}.`);
  }
  return parts.join(" ");
}

function extractTencentCloudException(detailLog) {
  if (typeof detailLog !== "string" || !detailLog) return null;
  const match = detailLog.match(
    /TencentCloudApiException:\s*([^\[]+?)\s*\[([^\]]+)\]/,
  );
  if (!match) return null;
  const metadata = {};
  for (const part of match[2].split(",")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    const key = rawKey && rawKey.trim();
    const value = rawValue.join("=").trim();
    if (key) metadata[key] = value;
  }
  return {
    message: match[1].trim(),
    service: metadata.service || null,
    action: metadata.action || null,
    region: metadata.region || null,
    code: metadata.code || null,
    requestId: metadata.requestId || null,
  };
}

function normalizeDuration(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

function formatSuccessSummary({ taskId, verifyResult }) {
  const parts = [
    `Remote deployment completed successfully for task ${taskId}.`,
  ];
  if (verifyResult && verifyResult.expectedAccessDenied) {
    parts.push(
      "Access URL is restricted and returned the expected denied status from this IP.",
    );
  } else if (verifyResult && verifyResult.success === false) {
    parts.push(
      `Access URL verification did not complete: ${
        verifyResult.message ||
        verifyResult.summary ||
        "unknown verification error"
      }.`,
    );
  }
  return parts.join(" ");
}

function isInconclusiveVerificationFailure(pollResult, verifyResult) {
  return Boolean(
    pollResult &&
    pollResult.accessUrl &&
    verifyResult &&
    verifyResult.requestAttempted === true,
  );
}

function failure(stage, message, extra = {}) {
  return {
    success: false,
    stage,
    message,
    summary: extra.summary || message,
    ...extra,
  };
}

function shouldEmitFinalReport(result) {
  if (result.success) return true;
  // Retryable failures should not emit finalReport
  if (result.classification && result.classification.retryable === true)
    return false;
  // Non-retryable or unclassified failures: emit
  return true;
}

async function attachFinalReport(
  result,
  localElapsedSeconds,
  claudeLogPaths = null,
  formatReportImpl = runFormatArbitraryDeployReport,
) {
  if (!shouldEmitFinalReport(result)) return result;
  const reportOptions = result.success
    ? {
        outcome: "success",
        accessUrl: result.accessUrl || "unknown",
        projectId: result.projectId || null,
        taskId: result.taskId || null,
        localSeconds: localElapsedSeconds != null ? localElapsedSeconds : null,
        remoteSeconds: result.elapsedSeconds,
        pollSeconds: result.pollElapsedSeconds,
        totalSeconds: (localElapsedSeconds || 0) + (result.elapsedSeconds || 0),
        expectedAccessDenied: result.expectedAccessDenied === true,
        verificationStatus: result.verificationStatus || null,
        verificationError: result.verificationError || null,
        claudeLogPaths,
      }
    : {
        outcome: "failure",
        stage: result.stage,
        reason: result.message || result.summary || "Unknown failure",
        action:
          result.summary || result.message || "Review the error and try again.",
        projectId: result.projectId || null,
        taskId: result.taskId || null,
        localSeconds: localElapsedSeconds != null ? localElapsedSeconds : null,
        remoteSeconds: result.elapsedSeconds,
        pollSeconds: result.pollElapsedSeconds,
        totalSeconds: (localElapsedSeconds || 0) + (result.elapsedSeconds || 0),
        claudeLogPaths,
      };
  try {
    const reportResult = await formatReportImpl(reportOptions);
    if (reportResult.success) {
      return { ...result, finalReport: reportResult.report };
    }
  } catch (_) {
    // formatter error — fall through to the debugLogs fallback below.
  }
  // Either the formatter threw or returned success:false. The user still
  // needs to know where the Claude session logs live when ZAI_DEPLOY_DEBUG=1.
  const debugLogs = formatDebugLogsFallback(claudeLogPaths);
  if (debugLogs) {
    return { ...result, debugLogs };
  }
  return result;
}

module.exports = {
  runArbitraryExecuteRemoteDeploy,
};
