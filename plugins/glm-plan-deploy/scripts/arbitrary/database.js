"use strict";

const path = require("path");

const { resolveDeployContext } = require("../common/auth");
const { requestJson } = require("../common/http");
const { SOURCE_ARCHIVE_NAME } = require("./sourceArchive");

const DEFAULT_DATABASE_OPERATION_TIMEOUT_MS = 120_000;
const DEFAULT_DATABASE_OPERATION_POLL_MS = 2_000;

async function resolveDatabaseBindings(options = {}) {
  const mode = normalizeDatabaseMode(options.mode);
  if (!mode || mode === "skip" || mode === "external") {
    return {
      success: true,
      database: buildResolvedDatabase(options.detectedDatabase, mode),
      databaseBindings: [],
      apiRecords: [],
    };
  }

  if (mode !== "managed") {
    return failure(`Unsupported database mode: ${options.mode || ""}`);
  }

  const detectedDatabase = normalizeDetectedDatabase(options.detectedDatabase);
  const type = normalizeDatabaseType(options.type || detectedDatabase.type);
  if (type !== "mysql") {
    return failure(
      "Managed database provisioning currently supports MySQL only. Use `--databaseMode external` for PostgreSQL or other databases.",
    );
  }

  const context = resolveDeployContext(options);
  const appName = sanitizeAppName(
    options.appName || path.basename(context.cwd),
  );
  let projectId = normalizeOptionalString(options.projectId);
  const requestJsonImpl = options.requestJsonImpl || requestJson;
  const apiRecords = [];

  try {
    if (!projectId && options.reserveProject !== false) {
      const reservation = await reserveProjectForDatabase({
        context,
        requestJsonImpl,
        fetchImpl: options.fetchImpl,
      });
      collectApiRecord(apiRecords, reservation);
      projectId = normalizeOptionalString(
        reservation.data && reservation.data.projectId,
      );
      if (!projectId) {
        return failure(
          "Database project reservation did not return projectId.",
          {
            apiRecords,
            apiRecord: last(apiRecords),
          },
        );
      }
    }

    const plan = await requestJsonImpl({
      url: `${context.baseUrl}/client/tcb/database/plan`,
      method: "POST",
      token: context.token,
      body: buildPlanBody({
        projectId,
        appName,
        detectedDatabase: { ...detectedDatabase, type },
        mode,
      }),
      fetchImpl: options.fetchImpl,
    });
    collectApiRecord(apiRecords, plan);

    const prepare = await requestJsonImpl({
      url: `${context.baseUrl}/client/tcb/database/prepare`,
      method: "POST",
      token: context.token,
      body: buildPrepareBody({
        projectId,
        appName,
        mode,
        type,
      }),
      fetchImpl: options.fetchImpl,
    });
    collectApiRecord(apiRecords, prepare);

    const prepared = await resolvePreparedOperation({
      context,
      prepareData: prepare.data || {},
      requestJsonImpl,
      fetchImpl: options.fetchImpl,
      apiRecords,
      timeoutMs: options.databaseOperationTimeoutMs,
      pollIntervalMs: options.databaseOperationPollMs,
      sleepFn: options.sleepFn,
      nowFn: options.nowFn,
    });
    if (!prepared.success) {
      return prepared;
    }

    const bindingId = prepared.bindingId;
    return {
      success: true,
      projectId,
      database: {
        ...buildResolvedDatabase(detectedDatabase, mode),
        type,
        bindingId,
        operationId: prepared.operationId || null,
      },
      databaseBindings: [
        {
          bindingId,
          env: buildManagedMysqlEnvBinding(detectedDatabase),
        },
      ],
      apiRecords,
    };
  } catch (error) {
    collectApiRecord(apiRecords, error);
    return failure(error.message, {
      apiRecords,
      apiRecord: last(apiRecords),
    });
  }
}

async function reserveProjectForDatabase({
  context,
  requestJsonImpl,
  fetchImpl,
}) {
  return requestJsonImpl({
    url: `${context.baseUrl}/client/tcb/initUpload`,
    method: "POST",
    token: context.token,
    body: {
      reserveProject: true,
      files: [SOURCE_ARCHIVE_NAME],
    },
    fetchImpl,
  });
}

function buildPlanBody({ projectId, appName, detectedDatabase, mode }) {
  const body = {
    appName,
    detected: {
      type: detectedDatabase.type,
      requiredEnv: normalizeStringArray(detectedDatabase.requiredEnv),
    },
    mode,
  };
  if (projectId) {
    body.projectId = projectId;
  }
  if (detectedDatabase.orm) {
    body.detected.orm = detectedDatabase.orm;
  }
  if (detectedDatabase.migrationCommand) {
    body.detected.migrationCommand = detectedDatabase.migrationCommand;
  }
  return body;
}

function buildPrepareBody({ projectId, appName, mode, type }) {
  const body = {
    appName,
    mode,
    type,
  };
  if (projectId) {
    body.projectId = projectId;
  }
  return body;
}

async function resolvePreparedOperation(options) {
  const prepareData = options.prepareData || {};
  const operationId = normalizeOptionalString(prepareData.operationId);
  if (
    String(prepareData.status || "").toLowerCase() === "success" &&
    normalizeOptionalString(prepareData.bindingId)
  ) {
    return {
      success: true,
      operationId,
      bindingId: normalizeOptionalString(prepareData.bindingId),
    };
  }

  if (!operationId) {
    return failure("Database prepare did not return a completed binding.");
  }

  const nowFn = options.nowFn || Date.now;
  const startedAt = nowFn();
  const timeoutMs = normalizePositiveNumber(
    options.timeoutMs,
    DEFAULT_DATABASE_OPERATION_TIMEOUT_MS,
  );
  const pollIntervalMs = normalizePositiveNumber(
    options.pollIntervalMs,
    DEFAULT_DATABASE_OPERATION_POLL_MS,
  );
  const sleepFn =
    options.sleepFn ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  while (nowFn() - startedAt <= timeoutMs) {
    const operation = await options.requestJsonImpl({
      url: `${options.context.baseUrl}/client/tcb/database/operations/${encodeURIComponent(operationId)}`,
      token: options.context.token,
      fetchImpl: options.fetchImpl,
    });
    collectApiRecord(options.apiRecords, operation);
    const data = operation.data || {};
    const status = String(data.status || "").toLowerCase();
    const binding = data.binding || {};
    const bindingId =
      normalizeOptionalString(binding.bindingId) ||
      normalizeOptionalString(data.bindingId);

    if (status === "success" && bindingId) {
      return {
        success: true,
        operationId,
        bindingId,
      };
    }
    if (status === "failed") {
      return failure(data.errorMessage || "Database prepare failed.", {
        apiRecords: options.apiRecords,
        apiRecord: last(options.apiRecords),
      });
    }

    await sleepFn(pollIntervalMs);
  }

  return failure("Database prepare timed out before a binding was ready.", {
    apiRecords: options.apiRecords,
    apiRecord: last(options.apiRecords),
  });
}

function buildManagedMysqlEnvBinding(detectedDatabase) {
  const env = {};
  const requiredEnv = new Set(
    normalizeStringArray(detectedDatabase.requiredEnv),
  );
  requiredEnv.add("DATABASE_URL");
  for (const key of requiredEnv) {
    if (key === "MYSQL_HOST") {
      env[key] = "valueRef:host";
    } else if (key === "MYSQL_PORT") {
      env[key] = "valueRef:port";
    } else if (key === "MYSQL_DATABASE") {
      env[key] = "valueRef:database";
    } else if (key === "MYSQL_USER") {
      env[key] = "valueRef:username";
    } else {
      env[key] = `secretRef:${key}`;
    }
  }

  return {
    ...env,
    MYSQL_DATABASE: env.MYSQL_DATABASE || "valueRef:database",
    MYSQL_HOST: env.MYSQL_HOST || "valueRef:host",
    MYSQL_PORT: env.MYSQL_PORT || "valueRef:port",
    MYSQL_USER: env.MYSQL_USER || "valueRef:username",
  };
}

function buildResolvedDatabase(detectedDatabase, mode) {
  const database = normalizeDetectedDatabase(detectedDatabase);
  return {
    ...database,
    mode: mode || null,
  };
}

function normalizeDetectedDatabase(value) {
  if (!value || typeof value !== "object") {
    return {
      detected: false,
      type: "unknown",
      requiredEnv: [],
      orm: null,
      migrationCommand: null,
    };
  }

  return {
    detected: value.detected === true,
    type: normalizeDatabaseType(value.type) || "unknown",
    requiredEnv: normalizeStringArray(value.requiredEnv),
    orm: normalizeOptionalString(value.orm),
    migrationCommand: normalizeOptionalString(value.migrationCommand),
  };
}

function normalizeDatabaseMode(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  return normalized.toLowerCase();
}

function normalizeDatabaseType(value) {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "postgres") return "postgresql";
  return normalized;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = normalizeOptionalString(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function collectApiRecord(apiRecords, source) {
  if (source && source.apiRecord) {
    apiRecords.push(source.apiRecord);
  }
}

function last(items) {
  return items.length ? items[items.length - 1] : null;
}

function sanitizeAppName(appName) {
  const value = String(appName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "app";
}

function failure(message, extra = {}) {
  return {
    success: false,
    stage: "database",
    message,
    summary: message,
    ...extra,
  };
}

module.exports = {
  normalizeDatabaseMode,
  normalizeDatabaseType,
  resolveDatabaseBindings,
};
