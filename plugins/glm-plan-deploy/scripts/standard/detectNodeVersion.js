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

function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  if (!a || !b) {
    return 0;
  }

  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

function sortVersions(versions) {
  return [...versions].sort(compareVersions);
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

function parseAlternatives(requirement) {
  return String(requirement || "")
    .split("||")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickSupportedVersion(requirement, supportedVersions) {
  if (
    !requirement ||
    !Array.isArray(supportedVersions) ||
    supportedVersions.length === 0
  ) {
    return null;
  }

  const versions = sortVersions(supportedVersions);
  const alternatives = parseAlternatives(requirement);

  for (const alternative of alternatives) {
    const selected = pickVersionForSingleRequirement(alternative, versions);
    if (selected) {
      return selected;
    }
  }

  return null;
}

function pickVersionForSingleRequirement(requirement, versions) {
  const normalized = requirement.trim();
  if (!normalized) {
    return null;
  }

  if (normalized === "lts/*") {
    return versions[versions.length - 1] || null;
  }

  if (
    /^\d+$/.test(normalized) ||
    /^\d+\.x\+?$/.test(normalized) ||
    /^\d+\+?$/.test(normalized)
  ) {
    const major = Number(normalized.match(/\d+/)[0]);
    return versions.find((item) => parseVersion(item).major === major) || null;
  }

  if (normalized.startsWith(">=")) {
    const min = normalized.slice(2);
    return versions.find((item) => compareVersions(item, min) >= 0) || null;
  }

  if (normalized.startsWith("^")) {
    const min = normalized.slice(1);
    const parsed = parseVersion(min);
    if (!parsed) {
      return null;
    }

    const sameMajor = versions.filter(
      (item) =>
        parseVersion(item).major === parsed.major &&
        compareVersions(item, min) >= 0,
    );
    return (
      sameMajor[0] ||
      versions.find((item) => parseVersion(item).major === parsed.major) ||
      null
    );
  }

  if (normalized.startsWith("~")) {
    const min = normalized.slice(1);
    const parsed = parseVersion(min);
    if (!parsed) {
      return null;
    }

    return (
      versions.find((item) => {
        const version = parseVersion(item);
        return (
          version.major === parsed.major &&
          version.minor === parsed.minor &&
          compareVersions(item, min) >= 0
        );
      }) || null
    );
  }

  const exact = parseVersion(normalized);
  if (exact) {
    const sameMajor = versions.filter(
      (item) => parseVersion(item).major === exact.major,
    );
    if (!sameMajor.length) {
      return null;
    }

    return sameMajor.reduce((closest, candidate) => {
      if (!closest) {
        return candidate;
      }

      const currentDelta = Math.abs(compareVersions(candidate, normalized));
      const bestDelta = Math.abs(compareVersions(closest, normalized));
      return currentDelta < bestDelta ? candidate : closest;
    }, null);
  }

  return null;
}

function detectNodeVersion(projectDir, options = {}) {
  const packageJson = options.packageJson || loadPackageJson(projectDir);
  const supportedVersions = options.supportedVersions || [];
  const requirement = detectRequirementFromFiles(projectDir, packageJson);
  const nodeVersion = pickSupportedVersion(requirement, supportedVersions);

  return {
    requirement,
    nodeVersion,
  };
}

module.exports = {
  compareVersions,
  detectNodeVersion,
  detectRequirementFromFiles,
  detectRequirementFromFramework,
  loadPackageJson,
  parseVersion,
  pickSupportedVersion,
};
