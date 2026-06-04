"use strict";

const fs = require("fs");
const path = require("path");

const EXCLUDED_DIRS = new Set([
  ".aider",
  ".claude",
  ".codex",
  ".cursor",
  ".git",
  ".idea",
  ".vscode",
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
  /^\.env$/,
  /^\.DS_Store$/,
  /\.(test|spec)\.[^.]+$/,
  /^.*_test\.go$/,
];

async function runArbitraryPackageProject(options = {}) {
  try {
    const cwd = options.cwd || process.cwd();
    const agentWorkDir = resolveRequiredDir(
      options.agentWorkDir,
      "agentWorkDir",
      cwd,
    );
    const serviceRoot = path.resolve(cwd, options.serviceRoot || ".");
    const packageDir = path.join(agentWorkDir, "deploy-package");

    ensureRequiredGeneratedFiles(agentWorkDir);
    rebuildPackageDir(packageDir);
    copyGeneratedArtifacts(agentWorkDir, packageDir);
    copyServiceFiles(serviceRoot, packageDir);
    const validation = validateDockerfilePaths(packageDir);
    if (!validation.success) {
      return validation;
    }

    return {
      success: true,
      packageDir,
      copiedFiles: listFiles(packageDir),
      summary: `Built deployment package in ${packageDir}`,
    };
  } catch (error) {
    return failure(error.message);
  }
}

function resolveRequiredDir(value, fieldName, cwd) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required package input: \`${fieldName}\`.`);
  }

  return path.resolve(cwd, value);
}

const REQUIRED_GENERATED_ARTIFACTS = [
  "Dockerfile.build",
  "Dockerfile.run",
  "buildDockerImage.sh",
  "nginx.conf.template",
  "entrypoint.sh",
  "nginx-access-control.sh",
];

const EXECUTABLE_GENERATED_ARTIFACTS = new Set([
  "buildDockerImage.sh",
  "entrypoint.sh",
  "nginx-access-control.sh",
]);

function ensureRequiredGeneratedFiles(agentWorkDir) {
  for (const fileName of REQUIRED_GENERATED_ARTIFACTS) {
    const filePath = path.join(agentWorkDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing generated artifact: ${filePath}`);
    }
  }
}

function rebuildPackageDir(packageDir) {
  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });
}

function copyGeneratedArtifacts(agentWorkDir, packageDir) {
  for (const fileName of REQUIRED_GENERATED_ARTIFACTS) {
    const sourcePath = path.join(agentWorkDir, fileName);
    const destinationPath = path.join(packageDir, fileName);
    fs.copyFileSync(sourcePath, destinationPath);
    if (EXECUTABLE_GENERATED_ARTIFACTS.has(fileName)) {
      fs.chmodSync(destinationPath, 0o755);
    }
  }
}

function copyServiceFiles(serviceRoot, packageDir) {
  walkServiceFiles(serviceRoot, (sourcePath, relativePath) => {
    // Never let stale files in the user's project root (left over from a
    // previous deploy attempt or a hand-authored Dockerfile) overwrite the
    // freshly-rendered scripted artifacts we just placed in packageDir.
    // The rendered versions are the source of truth.
    if (RESERVED_PACKAGE_FILES.has(relativePath)) {
      return;
    }
    const destinationPath = path.join(packageDir, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  });
}

const RESERVED_PACKAGE_FILES = new Set(REQUIRED_GENERATED_ARTIFACTS);

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

    if (!entry.isFile()) {
      continue;
    }

    if (shouldExcludeFile(relativePath)) {
      continue;
    }

    onFile(fullPath, relativePath);
  }
}

function shouldExcludeFile(relativePath) {
  const baseName = path.basename(relativePath);
  return EXCLUDED_FILES.some(
    (pattern) => pattern.test(baseName) || pattern.test(relativePath),
  );
}

function validateDockerfilePaths(packageDir) {
  for (const fileName of ["Dockerfile.build", "Dockerfile.run"]) {
    const dockerfilePath = path.join(packageDir, fileName);
    const content = fs.readFileSync(dockerfilePath, "utf8");
    const instructions = parseCopyAddInstructions(content);
    for (const instruction of instructions) {
      for (const source of instruction.sources) {
        if (source === "." || source === "./") {
          continue;
        }
        if (!pathExistsInPackage(packageDir, source)) {
          return failure(
            `Dockerfile validation failed: \`${fileName}\` references missing path \`${source}\`.`,
          );
        }
      }
    }
  }

  return { success: true };
}

function parseCopyAddInstructions(content) {
  const instructions = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(COPY|ADD)\s+(.+)$/i.exec(line);
    if (!match) {
      continue;
    }

    const parsed = parseCopySources(match[2]);
    if (parsed.sources.length) {
      instructions.push(parsed);
    }
  }
  return instructions;
}

function parseCopySources(argumentText) {
  let text = argumentText.trim();
  let hasExternalSource = false;
  while (text.startsWith("--")) {
    const spaceIndex = text.indexOf(" ");
    if (spaceIndex === -1) {
      return { sources: [] };
    }
    const flag = text.slice(0, spaceIndex);
    if (/^--from(=|$)/.test(flag)) {
      hasExternalSource = true;
    }
    text = text.slice(spaceIndex + 1).trim();
  }

  if (text.startsWith("[")) {
    try {
      const values = JSON.parse(text);
      if (!Array.isArray(values) || values.length < 2) {
        return { sources: [] };
      }
      return {
        sources: hasExternalSource
          ? []
          : values.slice(0, -1).map(normalizeDockerPath),
      };
    } catch (error) {
      return { sources: [] };
    }
  }

  const parts = text.split(/\s+/).map(normalizeDockerPath);
  if (parts.length < 2) {
    return { sources: [] };
  }
  return {
    sources: hasExternalSource ? [] : parts.slice(0, -1),
  };
}

function normalizeDockerPath(value) {
  return value.replace(/^["']|["']$/g, "").replace(/\\/g, "/");
}

function pathExistsInPackage(packageDir, source) {
  const normalized = source.replace(/^\.\/+/, "");
  if (normalized.includes("*")) {
    return hasGlobMatch(packageDir, normalized);
  }
  return fs.existsSync(path.join(packageDir, normalized));
}

function hasGlobMatch(packageDir, pattern) {
  const normalizedPattern = pattern.replace(/^\.\/+/, "");
  const regex = new RegExp(
    `^${normalizedPattern.split("*").map(escapeRegex).join(".*")}$`,
  );
  return listFiles(packageDir).some((filePath) => regex.test(filePath));
}

function listFiles(rootDir) {
  const results = [];
  const queue = [rootDir];

  while (queue.length) {
    const currentDir = queue.shift();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        results.push(path.relative(rootDir, fullPath).replace(/\\/g, "/"));
      }
    }
  }

  return results.sort();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function failure(message) {
  return {
    success: false,
    message,
    summary: message,
  };
}

module.exports = {
  runArbitraryPackageProject,
};
