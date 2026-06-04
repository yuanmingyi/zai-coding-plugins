"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { fetchWithNetworkRetry, requestJson } = require("../common/http");

const SOURCE_ARCHIVE_NAME = "db-migration-source.tar.gz";

const EXCLUDED_DIRS = new Set([
  ".aider",
  ".claude",
  ".codex",
  ".cursor",
  ".git",
  ".idea",
  ".vscode",
  ".aws",
  ".azure",
  ".bundle",
  ".gcloud",
  ".gnupg",
  ".ssh",
  ".zai",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "test",
  "tests",
  "vendor",
  "venv",
]);

const EXCLUDED_FILES = [
  /^\.DS_Store$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^\.pnpmrc$/,
  /^\.yarnrc(?:\.yml)?$/,
  /\.(test|spec)\.[^.]+$/,
  /^.*_test\.go$/,
  /(^|\/)config\/master\.key$/,
  /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/,
  /\.(?:pem|key|p12|pfx|crt|cer)$/,
  /(^|\/)\.config\/(?:gcloud|gh|hub)\//,
];

async function uploadMigrationSourceArchive(options) {
  const context = options.context;
  const serviceRoot = path.resolve(context.cwd, options.serviceRoot || ".");
  const workDir = resolveMigrationWorkDir(options);
  const sourceDir = path.join(workDir, "source");
  const archivePath = path.join(workDir, SOURCE_ARCHIVE_NAME);
  const apiRecords = [];

  rebuildDir(sourceDir);
  copyServiceFiles(serviceRoot, sourceDir);
  createArchive({ sourceDir, archivePath });

  const archiveSize = fs.statSync(archivePath).size;
  const uploadSizeLimit = Number(options.uploadSizeLimit);
  if (
    Number.isFinite(uploadSizeLimit) &&
    uploadSizeLimit > 0 &&
    archiveSize > uploadSizeLimit
  ) {
    return failure("Migration source archive exceeds upload size limit.", {
      archiveSize,
      uploadSizeLimit,
    });
  }

  const initUpload = await requestJson({
    url: `${context.baseUrl}/client/tcb/initUpload`,
    method: "POST",
    token: context.token,
    body: buildInitUploadBody({
      projectId: options.projectId,
      reserveProject: options.reserveProject,
      archiveName: SOURCE_ARCHIVE_NAME,
    }),
    fetchImpl: options.fetchImpl,
  });
  collectApiRecord(apiRecords, initUpload);

  const archiveFile = findArchiveFile(initUpload.data && initUpload.data.files);
  if (
    !archiveFile ||
    !archiveFile.presignedUploadUrl ||
    !archiveFile.objectKey
  ) {
    return failure(
      `Upload response did not include a presigned URL and objectKey for ${SOURCE_ARCHIVE_NAME}`,
      { apiRecords, apiRecord: last(apiRecords) },
    );
  }

  const uploadResponse = await fetchWithNetworkRetry(
    options.fetchImpl || fetch,
    archiveFile.presignedUploadUrl,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: fs.readFileSync(archivePath),
    },
  );
  if (!uploadResponse.ok) {
    return failure(`Failed to upload migration source archive.`, {
      apiRecords,
      apiRecord: last(apiRecords),
    });
  }

  return {
    success: true,
    archivePath,
    archiveSize,
    projectId:
      (initUpload.data && normalizeOptionalString(initUpload.data.projectId)) ||
      normalizeOptionalString(options.projectId),
    sourceArchiveObjectKey: archiveFile.objectKey,
    apiRecords,
  };
}

function resolveMigrationWorkDir(options) {
  if (typeof options.workDir === "string" && options.workDir.trim()) {
    return path.resolve(options.context.cwd, options.workDir);
  }
  const timestamp = String((options.nowFn || Date.now)());
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  return path.join(
    options.context.cwd,
    ".zai",
    "deploy",
    "arbitrary-db",
    `${timestamp}-${pid}`,
  );
}

function rebuildDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyServiceFiles(serviceRoot, destinationRoot) {
  walkServiceFiles(serviceRoot, (sourcePath, relativePath) => {
    const destinationPath = path.join(destinationRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  });
}

function walkServiceFiles(serviceRoot, onFile, currentDir = serviceRoot) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path
      .relative(serviceRoot, fullPath)
      .replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      walkServiceFiles(serviceRoot, onFile, fullPath);
      continue;
    }

    if (!entry.isFile() || shouldExcludeFile(relativePath)) {
      continue;
    }

    onFile(fullPath, relativePath);
  }
}

function shouldExcludeFile(relativePath) {
  const baseName = path.basename(relativePath);
  if (isSecretEnvFile(baseName)) {
    return true;
  }
  return EXCLUDED_FILES.some(
    (pattern) => pattern.test(baseName) || pattern.test(relativePath),
  );
}

function isSecretEnvFile(baseName) {
  if (!baseName.startsWith(".env")) {
    return false;
  }
  return !(
    baseName.endsWith(".example") ||
    baseName.endsWith(".sample") ||
    baseName.endsWith(".template")
  );
}

function createArchive({ sourceDir, archivePath }) {
  fs.rmSync(archivePath, { force: true });
  try {
    execFileSync("tar", ["-czf", archivePath, "-C", sourceDir, "."], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    const stderr =
      error && error.stderr ? error.stderr.toString().trim() : null;
    const detail = stderr || (error && error.message) || "unknown tar error";
    throw new Error(`Failed to create migration source archive: ${detail}`);
  }
}

function buildInitUploadBody({ projectId, reserveProject, archiveName }) {
  const body = {
    files: [archiveName],
  };
  if (projectId) {
    body.projectId = projectId;
  } else if (reserveProject) {
    body.reserveProject = true;
  }
  return body;
}

function findArchiveFile(files) {
  return (files || []).find(
    (entry) => entry && entry.relativePath === SOURCE_ARCHIVE_NAME,
  );
}

function collectApiRecord(apiRecords, source) {
  if (source && source.apiRecord) {
    apiRecords.push(source.apiRecord);
  }
}

function last(items) {
  return items.length ? items[items.length - 1] : null;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function failure(message, extra = {}) {
  return {
    success: false,
    stage: "sourceArchive",
    message,
    summary: message,
    ...extra,
  };
}

module.exports = {
  SOURCE_ARCHIVE_NAME,
  uploadMigrationSourceArchive,
};
