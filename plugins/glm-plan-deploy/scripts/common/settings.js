"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
}

function removeFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

function clearArbitraryProjectState(settings) {
  delete settings.projectId;
  delete settings.deployments;
  delete settings.env;
  delete settings.envHash;
  delete settings.createTime;
  delete settings.area;
  return settings;
}

function normalizeArbitrarySettings(settings = {}, options = {}) {
  const normalized = { ...settings };
  const projectName = options.projectName;
  const endpoint = options.endpoint;

  if (
    projectName &&
    normalized.projectName &&
    normalized.projectName !== projectName
  ) {
    clearArbitraryProjectState(normalized);
  }

  // Endpoint changes alone do not invalidate project state. Multiple deploy
  // API endpoints can front the same backend environment, so the URL is not
  // a reliable environment signal. Callers that genuinely need per-environment
  // isolation should point ZAI_PROJECT_SETTINGS_PATH at a separate file.
  if (projectName) {
    normalized.projectName = projectName;
  }

  if (endpoint) {
    normalized.endpoint = endpoint;
  }

  return normalized;
}

function loadArbitrarySettings(filePath, options = {}) {
  const projectName =
    options.projectName || path.basename(options.cwd || process.cwd());
  const endpoint = options.endpoint;
  const loaded = readJsonFile(filePath) || {};
  return normalizeArbitrarySettings(loaded, { projectName, endpoint });
}

function saveArbitrarySettings(filePath, settings) {
  writeJsonFile(filePath, settings);
}

function getLatestTaskId(settings) {
  const deployments = Array.isArray(settings.deployments)
    ? settings.deployments
    : [];
  return deployments[0] && deployments[0].taskId ? deployments[0].taskId : null;
}

function readEnvMetadata(projectDir) {
  const envPath = path.join(projectDir, ".env");
  if (!fs.existsSync(envPath)) {
    return {
      hash: null,
      keys: [],
    };
  }

  const envText = fs.readFileSync(envPath, "utf8");
  const keys = [];
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key] = trimmed.split("=", 1);
    if (key && key.trim()) {
      keys.push(key.trim());
    }
  }

  return {
    hash: crypto.createHash("md5").update(envText).digest("hex"),
    keys,
  };
}

module.exports = {
  clearArbitraryProjectState,
  getLatestTaskId,
  loadArbitrarySettings,
  normalizeArbitrarySettings,
  readEnvMetadata,
  readJsonFile,
  removeFileIfExists,
  saveArbitrarySettings,
  writeJsonFile,
};
