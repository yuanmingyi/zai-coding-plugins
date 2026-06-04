import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NO_PROJECT_MESSAGE,
  NO_REMOTE_PROJECTS_MESSAGE,
  previewDeleteProject,
  runDeleteProject,
} from "../lifecycle/deleteProject.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-delete-project-"));
}

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

const ENV = Object.freeze({
  ZAI_API_TOKEN: "token",
  ZAI_API_BASE_URL: "https://api.example.com",
});

describe("lifecycle/deleteProject (TCB API v2)", () => {
  const tempDirs = [];

  beforeEach(() => {
    process.chdir(os.tmpdir());
  });

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  describe("runDeleteProject", () => {
    it("fails when no arbitrary project is configured locally and no projectId is passed", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await runDeleteProject({
        cwd: tempDir,
        env: ENV,
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe(NO_PROJECT_MESSAGE);
    });

    it("sends {projectId} only to /deleteProject (no envType) and cleans local settings on success", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          projectName: path.basename(tempDir),
          endpoint: "https://api.example.com",
          projectId: "project-1",
          deployments: [
            { taskId: "task-1", envType: "BASIC" }, // legacy fixture
          ],
        }),
      );

      const requests = [];
      const result = await runDeleteProject({
        cwd: tempDir,
        env: ENV,
        fetchImpl: async (url, init) => {
          requests.push({ url, init });
          return makeResponse({ code: 200, data: null });
        },
      });

      expect(result.success).toBe(true);
      expect(result.projectId).toBe("project-1");
      expect(result.localCleanupApplied).toBe(true);
      expect(result.cleanupWarning).toBeNull();
      expect(result.summary).toContain("Project deleted");

      // Exactly one HTTP call: POST /deleteProject with {projectId} only.
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe(
        "https://api.example.com/client/tcb/deleteProject",
      );
      const body = JSON.parse(requests[0].init.body);
      expect(body).toEqual({ projectId: "project-1" });
      expect(body.envType).toBeUndefined();

      expect(fs.existsSync(settingsPath)).toBe(false);
    });

    it("removes stale local settings when the server reports PROJECT_NOT_FOUND on delete", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          projectName: path.basename(tempDir),
          endpoint: "https://api.example.com",
          projectId: "project-gone",
        }),
      );

      const result = await runDeleteProject({
        cwd: tempDir,
        env: ENV,
        fetchImpl: async () =>
          makeResponse({ code: 3012, msg: "PROJECT_NOT_FOUND" }),
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Project not found on server");
      expect(fs.existsSync(settingsPath)).toBe(false);
    });

    it("targets an explicit projectId without touching local settings when no local match", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          projectName: path.basename(tempDir),
          endpoint: "https://api.example.com",
          projectId: "local-keep-me",
        }),
      );

      const requests = [];
      const result = await runDeleteProject({
        cwd: tempDir,
        env: ENV,
        projectId: "remote-other-project",
        projectName: "Some Other Project",
        fetchImpl: async (url, init) => {
          requests.push({ url, init });
          return makeResponse({ code: 200, data: null });
        },
      });

      expect(result.success).toBe(true);
      expect(result.projectId).toBe("remote-other-project");
      expect(result.projectName).toBe("Some Other Project");
      expect(result.localCleanupApplied).toBe(false);

      // Body still {projectId} only, with the explicit value.
      const body = JSON.parse(requests[0].init.body);
      expect(body).toEqual({ projectId: "remote-other-project" });

      // Unrelated local settings file is preserved.
      expect(fs.existsSync(settingsPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      expect(saved.projectId).toBe("local-keep-me");
    });

    it("returns a user-facing failure when auth is missing", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await runDeleteProject({
        cwd: tempDir,
        env: { ZAI_API_BASE_URL: "https://api.example.com" },
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Authentication token not configured");
    });
  });

  describe("previewDeleteProject", () => {
    it("returns a single-project preview (with confirmation prompt) when the local project is configured", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const projectName = path.basename(tempDir);
      const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          projectName,
          endpoint: "https://api.example.com",
          projectId: "project-1",
        }),
      );

      const result = await previewDeleteProject({
        cwd: tempDir,
        env: ENV,
        fetchImpl: async () => {
          throw new Error("should not fetch in single-project preview");
        },
      });

      expect(result.success).toBe(true);
      expect(result.stage).toBe("preview");
      expect(result.projectId).toBe("project-1");
      expect(result.projectName).toBe(projectName);
      expect(result.confirmationPrompt).toContain(projectName);
      expect(result.confirmationPrompt).toContain("NOT recoverable");
      // No envType-related fields surface in the v2 result.
      expect(result.envType).toBeUndefined();
      expect(result.availableEnvTypes).toBeUndefined();
      expect(result.menuPrompt).toBeUndefined();
    });

    it("lists remote projects when no local project is configured", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await previewDeleteProject({
        cwd: tempDir,
        env: ENV,
        fetchImpl: async () =>
          makeResponse({
            code: 200,
            data: [
              {
                projectId: "remote-1",
                projectName: "Remote One",
                area: "global",
                url: "https://r1.example.com",
              },
              { projectId: "remote-2", projectName: "Remote Two" },
            ],
          }),
      });

      expect(result.success).toBe(true);
      expect(result.stage).toBe("preview");
      expect(result.projects).toHaveLength(2);
      expect(result.projects[0]).toMatchObject({
        index: 1,
        projectId: "remote-1",
        projectName: "Remote One",
        url: "https://r1.example.com",
        area: "global",
      });
      // Per-project envTypes must not appear (the API no longer returns them).
      expect(result.projects[0].envTypes).toBeUndefined();
      expect(result.projectListPrompt).toContain("remote-1");
      expect(result.projectListPrompt).toContain("remote-2");
      expect(result.projectListPrompt).not.toContain("envTypes");
    });

    it("returns NO_REMOTE_PROJECTS_MESSAGE when the remote list is empty", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await previewDeleteProject({
        cwd: tempDir,
        env: ENV,
        fetchImpl: async () => makeResponse({ code: 200, data: [] }),
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe(NO_REMOTE_PROJECTS_MESSAGE);
    });

    it("resolves an explicit --projectId against the remote project list", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await previewDeleteProject({
        cwd: tempDir,
        env: ENV,
        projectId: "remote-target",
        fetchImpl: async () =>
          makeResponse({
            code: 200,
            data: [
              { projectId: "remote-other", projectName: "Other" },
              { projectId: "remote-target", projectName: "Target App" },
            ],
          }),
      });

      expect(result.success).toBe(true);
      expect(result.projectId).toBe("remote-target");
      expect(result.projectName).toBe("Target App");
      expect(result.confirmationPrompt).toContain("Target App");
    });

    it("fails when --projectId is not present in the remote list", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await previewDeleteProject({
        cwd: tempDir,
        env: ENV,
        projectId: "missing-id",
        fetchImpl: async () =>
          makeResponse({
            code: 200,
            data: [{ projectId: "different-id" }],
          }),
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Project not found");
      expect(result.message).toContain("missing-id");
    });

    it("wraps remote list errors into a structured failure", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await previewDeleteProject({
        cwd: tempDir,
        env: ENV,
        fetchImpl: async () => {
          throw new Error("Network unreachable");
        },
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe("preview");
      expect(result.message).toContain("Network unreachable");
    });

    it("returns a structured auth-error failure (not a throw) when the token is missing", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);

      const result = await previewDeleteProject({
        cwd: tempDir,
        env: { ZAI_API_BASE_URL: "https://api.example.com" },
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe("preview");
      expect(result.message).toContain("Authentication token not configured");
    });
  });
});
