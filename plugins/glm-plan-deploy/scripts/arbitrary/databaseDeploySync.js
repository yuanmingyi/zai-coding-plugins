"use strict";

const path = require("path");

const { resolveDeployContext } = require("../common/auth");
const { loadArbitrarySettings } = require("../common/settings");
const {
  runArbitraryDatabaseStatus,
  runArbitraryDatabaseSync,
} = require("./databaseMigrations");
const {
  computeDatabaseMigrationFingerprint,
} = require("./databaseFingerprint");

const DATABASE_SYNC_MODES = new Set(["auto", "skip", "check", "apply"]);

async function runDeployDatabaseSync(options = {}) {
  const mode = normalizeDatabaseSyncMode(options.databaseSync);
  if (!mode.ok) {
    return needsDatabaseInput(
      "DATABASE_SYNC_MODE_UNSUPPORTED",
      "Unsupported database sync mode. Use `--databaseSync auto`, `--databaseSync check`, `--databaseSync apply`, or `--databaseSync skip`.",
    );
  }

  const database = normalizeDatabase(options.database);
  if (!database || mode.value === "skip" || database.mode === "skip") {
    return completed({
      action: "skipped",
      reason: !database
        ? "No database dependency was detected."
        : "Database sync was skipped.",
      mode: mode.value,
    });
  }

  const context = resolveDeployContext(options);
  const settings = loadArbitrarySettings(context.projectSettingsPath, {
    cwd: context.cwd,
    projectName: path.basename(context.cwd),
    endpoint: context.baseUrl,
  });

  if (database.mode === "external" && !hasExplicitBindingOverride(options)) {
    if (mode.explicit && mode.value !== "auto") {
      return needsDatabaseInput(
        "DATABASE_BINDING_REQUIRED",
        "The current project database is external. Rerun with `--databaseBindingId <binding-id>` to force deploy-time DB sync for a server-managed binding, or rerun with `--databaseSync skip` if you intentionally manage the external database separately.",
        {
          mode: mode.value,
        },
      );
    }
    return completed({
      action: "skipped",
      reason:
        "The current project database is external; deploy-time DB sync will not reuse a stored managed binding unless `--databaseBindingId` is provided explicitly.",
      mode: mode.value,
    });
  }

  const bindingId = resolveBindingId({ ...options, database, settings });
  if (!bindingId) {
    if (mode.explicit || database.mode === "managed") {
      return needsDatabaseInput(
        "DATABASE_BINDING_REQUIRED",
        "No managed database binding was found for deploy-time DB sync. Deploy with `--databaseMode managed`, rerun with `--databaseSync skip`, or use the separate db-status/db-sync workflow with `--bindingId`.",
      );
    }
    return completed({
      action: "skipped",
      reason:
        "No server-managed database binding was found; external database sync is handled outside deploy.",
      mode: mode.value,
    });
  }

  const fingerprintResult = computeFingerprintSafely({
    options,
    context,
    database,
  });
  if (!fingerprintResult.success) {
    return fingerprintResult;
  }
  const fingerprint = fingerprintResult.fingerprint;
  const previousFingerprint =
    settings.database && settings.database.migrationFingerprint;
  const fingerprintChanged = Boolean(
    fingerprint.hash && fingerprint.hash !== previousFingerprint,
  );

  if (mode.value === "auto" && (!fingerprint.hash || !fingerprintChanged)) {
    return completed({
      action: "skipped",
      reason: fingerprint.hash
        ? "No project-side database migration changes were detected."
        : "No checked-in database migration files were detected.",
      mode: mode.value,
      bindingId,
      migrationFingerprint: fingerprint.hash,
      recordMigrationFingerprint: Boolean(fingerprint.hash),
    });
  }

  const migrationCommand = resolveMigrationCommand({
    ...options,
    database,
    settings,
  });
  const framework = resolveFramework({ ...options, database, settings });
  if (!migrationCommand || !framework) {
    return needsDatabaseInput(
      "DATABASE_MIGRATION_COMMAND_REQUIRED",
      [
        "Deploy-time DB sync detected a managed database target but could not determine a safe checked-in migration command.",
        "Rerun with `--databaseFramework <framework>` and `--databaseMigrationCommand <command>`, or rerun with `--databaseSync skip` if you intentionally manage the database separately.",
      ].join(" "),
      {
        mode: mode.value,
        bindingId,
        framework,
        migrationCommand,
        migrationFingerprint: fingerprint.hash,
        migrationFingerprintChanged: fingerprintChanged,
      },
    );
  }
  const projectId = options.projectId || settings.projectId || null;

  if (mode.value === "apply" && !isConfirmed(options.databaseSyncConfirm)) {
    return needsDatabaseInput(
      "DATABASE_SYNC_CONFIRM_REQUIRED",
      "Deploy-time database sync will apply checked-in migrations before deployment. Rerun with `--databaseSync apply --databaseSyncConfirm` only after reviewing pending migrations.",
      {
        bindingId,
        framework,
        migrationCommand,
        migrationFingerprint: fingerprint.hash,
        migrationFingerprintChanged: fingerprintChanged,
      },
    );
  }

  const migrationOptions = {
    cwd: context.cwd,
    env: options.env,
    appName: options.appName,
    projectId,
    reserveProject: !projectId,
    bindingId,
    framework,
    migrationCommand,
    agentWorkDir: options.agentWorkDir,
    fetchImpl: options.fetchImpl,
    requestJsonImpl: options.requestJsonImpl,
    preflightImpl: options.preflightImpl,
    uploadSourceArchiveImpl: options.uploadSourceArchiveImpl,
    analyzeImpl: options.analyzeImpl,
    nowFn: options.nowFn,
    sleepFn: options.sleepFn,
    operationTimeoutMs: options.operationTimeoutMs,
    operationPollMs: options.operationPollMs,
  };
  const migrationResult =
    mode.value === "apply"
      ? await (options.databaseSyncApplyImpl || runArbitraryDatabaseSync)({
          ...migrationOptions,
          confirm: true,
        })
      : await (options.databaseStatusImpl || runArbitraryDatabaseStatus)(
          migrationOptions,
        );

  if (!migrationResult.success) {
    return {
      ...migrationResult,
      stage: migrationResult.stage || "database",
      migrationFingerprint: fingerprint.hash,
      migrationFingerprintChanged: fingerprintChanged,
    };
  }
  if (migrationResult.needsUserInput) {
    return {
      ...migrationResult,
      migrationFingerprint: fingerprint.hash,
      migrationFingerprintChanged: fingerprintChanged,
    };
  }

  const gate = evaluateMigrationGate({
    mode: mode.value,
    projectId,
    bindingId,
    framework,
    migrationCommand,
    migrationResult,
    migrationFingerprint: fingerprint.hash,
    migrationFingerprintChanged: fingerprintChanged,
  });
  return gate;
}

function evaluateMigrationGate(options) {
  const migrationResult = options.migrationResult || {};
  const result = migrationResult.migrationResult || {};
  const projectId = migrationResult.projectId || options.projectId || null;
  const contract = validateMigrationResultContract(result);
  if (!contract.ok) {
    return databaseFailure(
      "DATABASE_MIGRATION_STATUS_INVALID",
      [
        "The deploy API server returned an incomplete database migration status result.",
        contract.message,
        "Stop deployment until the server executes the status/apply operation through the DB-reachable TCB migration runner and returns the expected result fields.",
      ].join(" "),
      {
        projectId,
        bindingId: options.bindingId,
        framework: options.framework,
        migrationCommand: options.migrationCommand,
        migrationResult: result,
        migrationFingerprint: options.migrationFingerprint,
        migrationFingerprintChanged: options.migrationFingerprintChanged,
      },
    );
  }
  const pending = Array.isArray(result.pendingMigrations)
    ? result.pendingMigrations.length
    : 0;
  const drift = result.drift === true;

  if (drift) {
    return needsDatabaseInput(
      "DATABASE_DRIFT_DETECTED",
      [
        "Remote database drift was detected during deploy-time DB sync.",
        "Do not deploy over unknown live schema changes. Run db-status, add or adopt checked-in migrations, then rerun deploy.",
      ].join(" "),
      {
        projectId,
        bindingId: options.bindingId,
        framework: options.framework,
        migrationCommand: options.migrationCommand,
        migrationResult: result,
        migrationFingerprint: options.migrationFingerprint,
        migrationFingerprintChanged: options.migrationFingerprintChanged,
      },
    );
  }

  if (options.mode !== "apply" && pending > 0) {
    return needsDatabaseInput(
      "DATABASE_MIGRATIONS_PENDING",
      [
        `Detected ${pending} pending checked-in database migration(s).`,
        "Rerun deploy with `--databaseSync apply --databaseSyncConfirm` to apply them before deployment, or rerun with `--databaseSync skip` if you intentionally manage the database separately.",
      ].join(" "),
      {
        projectId,
        bindingId: options.bindingId,
        framework: options.framework,
        migrationCommand: options.migrationCommand,
        migrationResult: result,
        migrationFingerprint: options.migrationFingerprint,
        migrationFingerprintChanged: options.migrationFingerprintChanged,
      },
    );
  }

  return completed({
    action: options.mode === "apply" ? "applied" : "checked",
    reason:
      options.mode === "apply"
        ? "Checked-in database migrations were applied before deployment."
        : "Remote database migration status is safe for deployment.",
    mode: options.mode,
    projectId,
    bindingId: options.bindingId,
    framework: options.framework,
    migrationCommand: options.migrationCommand,
    migrationResult: result,
    migrationFingerprint: options.migrationFingerprint,
    migrationFingerprintChanged: options.migrationFingerprintChanged,
    recordMigrationFingerprint: Boolean(options.migrationFingerprint),
  });
}

function normalizeDatabaseSyncMode(value) {
  const explicit = typeof value === "string" && value.trim().length > 0;
  const normalized = explicit ? value.trim().toLowerCase() : "auto";
  return {
    ok: DATABASE_SYNC_MODES.has(normalized),
    value: normalized,
    explicit,
  };
}

function normalizeDatabase(database) {
  if (!database || typeof database !== "object") return null;
  if (database.detected === false && !database.bindingId) return null;
  return database;
}

function computeFingerprintSafely({ options, context, database }) {
  try {
    return {
      success: true,
      fingerprint: (
        options.computeFingerprintImpl || computeDatabaseMigrationFingerprint
      )({
        cwd: context.cwd,
        serviceRoot:
          (options.detectedConfig && options.detectedConfig.serviceRoot) ||
          options.serviceRoot ||
          ".",
        database,
      }),
    };
  } catch (error) {
    return databaseFailure(
      "DATABASE_MIGRATION_FINGERPRINT_FAILED",
      [
        "Could not inspect checked-in database migration files for deploy-time DB sync.",
        error && error.message ? error.message : String(error),
        "Fix the unreadable path or rerun with `--databaseSync skip` if you intentionally manage the database separately.",
      ].join(" "),
    );
  }
}

function hasExplicitBindingOverride(options) {
  return Boolean(
    normalizeOptionalString(options.databaseBindingId) ||
    normalizeOptionalString(options.bindingId),
  );
}

function resolveBindingId(options) {
  const binding = Array.isArray(options.databaseBindings)
    ? options.databaseBindings[0]
    : null;
  return (
    normalizeOptionalString(options.databaseBindingId) ||
    normalizeOptionalString(options.bindingId) ||
    normalizeOptionalString(options.database && options.database.bindingId) ||
    normalizeOptionalString(binding && binding.bindingId) ||
    normalizeOptionalString(
      options.settings &&
        options.settings.database &&
        options.settings.database.bindingId,
    )
  );
}

function resolveMigrationCommand(options) {
  return (
    normalizeOptionalString(options.migrationCommand) ||
    normalizeOptionalString(
      options.database && options.database.migrationCommand,
    ) ||
    normalizeOptionalString(
      options.settings &&
        options.settings.database &&
        options.settings.database.migrationCommand,
    )
  );
}

function resolveFramework(options) {
  return normalizeFrameworkId(
    normalizeOptionalString(options.framework) ||
      normalizeOptionalString(options.database && options.database.orm) ||
      normalizeOptionalString(options.database && options.database.framework) ||
      normalizeOptionalString(
        options.settings &&
          options.settings.database &&
          options.settings.database.framework,
      ) ||
      inferFrameworkFromCommand(resolveMigrationCommand(options)),
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
  if (lower === "activerecord" || lower === "active_record") return "rails";
  return lower;
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

function isConfirmed(value) {
  return value === true || value === "true" || value === "1";
}

function completed(extra = {}) {
  return {
    success: true,
    needsUserInput: false,
    stage: "completed",
    ...extra,
  };
}

function databaseFailure(reasonCode, message, extra = {}) {
  return {
    success: false,
    needsUserInput: false,
    stage: "database",
    reasonCode,
    message,
    summary: message,
    ...extra,
  };
}

function needsDatabaseInput(reasonCode, message, extra = {}) {
  return {
    success: true,
    needsUserInput: true,
    stage: "database",
    reasonCode,
    message,
    summary: message,
    ...extra,
  };
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

module.exports = {
  evaluateMigrationGate,
  runDeployDatabaseSync,
};
