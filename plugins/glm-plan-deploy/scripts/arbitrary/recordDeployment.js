"use strict";

const path = require("path");

const { resolveDeployContext } = require("../common/auth");
const {
  loadArbitrarySettings,
  readEnvMetadata,
  saveArbitrarySettings,
} = require("../common/settings");

function runRecordArbitraryDeployment(options = {}) {
  try {
    if (!options.taskId) {
      return failure("Missing required deployment state: `taskId`.");
    }

    const context = resolveDeployContext(options);
    const settings = loadArbitrarySettings(context.projectSettingsPath, {
      cwd: context.cwd,
      projectName: path.basename(context.cwd),
      endpoint: context.baseUrl,
    });
    const now = options.now || new Date().toISOString();
    const envMetadata = readEnvMetadata(context.cwd);

    settings.projectName = path.basename(context.cwd);
    settings.endpoint = context.baseUrl;

    if (options.projectId) {
      if (settings.projectId !== options.projectId) {
        settings.createTime = now;
      }
      settings.projectId = options.projectId;
    }

    if (options.area) {
      settings.area = options.area;
    }

    settings.env = envMetadata.keys;
    settings.envHash = envMetadata.hash;
    settings.deployments = prependDeployment(settings.deployments, {
      taskId: options.taskId,
      date: now,
    });
    const databaseState = normalizeDatabaseState(
      options.database,
      options.databaseBindings,
    );
    if (databaseState) {
      settings.database = databaseState;
    } else if (
      options.database !== undefined ||
      options.databaseBindings !== undefined
    ) {
      delete settings.database;
    }

    saveArbitrarySettings(context.projectSettingsPath, settings);

    return {
      success: true,
      projectId: settings.projectId || null,
      taskId: options.taskId,
      settingsPath: context.projectSettingsPath,
      summary: `Recorded deployment state in ${context.projectSettingsPath}`,
    };
  } catch (error) {
    return failure(error.message);
  }
}

function prependDeployment(existingDeployments, nextDeployment) {
  const deployments = Array.isArray(existingDeployments)
    ? existingDeployments
    : [];
  return [
    nextDeployment,
    ...deployments
      .filter((item) => item && item.taskId !== nextDeployment.taskId)
      .map(stripLegacyEnvType),
  ];
}

function stripLegacyEnvType(entry) {
  if (!entry || typeof entry !== "object" || !("envType" in entry)) {
    return entry;
  }
  const { envType: _legacy, ...rest } = entry;
  void _legacy;
  return rest;
}

function normalizeDatabaseState(database, databaseBindings) {
  const binding = Array.isArray(databaseBindings) ? databaseBindings[0] : null;
  const bindingId =
    normalizeOptionalString(database && database.bindingId) ||
    normalizeOptionalString(binding && binding.bindingId);
  if (!bindingId) {
    return null;
  }

  const state = {
    bindingId,
    envKeys: binding && binding.env ? Object.keys(binding.env).sort() : [],
  };

  const mode = normalizeOptionalString(database && database.mode);
  if (mode) state.mode = mode;
  const type = normalizeOptionalString(database && database.type);
  if (type) state.type = type;
  const framework =
    normalizeOptionalString(database && database.orm) ||
    normalizeOptionalString(database && database.framework);
  if (framework) state.framework = framework;
  const migrationCommand = normalizeOptionalString(
    database && database.migrationCommand,
  );
  if (migrationCommand) state.migrationCommand = migrationCommand;
  const migrationFingerprint = normalizeOptionalString(
    database && database.migrationFingerprint,
  );
  if (migrationFingerprint) state.migrationFingerprint = migrationFingerprint;
  const lastMigrationSyncAction = normalizeOptionalString(
    database && database.lastMigrationSyncAction,
  );
  if (lastMigrationSyncAction) {
    state.lastMigrationSyncAction = lastMigrationSyncAction;
  }

  return state;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function failure(message) {
  return {
    success: false,
    message,
    summary: message,
  };
}

module.exports = {
  normalizeDatabaseState,
  runRecordArbitraryDeployment,
};
