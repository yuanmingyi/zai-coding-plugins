"use strict";

const path = require("path");

const { resolveDeployContext } = require("../common/auth");
const {
  loadArbitrarySettings,
  saveArbitrarySettings,
} = require("../common/settings");
const { runArbitraryAnalyze } = require("./analyze");
const {
  collectClaudeLogPaths: defaultCollectClaudeLogPaths,
  formatDebugLogsFallback,
} = require("./claudeLogPaths");
const { runFormatArbitraryDeployReport } = require("./formatDeployReport");
const {
  normalizeDatabaseMode,
  normalizeDatabaseType,
  resolveDatabaseBindings,
} = require("./database");
const { runArbitraryPreflight } = require("./preflight");
const { normalizeDatabaseState } = require("./recordDeployment");
const { runRenderArbitraryDockerfiles } = require("./renderDockerfiles");
const { runArbitraryValidateBuild } = require("./validateBuild");

async function runArbitraryPrepareLocal(options = {}) {
  const nowFn = options.nowFn || Date.now;
  const startedAt = nowFn();

  const preflightImpl = options.preflightImpl || runArbitraryPreflight;
  const analyzeImpl = options.analyzeImpl || runArbitraryAnalyze;
  const validateBuildImpl =
    options.validateBuildImpl || runArbitraryValidateBuild;
  const renderDockerfilesImpl =
    options.renderDockerfilesImpl || runRenderArbitraryDockerfiles;
  const databaseResolveImpl =
    options.databaseResolveImpl || resolveDatabaseBindings;
  const formatReportImpl =
    options.formatReportImpl || runFormatArbitraryDeployReport;
  const collectClaudeLogPathsImpl =
    options.collectClaudeLogPathsImpl || defaultCollectClaudeLogPaths;
  const claudeLogPaths = collectClaudeLogPathsImpl({
    cwd: options.cwd,
    env: options.env,
  });
  const attachFinalReport = (failureResult) =>
    attachLocalPrepFinalReport(failureResult, {
      formatReportImpl,
      claudeLogPaths,
    });

  const preflightResult = await preflightImpl({
    cwd: options.cwd,
    env: options.env,
    fetchImpl: options.fetchImpl,
  });
  if (!preflightResult.success) {
    return await attachFinalReport(
      withTiming(
        failure("preflight", preflightResult.message, {
          summary: preflightResult.summary || preflightResult.message,
          ...pickPreflightState(preflightResult),
          ...pickApiEvidence(preflightResult),
        }),
        startedAt,
        nowFn,
      ),
    );
  }

  const analyzeResult = await analyzeImpl({
    cwd: options.cwd,
    path: options.path,
  });
  if (!analyzeResult.success) {
    return await attachFinalReport(
      withTiming(
        failure("analyze", analyzeResult.message, {
          summary: analyzeResult.summary || analyzeResult.message,
          ...pickPreflightState(preflightResult),
        }),
        startedAt,
        nowFn,
      ),
    );
  }

  // Reconcile explicit overrides with analyze BEFORE honoring its
  // needsUserInput boundary. analyze answers "what was auto-detected"; when
  // the caller supplied enough overrides to fully specify the service, an
  // analyze prompt (e.g. AMBIGUOUS_ENTRYPOINT for app.rb + config.ru) is
  // already resolved and must not block the non-interactive flow.
  const detectedConfig = applyConfigOverrides(
    analyzeResult.detectedConfig || {},
    options,
  );
  const databaseDecision = resolveDatabaseDecision({
    detectedDatabase: detectedConfig.database,
    options,
    preflightResult,
  });
  if (databaseDecision.database) {
    detectedConfig.database = databaseDecision.database;
  }
  if (databaseDecision.needsUserInput) {
    return withTiming(
      {
        success: true,
        needsUserInput: true,
        stage: "analyze",
        reasonCode: databaseDecision.reasonCode,
        message: databaseDecision.message,
        summary: databaseDecision.message,
        detectedConfig,
        database: databaseDecision.database,
        ...pickPreflightState(preflightResult),
      },
      startedAt,
      nowFn,
    );
  }
  if (!detectedConfig.runtimeKind && trimmed(detectedConfig.startCommand)) {
    detectedConfig.runtimeKind = "process";
  }
  // Refuse to ship a buildCommand that swallows its own failure exit code
  // (`bundle install || true`, `npm ci || :`, etc.). Such commands make
  // CNB report a successful build for an actually-broken install, so a
  // half-baked image goes live and only crashes at runtime — exactly the
  // ruby-sinatra 446 path observed in adt-f8f7644fb38c425280b0835ccdaa60bd.
  // Strip the masker so the real exit code surfaces.
  if (trimmed(detectedConfig.buildCommand)) {
    detectedConfig.buildCommand = stripFailureMasker(
      detectedConfig.buildCommand,
    );
  }

  if (
    analyzeResult.needsUserInput &&
    !overridesCompleteConfig(detectedConfig)
  ) {
    return withTiming(
      {
        success: true,
        needsUserInput: true,
        stage: "analyze",
        reasonCode: analyzeResult.reasonCode || null,
        message: analyzeResult.message,
        summary: analyzeResult.summary || analyzeResult.message,
        detectedConfig: analyzeResult.detectedConfig || null,
        ...pickPreflightState(preflightResult),
      },
      startedAt,
      nowFn,
    );
  }

  const buildResult = await validateBuildImpl({
    cwd: resolveServiceRootCwd(options.cwd, detectedConfig.serviceRoot),
    buildCommand: detectedConfig.buildCommand,
    detectedLanguage: detectedConfig.language,
    detectedVersion: detectedConfig.version,
    execImpl: options.execImpl,
  });
  if (!buildResult.success) {
    return await attachFinalReport(
      withTiming(
        failure("validateBuild", buildResult.message, {
          summary: buildResult.summary || buildResult.message,
          detectedConfig,
          ...pickPreflightState(preflightResult),
        }),
        startedAt,
        nowFn,
      ),
    );
  }

  if (!buildResult.buildSucceeded) {
    return withTiming(
      {
        success: true,
        needsUserInput: true,
        stage: "validateBuild",
        reasonCode: "BUILD_FAILED",
        message: buildResult.summary || "Local build validation failed.",
        summary: buildResult.summary || "Local build validation failed.",
        detectedConfig,
        buildCommand: buildResult.buildCommand,
        exitCode: buildResult.exitCode,
        stdout: buildResult.stdout || "",
        stderr: buildResult.stderr || "",
        ...pickPreflightState(preflightResult),
      },
      startedAt,
      nowFn,
    );
  }

  let databaseResult = {
    success: true,
    projectId: preflightResult.projectId || null,
    database: databaseDecision.database || null,
    databaseBindings: [],
  };
  if (databaseDecision.mode === "managed") {
    databaseResult = await databaseResolveImpl({
      cwd: options.cwd,
      env: options.env,
      fetchImpl: options.fetchImpl,
      projectId: preflightResult.projectId || null,
      appName: sanitizeAppName(
        options.appName || path.basename(options.cwd || process.cwd()),
      ),
      mode: databaseDecision.mode,
      type: databaseDecision.type,
      detectedDatabase: databaseDecision.database,
      databaseCapabilities: preflightResult.databaseCapabilities || null,
      nowFn: options.nowFn,
      sleepFn: options.sleepFn,
    });
    if (!databaseResult.success) {
      return await attachFinalReport(
        withTiming(
          failure("database", databaseResult.message, {
            summary: databaseResult.summary || databaseResult.message,
            detectedConfig,
            database: databaseDecision.database,
            apiRecords: databaseResult.apiRecords || [],
            apiRecord: databaseResult.apiRecord || null,
            ...pickPreflightState(preflightResult),
          }),
          startedAt,
          nowFn,
        ),
      );
    }
  }
  const effectiveProjectId =
    databaseResult.projectId || preflightResult.projectId || null;
  if (databaseDecision.mode === "managed") {
    const persistResult = persistPreparedDatabaseState({
      cwd: options.cwd,
      env: options.env,
      projectId: effectiveProjectId,
      database: databaseResult.database,
      databaseBindings: databaseResult.databaseBindings,
      nowFn,
    });
    if (!persistResult.success) {
      return await attachFinalReport(
        withTiming(
          failure("database", persistResult.message, {
            summary: persistResult.summary || persistResult.message,
            detectedConfig,
            database: databaseResult.database || databaseDecision.database,
            databaseBindings: databaseResult.databaseBindings || [],
            ...pickPreflightState({
              ...preflightResult,
              projectId: effectiveProjectId,
            }),
          }),
          startedAt,
          nowFn,
        ),
      );
    }
  }

  const agentWorkDir = resolveAgentWorkDir(options);
  const renderResult = await renderDockerfilesImpl({
    cwd: options.cwd,
    agentWorkDir,
    detectedConfig,
    language: detectedConfig.language,
    version: detectedConfig.version,
    serviceRoot: detectedConfig.serviceRoot,
    buildCommand: detectedConfig.buildCommand,
    output: detectedConfig.output,
    startCommand: detectedConfig.startCommand,
    runtimeKind: detectedConfig.runtimeKind,
    framework: detectedConfig.framework,
    staticIndexFile: detectedConfig.staticIndexFile,
  });
  if (!renderResult.success) {
    return await attachFinalReport(
      withTiming(
        failure("renderDockerfiles", renderResult.message, {
          summary: renderResult.summary || renderResult.message,
          detectedConfig,
          agentWorkDir,
          ...pickPreflightState(preflightResult),
        }),
        startedAt,
        nowFn,
      ),
    );
  }

  return withTiming(
    {
      success: true,
      stage: "completed",
      needsUserInput: false,
      detectedConfig,
      agentWorkDir,
      dockerfileBuildPath: renderResult.dockerfileBuildPath || null,
      dockerfileRunPath: renderResult.dockerfileRunPath || null,
      buildScriptPath: renderResult.buildScriptPath || null,
      nginxTemplatePath: renderResult.nginxTemplatePath || null,
      entrypointPath: renderResult.entrypointPath || null,
      database: databaseResult.database || databaseDecision.database || null,
      databaseBindings: databaseResult.databaseBindings || [],
      summary:
        renderResult.summary ||
        `Prepared local deploy artifacts in ${agentWorkDir}`,
      ...pickPreflightState({
        ...preflightResult,
        projectId: effectiveProjectId,
      }),
    },
    startedAt,
    nowFn,
  );
}

function resolveAgentWorkDir(options) {
  const cwd = options.cwd || process.cwd();
  if (typeof options.agentWorkDir === "string" && options.agentWorkDir.trim()) {
    return path.resolve(cwd, options.agentWorkDir);
  }

  const nowFn = options.nowFn || Date.now;
  const timestamp = String(nowFn());
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  return path.join(cwd, ".zai", "deploy", "arbitrary", `${timestamp}-${pid}`);
}

function resolveServiceRootCwd(cwd, serviceRoot) {
  return path.resolve(cwd || process.cwd(), serviceRoot || ".");
}

function resolveDatabaseDecision({
  detectedDatabase,
  options,
  preflightResult,
}) {
  const explicitMode = normalizeDatabaseMode(options.databaseMode);
  const explicitType = normalizeDatabaseType(options.databaseType);
  let database = normalizeDetectedDatabase(detectedDatabase);

  if (!database && explicitMode && explicitMode !== "skip") {
    if (!explicitType) {
      return databasePrompt({
        reasonCode: "DATABASE_TYPE_REQUIRED",
        database: {
          detected: true,
          type: "unknown",
          requiredEnv: [],
          orm: null,
          migrationCommand: null,
          mode: explicitMode,
        },
        message:
          "A database mode was provided, but the database type is unclear. Rerun with `--databaseType mysql` or use `--databaseMode external` if you manage the database yourself.",
      });
    }
    database = {
      detected: true,
      type: explicitType,
      requiredEnv:
        explicitType === "mysql" || explicitType === "postgresql"
          ? ["DATABASE_URL"]
          : [],
      orm: null,
      migrationCommand: null,
    };
  }

  if (!database) {
    return { mode: null, type: null, database: null, needsUserInput: false };
  }

  if (explicitType) {
    database.type = explicitType;
  }
  const mode = explicitMode || normalizeDatabaseMode(database.mode);
  database.mode = mode || null;

  if (!mode) {
    return databasePrompt({
      reasonCode: "DATABASE_CONFIGURATION_REQUIRED",
      database,
      message: formatDatabaseModePrompt(database),
    });
  }

  if (!["managed", "external", "skip"].includes(mode)) {
    return databasePrompt({
      reasonCode: "DATABASE_MODE_UNSUPPORTED",
      database,
      message:
        "Unsupported database mode. Use `--databaseMode managed`, `--databaseMode external`, or `--databaseMode skip`.",
    });
  }

  if (mode === "managed") {
    if (database.type !== "mysql") {
      return databasePrompt({
        reasonCode: "DATABASE_MODE_UNSUPPORTED",
        database,
        message:
          "Managed database provisioning currently supports MySQL only. Rerun with `--databaseMode external` for PostgreSQL or choose `--databaseMode skip` if the app does not need a database at runtime.",
      });
    }
    if (!preflightSupportsManagedMysql(preflightResult)) {
      return databasePrompt({
        reasonCode: "DATABASE_MODE_UNSUPPORTED",
        database,
        message:
          "Managed MySQL requires the current CloudBase environment to be `normal` and created with MySQL/flexdb support. Rerun with `--databaseMode external`, or initialize/repair the environment with MySQL support before using `--databaseMode managed`.",
      });
    }
  }

  return {
    mode,
    type: database.type,
    database,
    needsUserInput: false,
  };
}

function normalizeDetectedDatabase(value) {
  if (!value || typeof value !== "object" || value.detected !== true) {
    return null;
  }
  return {
    detected: true,
    type: normalizeDatabaseType(value.type) || "unknown",
    requiredEnv: Array.isArray(value.requiredEnv)
      ? value.requiredEnv.filter((item) => typeof item === "string" && item)
      : [],
    orm: trimmed(value.orm) || null,
    migrationCommand: trimmed(value.migrationCommand) || null,
    mode: normalizeDatabaseMode(value.mode),
  };
}

function databasePrompt({ reasonCode, database, message }) {
  return {
    needsUserInput: true,
    reasonCode,
    database,
    message,
  };
}

function formatDatabaseModePrompt(database) {
  const lines = [
    "⚠️ **Database Configuration Required**",
    "",
    `Detected a ${database.type || "database"} dependency in this project.`,
  ];
  if (database.orm) {
    lines.push(`Detected ORM: ${database.orm}.`);
  }
  if (database.requiredEnv && database.requiredEnv.length) {
    lines.push(`Runtime env keys: ${database.requiredEnv.join(", ")}.`);
  }
  lines.push(
    "",
    "Choose one deployment mode and rerun:",
    "- `--databaseMode managed` to ask the deploy server to create/reuse a managed TCB MySQL database and inject binding refs.",
    "- `--databaseMode external` if you will provide the database and networking/runtime env yourself.",
    "- `--databaseMode skip` if the detected dependency is not required for this deployment.",
  );
  if (database.type === "postgresql") {
    lines.push(
      "",
      "PostgreSQL managed provisioning is not available in the current API; use `--databaseMode external`.",
    );
  }
  return lines.join("\n");
}

function preflightSupportsManagedMysql(preflightResult) {
  const capabilities = preflightResult.databaseCapabilities;
  const mysql = capabilities && capabilities.mysql;
  return (
    preflightResult.envReady === true &&
    preflightResult.envStatus === "normal" &&
    capabilities &&
    Array.isArray(capabilities.supports) &&
    capabilities.supports.includes("mysql") &&
    mysql &&
    mysql.provisioning === true &&
    mysql.accounts === true &&
    mysql.sql === true
  );
}

function sanitizeAppName(appName) {
  const value = String(appName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "app";
}

function applyConfigOverrides(detectedConfig, options) {
  const overrides = {};
  for (const key of [
    "language",
    "version",
    "serviceRoot",
    "buildCommand",
    "output",
    "startCommand",
    "runtimeKind",
    "framework",
    "staticIndexFile",
  ]) {
    if (typeof options[key] === "string" && options[key].trim()) {
      overrides[key] = options[key].trim();
    }
  }

  return {
    ...detectedConfig,
    ...overrides,
  };
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Remove trailing exit-code maskers like `|| true`, `|| :`, `|| /bin/true`,
// `; true`, `; :`. Applied repeatedly so chains such as `cmd || true ; :`
// fully unwrap. Only operates on the tail of the command; embedded `|| true`
// inside a subshell is left alone since the shell will still evaluate it.
function stripFailureMasker(buildCommand) {
  const masker =
    /\s*(?:(?:\|\||;)\s*(?:true|:|\/bin\/true|\/usr\/bin\/true))+\s*$/;
  let result = String(buildCommand);
  let next = result.replace(masker, "");
  while (next !== result) {
    result = next.trim();
    next = result.replace(masker, "");
  }
  return result.trim();
}

// The merged (analyze-partial + overrides) config is deployable without
// further user input only when every field the downstream stages need is
// present. Conservative on purpose: a half-specified config must still
// surface the analyze prompt rather than deploy something underspecified.
function overridesCompleteConfig(detectedConfig) {
  return [
    "language",
    "serviceRoot",
    "buildCommand",
    "output",
    "startCommand",
  ].every((key) => trimmed(detectedConfig[key]).length > 0);
}

function pickPreflightState(result) {
  return {
    timeoutSeconds: result.timeoutSeconds,
    maxRetries: result.maxRetries,
    uploadSizeLimit: result.uploadSizeLimit,
    projectId: result.projectId,
    envStatus: result.envStatus,
    envReady: result.envReady,
    firstDeployNotice: result.firstDeployNotice,
    accessControl: result.accessControl || null,
    databaseCapabilities: result.databaseCapabilities,
  };
}

function pickApiEvidence(result) {
  if (!result) return {};
  return {
    ...(result.apiRecord ? { apiRecord: result.apiRecord } : {}),
    ...(result.apiRecords ? { apiRecords: result.apiRecords } : {}),
  };
}

function persistPreparedDatabaseState(options) {
  try {
    const databaseState = normalizeDatabaseState(
      options.database,
      options.databaseBindings,
    );
    if (!options.projectId && !databaseState) {
      return { success: true };
    }

    const context = resolveDeployContext({
      cwd: options.cwd,
      env: options.env,
    });
    const settings = loadArbitrarySettings(context.projectSettingsPath, {
      cwd: context.cwd,
      projectName: path.basename(context.cwd),
      endpoint: context.baseUrl,
    });

    if (options.projectId) {
      if (settings.projectId !== options.projectId) {
        settings.createTime = new Date(
          (options.nowFn || Date.now)(),
        ).toISOString();
      }
      settings.projectId = options.projectId;
    }
    if (databaseState) {
      settings.database = mergePreparedDatabaseState(
        settings.database,
        databaseState,
      );
    }

    saveArbitrarySettings(context.projectSettingsPath, settings);
    return { success: true };
  } catch (error) {
    return failure(
      "database",
      `Failed to persist prepared database state: ${error.message}`,
    );
  }
}

function mergePreparedDatabaseState(existingDatabase, nextDatabase) {
  if (
    existingDatabase &&
    existingDatabase.bindingId &&
    existingDatabase.bindingId === nextDatabase.bindingId
  ) {
    return {
      ...nextDatabase,
      ...(nextDatabase.migrationFingerprint
        ? {}
        : { migrationFingerprint: existingDatabase.migrationFingerprint }),
      ...(nextDatabase.lastMigrationSyncAction
        ? {}
        : {
            lastMigrationSyncAction: existingDatabase.lastMigrationSyncAction,
          }),
    };
  }
  return nextDatabase;
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

function withTiming(result, startedAt, nowFn) {
  const finishedAt = nowFn();
  const elapsedSeconds = Math.max(
    0,
    Math.round((finishedAt - startedAt) / 1000),
  );
  return { ...result, startedAt, finishedAt, elapsedSeconds };
}

async function attachLocalPrepFinalReport(result, deps) {
  if (result.success !== false) return result;
  const { formatReportImpl, claudeLogPaths } = deps;
  try {
    const reportResult = await formatReportImpl({
      outcome: "failure",
      stage: result.stage,
      reason: result.message || result.summary || "Unknown failure",
      action:
        result.summary || result.message || "Review the error and try again.",
      localSeconds: result.elapsedSeconds,
      remoteSeconds: null,
      totalSeconds: result.elapsedSeconds,
      claudeLogPaths,
    });
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
  runArbitraryPrepareLocal,
  withTiming,
};
