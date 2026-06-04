"use strict";

const fs = require("fs");
const path = require("path");

const FRAMEWORK_REQUIREMENTS = [
  {
    packageName: "@angular/core",
    rules: [
      { major: 20, range: ["20.19.0", "22.12.0", "24.0.0"] },
      { major: 19, range: ["18.19.1", "20.11.1", "22.0.0"] },
      { major: 18, range: ["18.19.1", "20.11.1", "22.0.0"] },
      { major: 17, range: ["18.13.0", "20.9.0"] },
    ],
  },
  {
    packageName: "next",
    rules: [
      { major: 16, min: "20.9.0" },
      { major: 15, range: ["18.18.0", "19.8.0", "20.0.0"] },
      { major: 14, min: "18.17.0" },
      { major: 13, min: "18.17.0" },
      { major: 12, range: ["16.0.0", "18.0.0"] },
    ],
  },
  {
    packageName: "vite",
    rules: [
      { major: 7, range: ["20.19.0", "22.12.0"] },
      { major: 6, range: ["18.0.0", "20.0.0", "22.0.0"] },
      { major: 5, range: ["18.0.0", "20.0.0"] },
      { major: 4, min: "16.0.0" },
    ],
  },
  {
    packageName: "@sveltejs/kit",
    rules: [
      { major: 2, min: "18.13.0" },
      { major: 1, min: "16.0.0" },
    ],
  },
  {
    packageName: "astro",
    rules: [
      { major: 5, range: ["18.20.8", "20.3.0", "22.0.0"] },
      { major: 4, min: "18.0.0" },
    ],
  },
  {
    packageName: "@docusaurus/core",
    rules: [
      { major: 3, min: "18.0.0" },
      { major: 2, min: "16.0.0" },
    ],
  },
  {
    packageName: "gatsby",
    rules: [
      { major: 5, min: "18.0.0" },
      { major: 4, min: "14.15.0" },
    ],
  },
  {
    packageName: "express",
    rules: [
      { major: 5, min: "18.17.0" },
      { major: 4, min: "18.17.0" },
    ],
  },
  {
    packageName: "koa",
    rules: [
      { major: 3, min: "18.0.0" },
      { major: 2, min: "12.17.0" },
    ],
  },
  {
    packageName: "nuxt",
    rules: [
      { major: 4, min: "20.0.0" },
      { major: 3, min: "20.0.0" },
      { major: 2, min: "14.0.0" },
    ],
  },
  { packageName: "@remix-run/dev", rules: [{ major: 2, min: "18.0.0" }] },
  { packageName: "react-router", rules: [{ major: 7, min: "20.0.0" }] },
  {
    packageName: "hexo",
    rules: [
      { major: 8, min: "20.19.0" },
      { major: 7, min: "14.0.0" },
      { major: 6, min: "12.13.0" },
      { major: 5, min: "10.13.0" },
    ],
  },
];

function parseVersion(version) {
  const match = String(version || "")
    .trim()
    .replace(/^[^\d]*/, "")
    .replace(/^v/, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
  };
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

function loadPackageJson(projectDir) {
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function detectRequirementFromFiles(projectDir, packageJson) {
  if (
    packageJson &&
    packageJson.engines &&
    typeof packageJson.engines.node === "string"
  ) {
    return packageJson.engines.node;
  }

  for (const fileName of [".nvmrc", ".node-version"]) {
    const value = readTextIfExists(path.join(projectDir, fileName));
    if (value) {
      return value;
    }
  }

  const packageLockPath = path.join(projectDir, "package-lock.json");
  if (fs.existsSync(packageLockPath)) {
    try {
      const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
      if (packageLock.packages && packageLock.packages[""]?.engines?.node) {
        return packageLock.packages[""].engines.node;
      }
    } catch (error) {
      // Ignore malformed lockfiles and continue to framework heuristics.
    }
  }

  return detectRequirementFromFramework(packageJson);
}

function detectRequirementFromFramework(packageJson) {
  if (!packageJson) {
    return null;
  }

  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  for (const framework of FRAMEWORK_REQUIREMENTS) {
    const versionRange = dependencies[framework.packageName];
    if (!versionRange) {
      continue;
    }

    const detectedMajor = parseVersion(versionRange);
    if (!detectedMajor) {
      continue;
    }

    const rule = framework.rules.find(
      (item) => detectedMajor.major >= item.major,
    );
    if (!rule) {
      continue;
    }

    if (rule.range) {
      return `${rule.range[0]}+`;
    }
    return `${rule.min}+`;
  }

  return null;
}

module.exports = {
  detectRequirementFromFiles,
  detectRequirementFromFramework,
  loadPackageJson,
  parseVersion,
};
