import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectNodeVersion,
  pickSupportedVersion,
} from "../standard/detectNodeVersion.js";

describe("standard/detectNodeVersion", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("chooses the closest supported version for an engines.node requirement", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-node-version-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        engines: { node: "18.17.0" },
      }),
    );

    const result = detectNodeVersion(tempDir, {
      supportedVersions: ["18.16.0", "18.18.0", "20.18.0"],
    });

    expect(result.requirement).toBe("18.17.0");
    expect(result.nodeVersion).toBe("18.16.0");
  });

  it("falls back to .nvmrc when package.json does not declare a version", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-node-version-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(tempDir, ".nvmrc"), "20");

    const result = detectNodeVersion(tempDir, {
      supportedVersions: ["18.18.0", "20.18.0"],
    });

    expect(result.nodeVersion).toBe("20.18.0");
  });

  it("derives a minimum version from framework heuristics", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-node-version-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "^16.0.0",
        },
      }),
    );

    const result = detectNodeVersion(tempDir, {
      supportedVersions: ["18.18.0", "20.18.0", "22.17.1"],
    });

    expect(result.requirement).toBe("20.9.0+");
    expect(result.nodeVersion).toBe("20.18.0");
  });

  it("picks versions for caret ranges within the same major when possible", () => {
    expect(
      pickSupportedVersion("^16.14.0", ["16.13.0", "16.15.0", "18.0.0"]),
    ).toBe("16.15.0");
  });
});
