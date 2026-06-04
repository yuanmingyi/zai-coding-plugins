"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FINGERPRINT_ALGORITHM = "sha256-db-migrations-v1";
const HASH_CHUNK_BYTES = 64 * 1024;

const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  ".zai",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv",
]);

function computeDatabaseMigrationFingerprint(options = {}) {
  const cwd = options.cwd || process.cwd();
  const serviceRoot = path.resolve(cwd, options.serviceRoot || ".");
  if (!fs.existsSync(serviceRoot)) {
    return emptyFingerprint();
  }

  const files = collectMigrationFiles(serviceRoot);
  if (!files.length) {
    return emptyFingerprint();
  }

  const hash = crypto.createHash("sha256");
  for (const relativePath of files) {
    const absolutePath = path.join(serviceRoot, relativePath);
    hash.update(relativePath);
    hash.update("\0");
    hashFile(hash, absolutePath);
    hash.update("\0");
  }

  return {
    algorithm: FINGERPRINT_ALGORITHM,
    hash: hash.digest("hex"),
    files,
  };
}

function emptyFingerprint() {
  return {
    algorithm: FINGERPRINT_ALGORITHM,
    hash: null,
    files: [],
  };
}

function collectMigrationFiles(serviceRoot) {
  const files = [];
  const seenFileRealPaths = new Set();
  const rootRealPath = fs.realpathSync.native(serviceRoot);
  walkFiles(serviceRoot, {
    currentDir: serviceRoot,
    logicalDir: serviceRoot,
    rootRealPath,
    ancestorDirs: new Set([rootRealPath]),
    onFile: (absolutePath, relativePath) => {
      if (isDatabaseMigrationFile(relativePath)) {
        const realPath = fs.realpathSync.native(absolutePath);
        if (seenFileRealPaths.has(realPath)) {
          return;
        }
        seenFileRealPaths.add(realPath);
        files.push(relativePath);
      }
    },
  });
  return files.sort();
}

function walkFiles(rootDir, options) {
  const { currentDir, logicalDir, rootRealPath, ancestorDirs, onFile } =
    options;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = path.join(currentDir, entry.name);
    const logicalPath = path.join(logicalDir, entry.name);
    const relativePath = path
      .relative(rootDir, logicalPath)
      .replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        const realPath = fs.realpathSync.native(absolutePath);
        if (!ancestorDirs.has(realPath)) {
          const nextAncestorDirs = new Set(ancestorDirs);
          nextAncestorDirs.add(realPath);
          walkFiles(rootDir, {
            currentDir: absolutePath,
            logicalDir: logicalPath,
            rootRealPath,
            ancestorDirs: nextAncestorDirs,
            onFile,
          });
        }
      }
      continue;
    }
    if (entry.isFile()) {
      onFile(absolutePath, relativePath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      walkSymlink(rootDir, {
        absolutePath,
        logicalPath,
        relativePath,
        rootRealPath,
        ancestorDirs,
        onFile,
      });
    }
  }
}

function walkSymlink(
  rootDir,
  {
    absolutePath,
    logicalPath,
    relativePath,
    rootRealPath,
    ancestorDirs,
    onFile,
  },
) {
  let realPath;
  let stat;
  try {
    realPath = fs.realpathSync.native(absolutePath);
    if (!isInsideRoot(realPath, rootRealPath)) {
      return;
    }
    stat = fs.statSync(absolutePath);
  } catch (_) {
    return;
  }

  if (stat.isDirectory()) {
    if (ancestorDirs.has(realPath)) {
      return;
    }
    const nextAncestorDirs = new Set(ancestorDirs);
    nextAncestorDirs.add(realPath);
    walkFiles(rootDir, {
      currentDir: absolutePath,
      logicalDir: logicalPath,
      rootRealPath,
      ancestorDirs: nextAncestorDirs,
      onFile,
    });
    return;
  }

  if (stat.isFile()) {
    onFile(absolutePath, relativePath);
  }
}

function isInsideRoot(realPath, rootRealPath) {
  const relative = path.relative(rootRealPath, realPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function hashFile(hash, absolutePath) {
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  const fd = fs.openSync(absolutePath, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
}

function isDatabaseMigrationFile(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const baseName = path.posix.basename(normalized);

  if (normalized === "prisma/schema.prisma") return true;
  if (normalized.startsWith("prisma/migrations/")) return true;
  if (baseName === "schema.prisma") return true;
  if (normalized.includes("/prisma/migrations/")) return true;
  if (
    normalized.startsWith("migrations/versions/") &&
    baseName.endsWith(".py") &&
    baseName !== "__init__.py"
  ) {
    return true;
  }
  if (normalized.startsWith("db/migrations/")) {
    return hasVersionedMigrationPath(normalized);
  }
  if (normalized.includes("/db/migrations/")) {
    return hasVersionedMigrationPath(normalized);
  }
  if (normalized.startsWith("migrations/")) {
    return hasVersionedMigrationPath(normalized);
  }
  if (normalized.startsWith("database/migrations/")) {
    return hasVersionedMigrationPath(normalized);
  }
  if (normalized.startsWith("db/migrate/")) return true;
  if (normalized.startsWith("db/migration/")) return true;
  if (normalized.startsWith("alembic/versions/")) return true;
  if (normalized.startsWith("src/main/resources/db/migration/")) return true;
  if (normalized.startsWith("src/main/resources/db/changelog/")) return true;
  if (normalized.startsWith("liquibase/")) return true;
  if (/\/migrations\/\d{4}_.+\.py$/.test(normalized)) {
    return true;
  }

  return false;
}

function hasVersionedMigrationPath(normalized) {
  const parts = normalized.split("/");
  const migrationIndex = parts.lastIndexOf("migrations");
  if (migrationIndex < 0) return false;
  return parts
    .slice(migrationIndex + 1)
    .some(
      (segment) =>
        isVersionedMigrationSegment(segment) || isSqlMigrationFile(segment),
    );
}

function isVersionedMigrationSegment(segment) {
  return /^(?:\d+|v\d+__)/i.test(segment);
}

function isSqlMigrationFile(segment) {
  return /\.sql$/i.test(segment);
}

module.exports = {
  FINGERPRINT_ALGORITHM,
  computeDatabaseMigrationFingerprint,
  isDatabaseMigrationFile,
};
