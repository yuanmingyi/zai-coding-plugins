"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_MAX_FILES = 5;

function collectClaudeLogPaths(options = {}) {
  const env = options.env || process.env;
  if (env.ZAI_DEPLOY_DEBUG !== "1") {
    return null;
  }

  try {
    const cwd = options.cwd || process.cwd();
    const homeDir = options.homeDir || env.HOME || os.homedir();
    if (!homeDir) {
      return null;
    }
    const fsImpl = options.fsImpl || fs;
    const maxFiles = Number.isFinite(options.maxFiles)
      ? Math.max(0, Math.floor(options.maxFiles))
      : DEFAULT_MAX_FILES;

    const projectLogDir = path.join(
      homeDir,
      ".claude",
      "projects",
      mangleCwd(cwd),
    );

    if (!fsImpl.existsSync(projectLogDir)) {
      return { projectLogDir, jsonlFiles: [] };
    }

    const entries = fsImpl.readdirSync(projectLogDir, { withFileTypes: true });
    const jsonlFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => {
        const filePath = path.join(projectLogDir, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fsImpl.statSync(filePath).mtimeMs;
        } catch (_) {
          mtimeMs = 0;
        }
        return { filePath, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, maxFiles)
      .map((item) => item.filePath);

    return { projectLogDir, jsonlFiles };
  } catch (_) {
    return null;
  }
}

function mangleCwd(cwd) {
  return String(cwd).replace(/\//g, "-");
}

// Build a minimal, formatter-independent debug-logs string used as a
// fallback when the box-drawing report formatter fails. The "[Debug Logs]"
// prefix and the line shape are intentionally simple — they don't depend
// on the template loader, so they survive any rendering error.
function formatDebugLogsFallback(claudeLogPaths) {
  if (!claudeLogPaths || typeof claudeLogPaths !== "object") return null;
  const projectLogDir =
    typeof claudeLogPaths.projectLogDir === "string"
      ? claudeLogPaths.projectLogDir
      : "";
  if (!projectLogDir) return null;
  const files = Array.isArray(claudeLogPaths.jsonlFiles)
    ? claudeLogPaths.jsonlFiles.filter(
        (item) => typeof item === "string" && item.length > 0,
      )
    : [];
  const lines = [
    "[Debug Logs (ZAI_DEPLOY_DEBUG=1)]",
    `Project Dir: ${projectLogDir}`,
  ];
  if (files.length === 0) {
    lines.push("Sessions: (none)");
  } else {
    lines.push("Sessions:");
    for (const file of files) {
      lines.push(`  ${file}`);
    }
  }
  return lines.join("\n");
}

module.exports = {
  collectClaudeLogPaths,
  formatDebugLogsFallback,
  mangleCwd,
};
