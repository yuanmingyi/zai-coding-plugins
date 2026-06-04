import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { detectPackageManagerSpec } from "../standard/inspectProject.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-detect-pm-"));
}

describe("standard/detectPackageManagerSpec", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("pins exact version from packageManager field (pnpm)", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const result = detectPackageManagerSpec(
      { packageManager: "pnpm@10.6.5" },
      dir,
    );
    expect(result).toMatchObject({
      name: "pnpm",
      versionSpec: "10.6.5",
      source: "packageManager",
    });
  });

  it("pins exact version from packageManager field (yarn berry)", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const result = detectPackageManagerSpec(
      { packageManager: "yarn@4.4.0" },
      dir,
    );
    expect(result).toMatchObject({
      name: "yarn",
      versionSpec: "4.4.0",
      source: "packageManager",
    });
  });

  it("falls back to pnpm@<major> from pnpm-lock.yaml lockfileVersion", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    const result = detectPackageManagerSpec({}, dir);
    expect(result).toMatchObject({
      name: "pnpm",
      versionSpec: "10",
      source: "lockfile",
    });
  });

  it("falls back to older pnpm major for older lockfileVersion 6.0", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "pnpm-lock.yaml"),
      "lockfileVersion: '6.0'\n",
    );
    const result = detectPackageManagerSpec({}, dir);
    expect(result).toMatchObject({
      name: "pnpm",
      versionSpec: "8",
      source: "lockfile",
    });
  });

  it("returns null for npm-only projects so the renderer skips the preamble", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
    expect(detectPackageManagerSpec({}, dir)).toBeNull();
  });

  it("returns null when no signal exists at all", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    expect(detectPackageManagerSpec({}, dir)).toBeNull();
  });

  it("treats classic yarn.lock as null (classic yarn is bundled in node:*-slim)", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "yarn.lock"), "# yarn lockfile v1\n");
    expect(detectPackageManagerSpec({}, dir)).toBeNull();
  });
});
