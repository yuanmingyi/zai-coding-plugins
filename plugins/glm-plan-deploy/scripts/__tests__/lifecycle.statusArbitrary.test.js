import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runStatusArbitrary } from "../lifecycle/statusArbitrary.js";

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe("lifecycle/statusArbitrary", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("returns a no-deployment result when no taskId is recorded", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-status-arbitrary-"),
    );
    tempDirs.push(tempDir);

    const result = await runStatusArbitrary({
      cwd: tempDir,
      env: { ZAI_API_TOKEN: "token" },
      fetchImpl: async () => makeResponse({ code: 200, data: {} }),
    });

    expect(result.success).toBe(true);
    expect(result.noDeployment).toBe(true);
  });

  it("returns status details for the latest task", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-status-arbitrary-"),
    );
    tempDirs.push(tempDir);

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: path.basename(tempDir),
        endpoint: "https://api.example.com",
        deployments: [{ taskId: "task-1", envType: "BASIC" }],
      }),
    );

    let requestedUrl = null;
    const result = await runStatusArbitrary({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async (url) => {
        requestedUrl = url;
        return makeResponse({
          code: 200,
          data: {
            status: "Success",
            currentStep: "VERIFY",
            accessUrl: "https://example.com",
          },
        });
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("Success");
    expect(result.accessUrl).toBe("https://example.com");
    expect(requestedUrl).toBe(
      "https://api.example.com/client/tcb/getTask?taskId=task-1",
    );
  });

  it("treats DEPLOYMENT_NOT_FOUND as no deployment and removes the stale task", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-status-arbitrary-"),
    );
    tempDirs.push(tempDir);

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: path.basename(tempDir),
        endpoint: "https://api.example.com",
        deployments: [
          { taskId: "task-stale", envType: "BASIC" },
          { taskId: "task-older", envType: "ADVANCED" },
        ],
      }),
    );

    let requestedUrl = null;
    const result = await runStatusArbitrary({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async (url) => {
        requestedUrl = url;
        return makeResponse({
          code: 3011,
          msg: "DEPLOYMENT_NOT_FOUND",
        });
      },
    });

    expect(result.success).toBe(true);
    expect(result.noDeployment).toBe(true);
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(saved.deployments).toEqual([
      { taskId: "task-older", envType: "ADVANCED" },
    ]);
    expect(requestedUrl).toBe(
      "https://api.example.com/client/tcb/getTask?taskId=task-stale",
    );
  });
});
