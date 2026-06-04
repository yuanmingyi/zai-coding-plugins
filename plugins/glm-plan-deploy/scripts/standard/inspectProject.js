"use strict";

const fs = require("fs");
const path = require("path");

function detectFramework(packageJson) {
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  if (dependencies["@angular/core"]) return "angular";
  if (dependencies.next) return "nextjs";
  if (dependencies["@sveltejs/kit"]) return "sveltekit";
  if (dependencies.astro) return "astro";
  if (dependencies.nuxt) return "nuxt";
  if (dependencies["gatsby"]) return "gatsby";
  if (dependencies["express"]) return "express";
  if (dependencies.vite) return "vite";
  return "nodejs";
}

function detectBuildCommand(packageJson, projectDir) {
  const scripts = packageJson.scripts || {};
  if (!scripts.build) {
    return null;
  }

  const packageManager = detectPackageManager(packageJson, projectDir);
  if (packageManager === "pnpm") {
    return "pnpm install --frozen-lockfile && pnpm build";
  }
  if (packageManager === "yarn") {
    return "yarn install --frozen-lockfile && yarn build";
  }
  return "npm ci && npm run build";
}

function detectPackageManager(packageJson, projectDir) {
  if (packageJson.packageManager) {
    if (packageJson.packageManager.startsWith("pnpm@")) return "pnpm";
    if (packageJson.packageManager.startsWith("yarn@")) return "yarn";
    if (packageJson.packageManager.startsWith("npm@")) return "npm";
  }

  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

// Returns the richer spec used by the Dockerfile.build preamble:
//   { name: "pnpm" | "yarn", versionSpec: "10.6.5" | "10" | "latest", source }
// or `null` when no preamble is needed (npm-only, or classic yarn which
// node:*-slim already bundles).
//
// Sources:
//   "packageManager" — exact pin from package.json `packageManager` field.
//   "lockfile"       — derived from lockfile metadata, major-bounded.
//   "buildCommand"   — last-resort hint with no version.
function detectPackageManagerSpec(packageJson, projectDir, options = {}) {
  if (typeof packageJson.packageManager === "string") {
    const match = packageJson.packageManager.match(
      /^(pnpm|yarn|npm)@([0-9][^\s+]*)/,
    );
    if (match) {
      const [, name, versionSpec] = match;
      if (name === "npm") return null; // npm already in base image
      if (name === "yarn" && isClassicYarn(versionSpec)) return null;
      return { name, versionSpec, source: "packageManager" };
    }
  }

  const pnpmLockPath = path.join(projectDir, "pnpm-lock.yaml");
  if (fs.existsSync(pnpmLockPath)) {
    const versionSpec = pnpmMajorFromLockfile(pnpmLockPath);
    return { name: "pnpm", versionSpec, source: "lockfile" };
  }

  // Classic yarn.lock is fine — node:*-slim already ships `yarn` v1, and we
  // can't tell yarn 1 vs berry apart from the lockfile alone. Berry projects
  // always set `packageManager` (handled above) or `.yarnrc.yml` (rare).
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
    return null;
  }

  if (typeof options.buildCommand === "string") {
    const cmd = options.buildCommand.trim();
    if (cmd.startsWith("pnpm ")) {
      return { name: "pnpm", versionSpec: null, source: "buildCommand" };
    }
    if (cmd.startsWith("yarn ")) {
      return { name: "yarn", versionSpec: null, source: "buildCommand" };
    }
  }

  return null;
}

function isClassicYarn(versionSpec) {
  return /^1\./.test(versionSpec);
}

// Map pnpm-lock.yaml `lockfileVersion` to the latest pnpm major that still
// reads the file. Conservative; covers what npmjs.com publishes today.
//   9.x / 7.x lockfileVersion → pnpm 10  (current major)
//   6.x                      → pnpm 8
//   5.x                      → pnpm 7
function pnpmMajorFromLockfile(lockfilePath) {
  try {
    const head = fs.readFileSync(lockfilePath, "utf8").slice(0, 200);
    const m = head.match(/lockfileVersion:\s*['"]?(\d+)(?:\.\d+)?['"]?/);
    if (!m) return "latest";
    const major = Number(m[1]);
    if (major >= 7) return "10";
    if (major === 6) return "8";
    if (major === 5) return "7";
    return "latest";
  } catch (_) {
    return "latest";
  }
}

module.exports = {
  detectBuildCommand,
  detectFramework,
  detectPackageManager,
  detectPackageManagerSpec,
};
