"use strict";

const {
  collectClaudeLogPaths: defaultCollectClaudeLogPaths,
  formatDebugLogsFallback,
} = require("./claudeLogPaths");
const { runFormatArbitraryDeployReport } = require("./formatDeployReport");
const { runDeployDatabaseSync } = require("./databaseDeploySync");
const { runArbitraryExecuteRemoteDeploy } = require("./executeRemoteDeploy");
const { runArbitraryPrepareLocal } = require("./prepareLocal");

const MAX_REPORT_TIMING_PASSES = 5;

async function runArbitraryDeploy(options = {}) {
  const nowFn = options.nowFn || Date.now;
  const startedAt = nowFn();

  const prepareLocalImpl = options.prepareLocalImpl || runArbitraryPrepareLocal;
  const remoteDeployImpl =
    options.remoteDeployImpl || runArbitraryExecuteRemoteDeploy;
  const databaseSyncImpl = options.databaseSyncImpl || runDeployDatabaseSync;
  const formatReportImpl =
    options.formatReportImpl || runFormatArbitraryDeployReport;

  const prepareResult = await prepareLocalImpl({
    cwd: options.cwd,
    env: options.env,
    path: options.path,
    language: options.language,
    version: options.version,
    serviceRoot: options.serviceRoot,
    buildCommand: options.buildCommand,
    output: options.output,
    startCommand: options.startCommand,
    runtimeKind: options.runtimeKind,
    framework: options.framework,
    staticIndexFile: options.staticIndexFile,
    databaseMode: options.databaseMode,
    databaseType: options.databaseType,
    agentWorkDir: options.agentWorkDir,
    appName: options.appName,
    fetchImpl: options.fetchImpl,
    execImpl: options.execImpl,
    pid: options.pid,
    nowFn: options.nowFn,
  });

  const collectClaudeLogPathsImpl =
    options.collectClaudeLogPathsImpl || defaultCollectClaudeLogPaths;
  const claudeLogPaths = collectClaudeLogPathsImpl({
    cwd: options.cwd,
    env: options.env,
  });

  // Surface the first-deploy notice on stderr BEFORE remoteDeploy starts so
  // the user sees the multi-minute provisioning warning ahead of the blocking
  // createTask call.
  if (
    prepareResult.success &&
    !prepareResult.needsUserInput &&
    prepareResult.stage === "completed" &&
    prepareResult.firstDeployNotice
  ) {
    const noticeStream = options.noticeStream || process.stderr;
    try {
      noticeStream.write(
        `[deploy-notice] ${prepareResult.firstDeployNotice}\n`,
      );
    } catch (_) {
      // Broken stream: proceed; the notice is also in the final report.
    }
  }

  if (
    !prepareResult.success ||
    prepareResult.needsUserInput ||
    prepareResult.stage !== "completed"
  ) {
    return finishDeployResult({
      result: prepareResult,
      startedAt,
      nowFn,
      localElapsedSeconds: normalizeDuration(prepareResult.elapsedSeconds),
      remoteElapsedSeconds: null,
      formatReportImpl,
      claudeLogPaths,
    });
  }

  const detectedConfig = prepareResult.detectedConfig || {};
  const localElapsedSeconds = normalizeDuration(prepareResult.elapsedSeconds);
  const databaseSyncResult = await databaseSyncImpl({
    cwd: options.cwd,
    env: options.env,
    fetchImpl: options.fetchImpl,
    appName: options.appName,
    projectId: prepareResult.projectId || null,
    database: prepareResult.database || detectedConfig.database || null,
    databaseBindings: prepareResult.databaseBindings || [],
    databaseSync: options.databaseSync,
    databaseSyncConfirm: options.databaseSyncConfirm,
    databaseBindingId: options.databaseBindingId,
    framework: options.databaseFramework,
    migrationCommand: options.databaseMigrationCommand,
    detectedConfig,
    serviceRoot: detectedConfig.serviceRoot,
    agentWorkDir: prepareResult.agentWorkDir,
    nowFn: options.nowFn,
    sleepFn: options.sleepFn,
  });
  if (
    !databaseSyncResult.success ||
    databaseSyncResult.needsUserInput ||
    databaseSyncResult.stage !== "completed"
  ) {
    return finishDeployResult({
      result: {
        ...databaseSyncResult,
        detectedConfig,
        agentWorkDir: prepareResult.agentWorkDir,
      },
      startedAt,
      nowFn,
      localElapsedSeconds,
      remoteElapsedSeconds: null,
      formatReportImpl,
      claudeLogPaths,
    });
  }

  const databaseForDeploy = mergeDatabaseSyncState(
    prepareResult.database || detectedConfig.database || null,
    databaseSyncResult,
  );
  const remoteResult = await remoteDeployImpl({
    cwd: options.cwd,
    env: options.env,
    fetchImpl: options.fetchImpl,
    verifyFetchImpl: options.verifyFetchImpl,
    now: options.now,
    nowFn: options.nowFn,
    area: options.area,
    agentWorkDir: prepareResult.agentWorkDir,
    serviceRoot: detectedConfig.serviceRoot,
    uploadSizeLimit: prepareResult.uploadSizeLimit,
    timeoutSeconds: prepareResult.timeoutSeconds,
    pollIntervalMs: options.pollIntervalMs,
    sleepFn: options.sleepFn,
    appName: options.appName,
    projectId: databaseSyncResult.projectId || prepareResult.projectId || null,
    database: databaseForDeploy,
    databaseBindings: prepareResult.databaseBindings || [],
    localElapsedSeconds,
    onTaskCreated: options.onTaskCreated,
    onTaskStatusChange: options.onTaskStatusChange,
  });

  const enrichedRemoteResult = mergePrepareEvidence(
    remoteResult,
    prepareResult,
  );

  return finishDeployResult({
    result: enrichedRemoteResult,
    startedAt,
    nowFn,
    localElapsedSeconds,
    remoteElapsedSeconds: normalizeDuration(remoteResult.elapsedSeconds),
    formatReportImpl,
    claudeLogPaths,
  });
}

function mergeDatabaseSyncState(database, databaseSyncResult) {
  if (!database || !databaseSyncResult) {
    return database || null;
  }
  if (
    !databaseSyncResult.recordMigrationFingerprint ||
    !databaseSyncResult.migrationFingerprint
  ) {
    return database;
  }
  return {
    ...database,
    migrationFingerprint: databaseSyncResult.migrationFingerprint,
    lastMigrationSyncAction: databaseSyncResult.action || null,
  };
}

function mergePrepareEvidence(remoteResult, prepareResult) {
  if (!remoteResult || typeof remoteResult !== "object") return remoteResult;
  const merged = { ...remoteResult };
  if (
    merged.detectedConfig == null &&
    prepareResult &&
    prepareResult.detectedConfig
  ) {
    merged.detectedConfig = prepareResult.detectedConfig;
  }
  if (
    merged.agentWorkDir == null &&
    prepareResult &&
    prepareResult.agentWorkDir
  ) {
    merged.agentWorkDir = prepareResult.agentWorkDir;
  }
  return merged;
}

async function finishDeployResult({
  result,
  startedAt,
  nowFn,
  localElapsedSeconds,
  remoteElapsedSeconds,
  formatReportImpl,
  claudeLogPaths = null,
}) {
  const finishedAt = nowFn();
  const elapsedSeconds = elapsedSecondsBetween(startedAt, finishedAt);
  let timedResult = {
    ...result,
    startedAt,
    finishedAt,
    elapsedSeconds,
    localElapsedSeconds,
    remoteElapsedSeconds,
  };

  if (!shouldEmitFinalReport(timedResult)) {
    return timedResult;
  }

  let reportResult;
  let formatterThrew = false;
  // Re-render the report until the total wall-clock seconds stop changing
  // (the formatter itself takes time; re-running with the refreshed total
  // keeps the displayed Total accurate).
  for (let pass = 0; pass < MAX_REPORT_TIMING_PASSES; pass += 1) {
    try {
      reportResult = await formatReportImpl(
        buildReportOptions(timedResult, claudeLogPaths),
      );
    } catch (_) {
      formatterThrew = true;
      break;
    }
    const nextFinishedAt = nowFn();
    const nextElapsedSeconds = elapsedSecondsBetween(startedAt, nextFinishedAt);
    if (
      nextFinishedAt === timedResult.finishedAt &&
      nextElapsedSeconds === timedResult.elapsedSeconds
    ) {
      break;
    }
    timedResult = {
      ...timedResult,
      finishedAt: nextFinishedAt,
      elapsedSeconds: nextElapsedSeconds,
    };
  }

  if (formatterThrew || !reportResult || !reportResult.success) {
    return withDebugLogsFallback(timedResult, claudeLogPaths);
  }

  return {
    ...timedResult,
    finalReport: reportResult.report,
  };
}

function withDebugLogsFallback(result, claudeLogPaths) {
  const debugLogs = formatDebugLogsFallback(claudeLogPaths);
  if (debugLogs) {
    return { ...result, debugLogs };
  }
  return result;
}

function shouldEmitFinalReport(result) {
  if (result.success === true) {
    return result.needsUserInput !== true && result.stage === "completed";
  }
  if (result.classification && result.classification.retryable === true) {
    return false;
  }
  return result.success === false;
}

function buildReportOptions(result, claudeLogPaths = null) {
  if (result.success) {
    return {
      outcome: "success",
      accessUrl: result.accessUrl || "unknown",
      projectId: result.projectId,
      taskId: result.taskId,
      localSeconds: result.localElapsedSeconds,
      remoteSeconds: result.remoteElapsedSeconds,
      pollSeconds: result.pollElapsedSeconds,
      totalSeconds: result.elapsedSeconds,
      claudeLogPaths,
    };
  }

  return {
    outcome: "failure",
    stage: result.stage,
    reason: result.message || result.summary || "Unknown failure",
    action:
      result.summary || result.message || "Review the error and try again.",
    projectId: result.projectId,
    taskId: result.taskId,
    localSeconds: result.localElapsedSeconds,
    remoteSeconds: result.remoteElapsedSeconds,
    pollSeconds: result.pollElapsedSeconds,
    totalSeconds: result.elapsedSeconds,
    claudeLogPaths,
  };
}

function normalizeDuration(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.floor(number);
}

function elapsedSecondsBetween(startedAt, finishedAt) {
  return Math.max(0, Math.round((finishedAt - startedAt) / 1000));
}

module.exports = {
  runArbitraryDeploy,
};
