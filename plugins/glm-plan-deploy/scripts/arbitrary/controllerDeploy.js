"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { resolveDeployContext } = require("../common/auth");
const {
  fetchWithNetworkRetry,
  isInvalidProjectIdError,
  requestJson,
} = require("../common/http");
const {
  clearArbitraryProjectState,
  loadArbitrarySettings,
  saveArbitrarySettings,
} = require("../common/settings");
const {
  buildRuntimeCapabilities,
  normalizeAccessControl,
} = require("./accessControl");
const { runRecordArbitraryDeployment } = require("./recordDeployment");

async function runArbitraryControllerDeploy(options = {}) {
  try {
    const recordDeploymentImpl =
      options.recordDeploymentImpl || runRecordArbitraryDeployment;
    const context = resolveDeployContext(options);
    const packageDir = resolveRequiredPackageDir(
      options.packageDir,
      context.cwd,
    );
    const uploadSizeLimit = resolveUploadSizeLimit(options.uploadSizeLimit);
    const appName = sanitizeAppName(
      options.appName || path.basename(context.cwd),
    );
    const databaseBindings = normalizeDatabaseBindings(
      options.databaseBindings,
    );

    const archive = createPackageArchive(packageDir);
    if (archive.archiveSize > uploadSizeLimit) {
      return failure(
        formatUploadSizeExceededMessage(archive.archiveSize, uploadSizeLimit),
        {
          stage: "initUpload",
          packageSize: archive.archiveSize,
          uploadSizeLimit,
        },
      );
    }

    const settings = loadArbitrarySettings(context.projectSettingsPath, {
      cwd: context.cwd,
      projectName: path.basename(context.cwd),
      endpoint: context.baseUrl,
    });
    saveArbitrarySettings(context.projectSettingsPath, settings);
    const deploymentProjectId =
      normalizeOptionalString(options.projectId) || settings.projectId || null;

    const initUpload = await initUploadWithRetry({
      context,
      packageFiles: [archive.archiveName],
      settings,
      projectId: deploymentProjectId,
      fetchImpl: options.fetchImpl,
    });
    if (!initUpload.success) {
      return initUpload;
    }

    const archiveFile = findArchiveFile(
      initUpload.data.files,
      archive.archiveName,
    );
    if (!archiveFile) {
      return {
        ...failure(
          `Upload response did not include a presigned URL for ${archive.archiveName}`,
          {
            stage: "upload",
            relativePath: archive.archiveName,
          },
        ),
        apiRecords: initUpload.apiRecords || [],
      };
    }
    if (!archiveFile.objectKey) {
      return {
        ...failure(
          `Upload response did not include objectKey for ${archive.archiveName}`,
          {
            stage: "upload",
            relativePath: archive.archiveName,
          },
        ),
        apiRecords: initUpload.apiRecords || [],
      };
    }

    const uploadResult = await uploadPackageFiles({
      archivePath: archive.archivePath,
      archiveName: archive.archiveName,
      archiveFile,
      fetchImpl: options.fetchImpl,
    });
    if (!uploadResult.success) {
      return uploadResult;
    }

    const createTask = await createTaskWithRetry({
      context,
      settingsPath: context.projectSettingsPath,
      archiveObjectKey: archiveFile.objectKey,
      appName,
      projectId:
        normalizeOptionalString(deploymentProjectId) ||
        normalizeOptionalString(initUpload.data.projectId),
      databaseBindings,
      fetchImpl: options.fetchImpl,
    });
    if (!createTask.success) {
      return {
        ...createTask,
        apiRecords: [
          ...(initUpload.apiRecords || []),
          ...(createTask.apiRecords || []),
        ],
      };
    }

    const recordResult = recordDeploymentImpl({
      cwd: context.cwd,
      env: options.env || process.env,
      taskId: createTask.data.taskId,
      projectId: createTask.data.projectId || initUpload.data.projectId || null,
      area: initUpload.data.area || options.area || null,
      now: options.now,
      database: options.database,
      databaseBindings,
    });
    if (!recordResult.success) {
      return {
        ...recordResult,
        stage: "recordDeployment",
      };
    }

    return {
      success: true,
      taskId: createTask.data.taskId,
      projectId: createTask.data.projectId || initUpload.data.projectId || null,
      status: createTask.data.status || null,
      currentStep: createTask.data.currentStep || null,
      accessControl: normalizeAccessControl(createTask.data.accessControl),
      objectPrefix: initUpload.data.objectPrefix || null,
      archiveObjectKey: archiveFile.objectKey,
      area: initUpload.data.area || null,
      uploadedFiles: uploadResult.uploadedFiles,
      apiRecords: [
        ...(initUpload.apiRecords || []),
        ...(createTask.apiRecords || []),
      ],
      summary: `Created arbitrary deployment task ${createTask.data.taskId}`,
    };
  } catch (error) {
    return failure(error.message, {
      stage: "controllerDeploy",
    });
  }
}

async function initUploadWithRetry(options) {
  const { context, packageFiles, settings, fetchImpl } = options;
  const projectId =
    normalizeOptionalString(options.projectId) || settings.projectId || null;
  const apiRecords = [];
  const attempt = async (projectId) => {
    try {
      const response = await requestJson({
        url: `${context.baseUrl}/client/tcb/initUpload`,
        method: "POST",
        token: context.token,
        body: buildInitUploadBody(packageFiles, projectId),
        fetchImpl,
      });
      collectApiRecord(apiRecords, response);
      return response;
    } catch (error) {
      collectApiRecord(apiRecords, error);
      throw error;
    }
  };

  try {
    const response = await attempt(projectId);
    return { success: true, data: response.data || {}, apiRecords };
  } catch (error) {
    if (
      projectId &&
      projectId === settings.projectId &&
      isInvalidProjectIdError(error)
    ) {
      clearArbitraryProjectState(settings);
      saveArbitrarySettings(context.projectSettingsPath, settings);
      try {
        const response = await attempt(null);
        return { success: true, data: response.data || {}, apiRecords };
      } catch (retryError) {
        return failure(retryError.message, {
          stage: "initUpload",
          apiRecords,
          apiRecord: last(apiRecords),
        });
      }
    }

    return failure(error.message, {
      stage: "initUpload",
      apiRecords,
      apiRecord: last(apiRecords),
    });
  }
}

function buildInitUploadBody(packageFiles, projectId) {
  const body = {
    files: packageFiles,
  };
  if (projectId) {
    body.projectId = projectId;
  }
  return body;
}

function findArchiveFile(files, archiveName) {
  return (files || []).find(
    (entry) => entry && entry.relativePath === archiveName,
  );
}

async function uploadPackageFiles(options) {
  const { archivePath, archiveName, archiveFile, fetchImpl = fetch } = options;

  if (!fs.existsSync(archivePath)) {
    return failure(`Package archive is missing locally: ${archivePath}`, {
      stage: "upload",
      relativePath: archiveName,
    });
  }

  const response = await fetchWithNetworkRetry(
    fetchImpl,
    archiveFile.presignedUploadUrl,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: fs.readFileSync(archivePath),
    },
  );

  if (!response.ok) {
    return failure(`Failed to upload package archive: ${archiveName}`, {
      stage: "upload",
      relativePath: archiveName,
    });
  }

  return {
    success: true,
    uploadedFiles: [archiveName],
  };
}

async function createTaskWithRetry(options) {
  const {
    context,
    settingsPath,
    archiveObjectKey,
    appName,
    projectId,
    databaseBindings,
    fetchImpl,
  } = options;
  const apiRecords = [];

  const attempt = async (projectId) => {
    try {
      const response = await requestJson({
        url: `${context.baseUrl}/client/tcb/createTask`,
        method: "POST",
        token: context.token,
        body: buildCreateTaskBody({
          projectId,
          archiveObjectKey,
          appName,
          databaseBindings,
        }),
        fetchImpl,
      });
      collectApiRecord(apiRecords, response);
      return response;
    } catch (error) {
      collectApiRecord(apiRecords, error);
      throw error;
    }
  };

  let settings = loadArbitrarySettings(settingsPath, {
    cwd: context.cwd,
    projectName: path.basename(context.cwd),
    endpoint: context.baseUrl,
  });

  try {
    const response = await attempt(
      normalizeOptionalString(projectId) || settings.projectId,
    );
    return { success: true, data: response.data || {}, apiRecords };
  } catch (error) {
    if (
      settings.projectId &&
      (!projectId || projectId === settings.projectId) &&
      isInvalidProjectIdError(error)
    ) {
      clearArbitraryProjectState(settings);
      saveArbitrarySettings(settingsPath, settings);
      try {
        const response = await attempt(null);
        return { success: true, data: response.data || {}, apiRecords };
      } catch (retryError) {
        return failure(retryError.message, {
          stage: "createTask",
          apiRecords,
          apiRecord: last(apiRecords),
        });
      }
    }

    return failure(error.message, {
      stage: "createTask",
      apiRecords,
      apiRecord: last(apiRecords),
    });
  }
}

function collectApiRecord(apiRecords, source) {
  if (source && source.apiRecord) {
    apiRecords.push(source.apiRecord);
  }
}

function last(items) {
  return items.length ? items[items.length - 1] : null;
}

function buildCreateTaskBody(options) {
  const body = {
    archiveObjectKey: options.archiveObjectKey,
    appName: options.appName,
    runtimeCapabilities: buildRuntimeCapabilities(),
  };
  if (options.projectId) {
    body.projectId = options.projectId;
  }
  if (options.databaseBindings && options.databaseBindings.length) {
    body.databaseBindings = options.databaseBindings;
  }
  return body;
}

function normalizeDatabaseBindings(value) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("`databaseBindings` must be an array.");
  }
  return value.map((binding, index) => {
    if (!binding || typeof binding !== "object") {
      throw new Error(`databaseBindings[${index}] must be an object.`);
    }
    if (typeof binding.bindingId !== "string" || !binding.bindingId.trim()) {
      throw new Error(
        `databaseBindings[${index}].bindingId must be a non-empty string.`,
      );
    }
    if (!binding.env || typeof binding.env !== "object") {
      throw new Error(`databaseBindings[${index}].env must be an object.`);
    }
    const env = {};
    for (const [key, ref] of Object.entries(binding.env)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
        throw new Error(
          `databaseBindings[${index}].env contains invalid env key: ${key}`,
        );
      }
      if (
        typeof ref !== "string" ||
        (!ref.startsWith("valueRef:") && !ref.startsWith("secretRef:"))
      ) {
        throw new Error(
          `databaseBindings[${index}].env.${key} must use valueRef: or secretRef:, not a literal value.`,
        );
      }
      env[key] = ref;
    }
    return {
      bindingId: binding.bindingId.trim(),
      env,
    };
  });
}

function resolveRequiredPackageDir(packageDir, cwd) {
  if (!packageDir) {
    throw new Error("Missing required controller deploy input: `packageDir`.");
  }
  const resolved = path.resolve(cwd, packageDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Package directory does not exist: ${resolved}`);
  }
  return resolved;
}

function resolveUploadSizeLimit(uploadSizeLimit) {
  const value = Number(uploadSizeLimit);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      "Missing required controller deploy input: `uploadSizeLimit` must be a positive number.",
    );
  }
  return value;
}

const ARCHIVE_NAME = "deploy-package.tar.gz";

function createPackageArchive(packageDir) {
  const archivePath = path.join(path.dirname(packageDir), ARCHIVE_NAME);
  fs.rmSync(archivePath, { force: true });

  try {
    execFileSync("tar", ["-czf", archivePath, "-C", packageDir, "."], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    const stderr =
      error && error.stderr ? error.stderr.toString().trim() : null;
    const detail = stderr || (error && error.message) || "unknown tar error";
    throw new Error(`Failed to create package archive with tar: ${detail}`);
  }

  const archiveSize = fs.statSync(archivePath).size;
  return { archivePath, archiveSize, archiveName: ARCHIVE_NAME };
}

function formatUploadSizeExceededMessage(totalSize, limit) {
  return [
    "❌ **Upload size limit exceeded**",
    `- Compressed package size: ${formatBytes(totalSize)}`,
    `- Upload size limit: ${formatBytes(limit)}`,
    "- Action required: Reduce the package size by excluding unnecessary files (tests, docs, large assets, etc.)",
  ].join("\n");
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function sanitizeAppName(appName) {
  const value = String(appName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "app";
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  runArbitraryControllerDeploy,
};
