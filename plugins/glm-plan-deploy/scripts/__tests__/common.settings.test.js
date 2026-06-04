import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  clearArbitraryProjectState,
  getLatestTaskId,
  loadArbitrarySettings,
  readEnvMetadata,
  removeFileIfExists,
  saveArbitrarySettings,
} from "../common/settings.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-deploy-settings-"));
}

describe("common/settings", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("loads empty arbitrary settings when the file does not exist", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    const settings = loadArbitrarySettings(
      path.join(tempDir, "settings.json"),
      {
        cwd: tempDir,
        projectName: "demo",
        endpoint: "https://deploy.example.com",
      },
    );

    expect(settings.projectName).toBe("demo");
    expect(settings.endpoint).toBe("https://deploy.example.com");
    expect(settings.projectId).toBeUndefined();
  });

  it("clears project-scoped state when project name changes", () => {
    const settings = clearArbitraryProjectState({
      projectId: "project-1",
      deployments: [{ taskId: "task-1" }],
      env: ["PORT"],
      envHash: "hash",
      createTime: "2026-01-01T00:00:00.000Z",
      area: "overseas",
    });

    expect(settings.projectId).toBeUndefined();
    expect(settings.deployments).toBeUndefined();
    expect(settings.area).toBeUndefined();
  });

  it("returns the latest task id from deployments", () => {
    expect(
      getLatestTaskId({
        deployments: [{ taskId: "task-latest" }, { taskId: "task-older" }],
      }),
    ).toBe("task-latest");
  });

  it("reads env metadata without exposing values", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(
      path.join(tempDir, ".env"),
      "PORT=9000\nSECRET=hidden\n# comment\n",
    );

    const metadata = readEnvMetadata(tempDir);

    expect(metadata.keys).toEqual(["PORT", "SECRET"]);
    expect(metadata.hash).toBeTruthy();
  });

  it("tolerates legacy envType fields on existing deployment records", () => {
    // Migration: prior versions wrote `envType` ("BASIC" / "ADVANCED") into
    // each deployment record. The reader must keep loading those files; the
    // field is silently ignored by callers and the writer (callers' choice)
    // no longer emits it.
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const settingsPath = path.join(tempDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: "demo",
        endpoint: "https://deploy.example.com",
        projectId: "proj_legacy",
        deployments: [
          { taskId: "t-1", envType: "BASIC" },
          { taskId: "t-2", envType: "ADVANCED" },
        ],
      }),
      "utf8",
    );

    const loaded = loadArbitrarySettings(settingsPath, {
      cwd: tempDir,
      projectName: "demo",
      endpoint: "https://deploy.example.com",
    });
    expect(loaded.projectId).toBe("proj_legacy");
    expect(loaded.deployments).toHaveLength(2);
    expect(loaded.deployments[0].taskId).toBe("t-1");
    // The field stays present on read (we don't strip it from the in-memory
    // shape); callers that re-save the settings are responsible for not
    // re-emitting it. That's covered by recordDeployment/deleteProject tests.
  });

  it("preserves project state when only the endpoint changes", () => {
    // Multiple deploy API endpoints (prod, dev, internal mirrors) can front
    // the same backend environment, so an endpoint URL change by itself is
    // not enough evidence that the user switched environments. The supported
    // way to scope settings per environment is `ZAI_PROJECT_SETTINGS_PATH`,
    // which routes each environment to its own settings file. Until then,
    // keep projectId/deployments/env/createTime intact and just update the
    // stored endpoint to the current one.
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const settingsPath = path.join(tempDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: "demo",
        endpoint: "https://old.example.com/api/cc-deploy",
        projectId: "proj_keep_me",
        deployments: [{ taskId: "t-1", date: "2026-01-01T00:00:00.000Z" }],
        env: ["PORT"],
        envHash: "hash",
        createTime: "2026-01-01T00:00:00.000Z",
        area: "global",
      }),
      "utf8",
    );

    const loaded = loadArbitrarySettings(settingsPath, {
      cwd: tempDir,
      projectName: "demo",
      endpoint: "https://new.example.com/api/cc-deploy",
    });

    expect(loaded.projectId).toBe("proj_keep_me");
    expect(loaded.deployments).toEqual([
      { taskId: "t-1", date: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(loaded.env).toEqual(["PORT"]);
    expect(loaded.envHash).toBe("hash");
    expect(loaded.createTime).toBe("2026-01-01T00:00:00.000Z");
    expect(loaded.area).toBe("global");
    expect(loaded.endpoint).toBe("https://new.example.com/api/cc-deploy");
  });

  it("persists and removes arbitrary settings files", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");

    saveArbitrarySettings(settingsPath, { projectName: "demo" });
    expect(fs.existsSync(settingsPath)).toBe(true);

    removeFileIfExists(settingsPath);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });
});
