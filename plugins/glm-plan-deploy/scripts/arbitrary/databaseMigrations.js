"use strict";

const path = require("path");

const { resolveDeployContext } = require("../common/auth");
const { requestJson } = require("../common/http");
const { loadArbitrarySettings } = require("../common/settings");
const { runArbitraryAnalyze } = require("./analyze");
const { runArbitraryPreflight } = require("./preflight");
const { uploadMigrationSourceArchive } = require("./sourceArchive");

const DEFAULT_OPERATION_TIMEOUT_MS = 120_000;
const DEFAULT_OPERATION_POLL_MS = 2_000;
const SUPPORTED_FRAMEWORKS = new Set([
  "alembic",
  "django",
  "knex",
  "prisma",
  "rails",
  "sequelize",
  "typeorm",
]);
const APPLY_COMMANDS = {
  alembic: "alembic upgrade head",
  django: "python manage.py migrate --noinput",
  knex: "npx knex migrate:latest",
  prisma: "npx prisma migrate deploy",
  rails: "bundle exec rails db:migrate",
  sequelize: "npx sequelize-cli db:migrate",
  typeorm: "npx typeorm migration:run",
};

async function runArbitraryDatabaseStatus(options = {}) {
  return runDatabaseMigrationCommand({
    ...options,
    action: "check",
    confirmed: false,
  });
}

async function runArbitraryDatabaseSync(options = {}) {
  if (options.confirm !== true && options.confirm !== "true") {
    return {
      success: true,
      needsUserInput: true,
      stage: "confirm",
      message:
        "Database sync applies checked-in migrations to the remote database. Rerun with `--confirm` only after reviewing pending migrations from db-status.",
      summary:
        "Database sync applies checked-in migrations to the remote database. Rerun with `--confirm` only after reviewing pending migrations from db-status.",
    };
  }

  return runDatabaseMigrationCommand({
    ...options,
    action: "apply",
    confirmed: true,
  });
}

async function runDatabaseMigrationCommand(options = {}) {
  const context = resolveDeployContext(options);
  const settings = loadArbitrarySettings(context.projectSettingsPath, {
    cwd: context.cwd,
    projectName: path.basename(context.cwd),
    endpoint: context.baseUrl,
  });
  const apiRecords = [];

  try {
    const analyzeResult = await (options.analyzeImpl || runArbitraryAnalyze)({
      cwd: context.cwd,
    });
    if (!analyzeResult.success) {
      return failure("analyze", analyzeResult.message, {
        summary: analyzeResult.summary || analyzeResult.message,
      });
    }
    const detectedConfig = analyzeResult.detectedConfig || {};
    const database = detectedConfig.database || {};
    if (
      analyzeResult.needsUserInput &&
      !hasMinimumDatabaseMigrationInputs(options, settings, database)
    ) {
      return {
        success: true,
        needsUserInput: true,
        stage: "analyze",
        reasonCode: analyzeResult.reasonCode || null,
        message: analyzeResult.message,
        summary: analyzeResult.summary || analyzeResult.message,
      };
    }

    const bindingId = resolveBindingId(options, settings);
    if (!bindingId) {
      return needsDatabaseInput(
        "No managed database binding was found. Deploy with `--databaseMode managed` first, or rerun with `--bindingId <binding-id>`.",
      );
    }

    const migrationCommand = resolveMigrationCommand(
      options,
      database,
      settings.database,
    );
    if (!migrationCommand) {
      return needsDatabaseInput(
        "Could not detect a versioned migration command. Rerun with `--migrationCommand <command>` and `--framework <framework>`, or manage the database externally.",
      );
    }

    const framework = resolveFramework(options, database, settings.database);
    if (!framework) {
      return needsDatabaseInput(
        "Could not detect the migration framework. Rerun with `--framework <framework>`.",
      );
    }
    if (!SUPPORTED_FRAMEWORKS.has(framework)) {
      return needsDatabaseInput(
        `Unsupported migration framework: ${framework}. Supported frameworks: ${Array.from(SUPPORTED_FRAMEWORKS).sort().join(", ")}.`,
      );
    }
    if (isUnsafeMigrationCommand(migrationCommand)) {
      return failure(
        "validate",
        `Unsafe migration command rejected: ${migrationCommand}. Use checked-in versioned migrations instead of live schema diff commands.`,
      );
    }
    if (
      options.action === "apply" &&
      !isSupportedApplyCommand(framework, migrationCommand)
    ) {
      return needsDatabaseInput(
        `Unsupported migration apply command for framework ${framework}. Use \`${APPLY_COMMANDS[framework]}\` or run db-status only.`,
      );
    }

    const projectId = options.projectId || settings.projectId || null;
    if (!projectId && !options.reserveProject) {
      return needsDatabaseInput(
        "No projectId was found. Deploy the project first or rerun with `--projectId <project-id>`.",
      );
    }

    const preflightResult = await (
      options.preflightImpl || runArbitraryPreflight
    )({
      cwd: context.cwd,
      env: options.env,
      projectId,
      fetchImpl: options.fetchImpl,
    });
    if (!preflightResult.success) {
      return failure("preflight", preflightResult.message, {
        summary: preflightResult.summary || preflightResult.message,
      });
    }
    if (preflightResult.envReady !== true) {
      return needsDatabaseInput(
        "The CloudBase environment is not ready. Wait until envStatus is `normal`, then rerun the database command.",
      );
    }

    const upload = await (
      options.uploadSourceArchiveImpl || uploadMigrationSourceArchive
    )({
      context,
      cwd: context.cwd,
      serviceRoot: detectedConfig.serviceRoot || ".",
      projectId,
      reserveProject: Boolean(options.reserveProject && !projectId),
      uploadSizeLimit: preflightResult.uploadSizeLimit,
      fetchImpl: options.fetchImpl,
      nowFn: options.nowFn,
      pid: options.pid,
      workDir: options.agentWorkDir,
    });
    if (!upload.success) {
      return upload;
    }
    apiRecords.push(...(upload.apiRecords || []));
    const effectiveProjectId = projectId || upload.projectId || null;
    if (!effectiveProjectId) {
      return failure(
        "sourceArchive",
        "Project reservation did not return projectId.",
        {
          apiRecords,
          apiRecord: last(apiRecords),
        },
      );
    }

    const endpoint =
      options.action === "apply"
        ? "/client/tcb/database/migrations/apply"
        : "/client/tcb/database/migrations/check";
    const migrationResponse = await (options.requestJsonImpl || requestJson)({
      url: `${context.baseUrl}${endpoint}`,
      method: "POST",
      token: context.token,
      body: buildMigrationBody({
        projectId: effectiveProjectId,
        appName: sanitizeAppName(
          options.appName || settings.projectName || path.basename(context.cwd),
        ),
        bindingId,
        framework,
        migrationCommand,
        sourceArchiveObjectKey: upload.sourceArchiveObjectKey,
        confirmed: options.action === "apply",
      }),
      fetchImpl: options.fetchImpl,
    });
    collectApiRecord(apiRecords, migrationResponse);

    const operation = await resolveMigrationOperation({
      context,
      data: migrationResponse.data || {},
      requestJsonImpl: options.requestJsonImpl || requestJson,
      fetchImpl: options.fetchImpl,
      apiRecords,
      timeoutMs: options.operationTimeoutMs,
      pollIntervalMs: options.operationPollMs,
      sleepFn: options.sleepFn,
      nowFn: options.nowFn,
    });
    if (!operation.success) {
      return operation;
    }

    const result = {
      success: true,
      needsUserInput: false,
      stage: "completed",
      action: options.action,
      projectId: effectiveProjectId,
      bindingId,
      framework,
      migrationCommand,
      sourceArchiveObjectKey: upload.sourceArchiveObjectKey,
      operationId: operation.operationId,
      migrationResult: operation.migrationResult,
      apiRecords,
    };
    result.summary = formatMigrationSummary(result);
    return result;
  } catch (error) {
    collectApiRecord(apiRecords, error);
    return failure("database", error.message, {
      apiRecords,
      apiRecord: last(apiRecords),
    });
  }
}

function buildMigrationBody(options) {
  const body = {
    projectId: options.projectId,
    appName: options.appName,
    bindingId: options.bindingId,
    framework: options.framework,
    migrationCommand: options.migrationCommand,
    workingDir: ".",
    sourceArchiveObjectKey: options.sourceArchiveObjectKey,
  };
  if (options.confirmed) {
    body.confirmed = true;
  }
  return body;
}

async function resolveMigrationOperation(options) {
  let data = options.data || {};
  const operationId = data.operationId || null;
  let status = String(data.status || "").toLowerCase();

  if (status === "success") {
    const migrationResult = extractMigrationResult(data);
    const contract = validateMigrationResultContract(migrationResult);
    if (!contract.ok) {
      return failure(
        "database",
        `Database migration operation returned incomplete migrationResult. ${contract.message}`,
        {
          apiRecords: options.apiRecords,
          apiRecord: last(options.apiRecords),
          migrationResult,
        },
      );
    }
    return {
      success: true,
      operationId,
      migrationResult,
    };
  }
  if (status === "failed") {
    return failure(
      "database",
      data.errorMessage || "Database migration operation failed.",
      {
        apiRecords: options.apiRecords,
        apiRecord: last(options.apiRecords),
      },
    );
  }
  if (!operationId) {
    return failure(
      "database",
      "Database migration operation did not return an operationId.",
      {
        apiRecords: options.apiRecords,
        apiRecord: last(options.apiRecords),
      },
    );
  }

  const nowFn = options.nowFn || Date.now;
  const startedAt = nowFn();
  const timeoutMs = normalizePositiveNumber(
    options.timeoutMs,
    DEFAULT_OPERATION_TIMEOUT_MS,
  );
  const pollIntervalMs = normalizePositiveNumber(
    options.pollIntervalMs,
    DEFAULT_OPERATION_POLL_MS,
  );
  const sleepFn =
    options.sleepFn ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  while (nowFn() - startedAt <= timeoutMs) {
    const response = await options.requestJsonImpl({
      url: `${options.context.baseUrl}/client/tcb/database/operations/${encodeURIComponent(operationId)}`,
      token: options.context.token,
      fetchImpl: options.fetchImpl,
    });
    collectApiRecord(options.apiRecords, response);
    data = response.data || {};
    status = String(data.status || "").toLowerCase();
    if (status === "success") {
      const migrationResult = extractMigrationResult(data);
      const contract = validateMigrationResultContract(migrationResult);
      if (!contract.ok) {
        return failure(
          "database",
          `Database migration operation returned incomplete migrationResult. ${contract.message}`,
          {
            apiRecords: options.apiRecords,
            apiRecord: last(options.apiRecords),
            migrationResult,
          },
        );
      }
      return {
        success: true,
        operationId,
        migrationResult,
      };
    }
    if (status === "failed") {
      return failure(
        "database",
        data.errorMessage || "Database migration operation failed.",
        {
          apiRecords: options.apiRecords,
          apiRecord: last(options.apiRecords),
        },
      );
    }
    await sleepFn(pollIntervalMs);
  }

  return failure(
    "database",
    "Database migration operation timed out before completion.",
    {
      apiRecords: options.apiRecords,
      apiRecord: last(options.apiRecords),
    },
  );
}

function extractMigrationResult(data) {
  return data.result || data.migrationResult || {};
}

function validateMigrationResultContract(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return {
      ok: false,
      message: "`migrationResult` must be an object.",
    };
  }
  if (!normalizeOptionalString(result.framework)) {
    return {
      ok: false,
      message: "`migrationResult.framework` must be a non-empty string.",
    };
  }
  if (result.connected !== true) {
    return {
      ok: false,
      message: "`migrationResult.connected` must be true.",
    };
  }
  if (typeof result.migrationTableExists !== "boolean") {
    return {
      ok: false,
      message: "`migrationResult.migrationTableExists` must be a boolean.",
    };
  }
  if (!Array.isArray(result.appliedMigrations)) {
    return {
      ok: false,
      message: "`migrationResult.appliedMigrations` must be an array.",
    };
  }
  if (!Array.isArray(result.pendingMigrations)) {
    return {
      ok: false,
      message: "`migrationResult.pendingMigrations` must be an array.",
    };
  }
  if (typeof result.drift !== "boolean") {
    return {
      ok: false,
      message: "`migrationResult.drift` must be a boolean.",
    };
  }
  if (typeof result.summary !== "string") {
    return {
      ok: false,
      message: "`migrationResult.summary` must be a string.",
    };
  }
  return { ok: true, message: null };
}

function resolveBindingId(options, settings) {
  return (
    normalizeOptionalString(options.bindingId) ||
    normalizeOptionalString(settings.database && settings.database.bindingId)
  );
}

function resolveFramework(options, database, storedDatabase) {
  const framework =
    normalizeOptionalString(options.framework) ||
    normalizeOptionalString(database.orm) ||
    normalizeOptionalString(storedDatabase && storedDatabase.framework) ||
    inferFrameworkFromCommand(
      resolveMigrationCommand(options, database, storedDatabase),
    );
  return normalizeFrameworkId(framework);
}

function hasMinimumDatabaseMigrationInputs(options, settings, database) {
  if (!resolveBindingId(options, settings)) {
    return false;
  }
  const migrationCommand = resolveMigrationCommand(
    options,
    database,
    settings.database,
  );
  if (!migrationCommand) {
    return false;
  }
  const framework = resolveFramework(options, database, settings.database);
  return Boolean(framework);
}

function resolveMigrationCommand(options, database, storedDatabase) {
  return (
    normalizeOptionalString(options.migrationCommand) ||
    normalizeOptionalString(database.migrationCommand) ||
    normalizeOptionalString(storedDatabase && storedDatabase.migrationCommand)
  );
}

function inferFrameworkFromCommand(command) {
  const normalized = String(command || "").toLowerCase();
  if (normalized.includes("prisma")) return "prisma";
  if (normalized.includes("rails")) return "rails";
  if (normalized.includes("artisan")) return "laravel";
  if (normalized.includes("knex")) return "knex";
  if (normalized.includes("sequelize")) return "sequelize";
  if (normalized.includes("typeorm")) return "typeorm";
  return null;
}

function normalizeFrameworkId(framework) {
  const normalized = normalizeOptionalString(framework);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower === "activerecord" || lower === "active_record") {
    return "rails";
  }
  return lower;
}

function isSupportedApplyCommand(framework, command) {
  return normalizeCommand(command) === APPLY_COMMANDS[framework];
}

function normalizeCommand(command) {
  return String(command || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isUnsafeMigrationCommand(command) {
  const normalized = String(command || "").toLowerCase();
  return (
    /\bprisma\s+db\s+push\b/.test(normalized) ||
    /\bmigrate\s+dev\b/.test(normalized) ||
    /\bmigrate\s+reset\b/.test(normalized) ||
    /\bsequelize\s+sync\b/.test(normalized) ||
    /\btypeorm\s+schema:sync\b/.test(normalized) ||
    /\bschema:sync\b/.test(normalized) ||
    /\bsynchronize\b/.test(normalized) ||
    /--force\b/.test(normalized) ||
    /\bdrop-database\b/.test(normalized) ||
    /\bdb:drop\b/.test(normalized) ||
    /\bdb\s+reset\b/.test(normalized)
  );
}

function formatMigrationSummary(result) {
  const migrationResult = result.migrationResult || {};
  const pending = Array.isArray(migrationResult.pendingMigrations)
    ? migrationResult.pendingMigrations.length
    : 0;
  const applied = Array.isArray(migrationResult.appliedMigrations)
    ? migrationResult.appliedMigrations.length
    : 0;
  const actionText =
    result.action === "apply"
      ? "Database migrations applied"
      : "Database migration status checked";
  const lines = [
    `✅ **${actionText}**`,
    `- Binding: ${result.bindingId}`,
    `- Framework: ${result.framework}`,
    `- Applied migrations: ${applied}`,
    `- Pending migrations: ${pending}`,
  ];
  if (migrationResult.drift === true) {
    lines.push("- Drift: detected");
  } else if (migrationResult.drift === false) {
    lines.push("- Drift: not detected");
  }
  if (migrationResult.summary) {
    lines.push(`- Summary: ${migrationResult.summary}`);
  }
  return lines.join("\n");
}

function needsDatabaseInput(message) {
  return {
    success: true,
    needsUserInput: true,
    stage: "database",
    message,
    summary: message,
  };
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sanitizeAppName(appName) {
  const value = String(appName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "app";
}

function collectApiRecord(apiRecords, source) {
  if (source && source.apiRecord) {
    apiRecords.push(source.apiRecord);
  }
}

function last(items) {
  return items.length ? items[items.length - 1] : null;
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

module.exports = {
  isUnsafeMigrationCommand,
  runArbitraryDatabaseStatus,
  runArbitraryDatabaseSync,
};
