import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { detectRequirementFromFiles } from "../standard/detectNodeVersion.js";

describe("standard/detectRequirementFromFiles", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  function makeTempDir() {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-node-requirement-"),
    );
    tempDirs.push(tempDir);
    return tempDir;
  }

  it("reads engines.node from package.json", () => {
    const tempDir = makeTempDir();
    const packageJson = {
      engines: { node: "18.17.0" },
    };

    expect(detectRequirementFromFiles(tempDir, packageJson)).toBe("18.17.0");
  });

  it("falls back to .nvmrc when package.json does not declare a version", () => {
    const tempDir = makeTempDir();
    fs.writeFileSync(path.join(tempDir, ".nvmrc"), "20\n");

    expect(detectRequirementFromFiles(tempDir, {})).toBe("20");
  });

  it("derives a minimum version from framework heuristics", () => {
    const tempDir = makeTempDir();
    const packageJson = {
      dependencies: {
        next: "^16.0.0",
      },
    };

    expect(detectRequirementFromFiles(tempDir, packageJson)).toBe("20.9.0+");
  });
});
