import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseDeployConfig,
  renderHelp,
  resolveDeployEnv,
  resolveStaticDeployPlan,
  runDeployStaticWebsite,
  runDeployStaticWebsiteCli,
  writeDeployConfig,
} from "../deploy-static-website.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-static-helper-"));
}

describe("deploy-static-website helper", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("parses and writes deploy config files", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, ".deploy-arbitrary");

    writeDeployConfig(configPath, {
      ZAI_API_TOKEN: "token.with-dots",
      ZAI_API_BASE_URL: "https://api.example.com/cc-deploy",
    });

    const content = fs.readFileSync(configPath, "utf8");
    expect(parseDeployConfig(content)).toEqual({
      ZAI_API_TOKEN: "token.with-dots",
      ZAI_API_BASE_URL: "https://api.example.com/cc-deploy",
    });
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("loads missing deploy env vars from the config file without prompting", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, ".deploy-arbitrary");
    writeDeployConfig(configPath, {
      ZAI_API_TOKEN: "file-token",
      ZAI_API_BASE_URL: "https://api.example.com",
    });

    const env = await resolveDeployEnv({
      env: {},
      configPath,
      promptImpl: async () => {
        throw new Error("should not prompt");
      },
    });

    expect(env.ZAI_API_TOKEN).toBe("file-token");
    expect(env.ZAI_API_BASE_URL).toBe("https://api.example.com");
  });

  it("prompts for missing deploy env vars and saves them for next use", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, ".deploy-arbitrary");
    const prompts = [];

    const env = await resolveDeployEnv({
      env: {},
      configPath,
      promptImpl: async (question) => {
        prompts.push(question.name);
        return question.name === "ZAI_API_TOKEN"
          ? "prompt-token"
          : "https://prompt.example.com";
      },
    });

    expect(prompts).toEqual(["ZAI_API_TOKEN", "ZAI_API_BASE_URL"]);
    expect(env.ZAI_API_TOKEN).toBe("prompt-token");
    expect(env.ZAI_API_BASE_URL).toBe("https://prompt.example.com");
    expect(parseDeployConfig(fs.readFileSync(configPath, "utf8"))).toEqual({
      ZAI_API_TOKEN: "prompt-token",
      ZAI_API_BASE_URL: "https://prompt.example.com",
    });
  });

  it("can reconfigure and replace stale deploy credentials", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, ".deploy-arbitrary");
    writeDeployConfig(configPath, {
      ZAI_API_TOKEN: "stale-token",
      ZAI_API_BASE_URL: "https://stale.example.com",
    });
    const prompts = [];

    const env = await resolveDeployEnv({
      env: {
        ZAI_API_TOKEN: "env-token",
        ZAI_API_BASE_URL: "https://env.example.com",
      },
      configPath,
      reconfigure: true,
      promptImpl: async (question) => {
        prompts.push({
          name: question.name,
          defaultValue: question.defaultValue,
        });
        return question.name === "ZAI_API_TOKEN"
          ? "fresh-token"
          : "https://fresh.example.com";
      },
    });

    expect(prompts).toEqual([
      { name: "ZAI_API_TOKEN", defaultValue: undefined },
      { name: "ZAI_API_BASE_URL", defaultValue: "https://env.example.com" },
    ]);
    expect(env.ZAI_API_TOKEN).toBe("fresh-token");
    expect(env.ZAI_API_BASE_URL).toBe("https://fresh.example.com");
    expect(parseDeployConfig(fs.readFileSync(configPath, "utf8"))).toEqual({
      ZAI_API_TOKEN: "fresh-token",
      ZAI_API_BASE_URL: "https://fresh.example.com",
    });
  });

  it("uses raw-file static deployment overrides for index.html folders", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "index.html"), "<html></html>\n");
    fs.mkdirSync(path.join(tempDir, "assets"));
    fs.writeFileSync(path.join(tempDir, "assets", "app.css"), "body{}\n");

    const result = await runDeployStaticWebsite({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      deployImpl: async (options) => ({
        success: true,
        stage: "completed",
        accessUrl: "https://site.example.com/app",
        deployOptions: options,
      }),
      analyzeImpl: async () => {
        throw new Error("plain static should not call analyze");
      },
    });

    expect(result.success).toBe(true);
    expect(result.staticDeployMode).toBe("plain-static");
    expect(result.deployOptions).toMatchObject({
      cwd: tempDir,
      databaseMode: "skip",
      language: "Node.js",
      buildCommand: "true",
      output: ".",
      runtimeKind: "static",
      framework: "static",
    });
  });

  it("persists returned task and project IDs into the local deploy settings", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "index.html"), "<html></html>\n");

    const result = await runDeployStaticWebsite({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      deployImpl: async () => ({
        success: false,
        stage: "pollTask",
        taskId: "task-timeout",
        projectId: "project-1",
        summary: "Deployment task polling timed out.",
      }),
      analyzeImpl: async () => {
        throw new Error("plain static should not call analyze");
      },
    });

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(result.taskId).toBe("task-timeout");
    expect(result.projectId).toBe("project-1");
    expect(result.settingsRecord).toMatchObject({
      success: true,
      taskId: "task-timeout",
      projectId: "project-1",
      settingsPath,
    });
    expect(settings.projectId).toBe("project-1");
    expect(settings.deployments[0].taskId).toBe("task-timeout");
  });

  it("writes task creation and status-change progress to the progress stream", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "index.html"), "<html></html>\n");
    const progressWrites = [];

    const result = await runDeployStaticWebsite({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      progressStream: {
        write(chunk) {
          progressWrites.push(chunk);
        },
      },
      deployImpl: async (options) => {
        await options.onTaskCreated({
          taskId: "task-1",
          projectId: "project-1",
        });
        await options.onTaskStatusChange({
          taskId: "task-1",
          status: "Processing",
          currentStep: "BUILDING",
          stepMessage: "Building image",
        });
        return {
          success: true,
          stage: "completed",
          taskId: "task-1",
          projectId: "project-1",
          summary: "Deployment completed.",
        };
      },
      analyzeImpl: async () => {
        throw new Error("plain static should not call analyze");
      },
    });

    expect(result.success).toBe(true);
    expect(progressWrites.join("")).toContain(
      "[deploy-static] Created deploy task task-1 (projectId: project-1).",
    );
    expect(progressWrites.join("")).toContain(
      "[deploy-static] Task task-1 status changed: Processing | step: BUILDING | Building image",
    );
  });

  it("fetches a timed-out task status and persists the returned project ID", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const calls = [];

    const result = await runDeployStaticWebsite({
      cwd: tempDir,
      command: "status",
      taskId: "task-timeout",
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      statusImpl: async (options) => {
        calls.push(options);
        return {
          success: true,
          taskId: options.taskId,
          projectId: "project-2",
          status: "Success",
          accessUrl: "https://site.example.com/app",
          summary: "Deployment task reached terminal state: Success",
        };
      },
    });

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(result.success).toBe(true);
    expect(result.staticDeployMode).toBe("status");
    expect(result.taskId).toBe("task-timeout");
    expect(result.projectId).toBe("project-2");
    expect(result.settingsPath).toBe(settingsPath);
    expect(calls[0]).toMatchObject({
      cwd: tempDir,
      taskId: "task-timeout",
      timeoutSeconds: "600",
    });
    expect(settings.projectId).toBe("project-2");
    expect(settings.deployments[0].taskId).toBe("task-timeout");
  });

  it("fetches status for the latest task from local deploy settings when taskId is omitted", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: path.basename(tempDir),
        endpoint: "https://api.example.com",
        projectId: "project-existing",
        deployments: [{ taskId: "task-latest", date: "2026-06-02T00:00:00Z" }],
      }),
    );

    const result = await runDeployStaticWebsite({
      cwd: tempDir,
      status: true,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      statusImpl: async (options) => ({
        success: true,
        taskId: options.taskId,
        projectId: "project-existing",
        status: "Failed",
        errorMessage: "Build failed",
        summary: "Deployment task reached terminal state: Failed",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.taskId).toBe("task-latest");
    expect(result.projectId).toBe("project-existing");
    expect(result.status).toBe("Failed");
  });

  it("treats an indicated html file as index.html during raw-file static deployment", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "landing.html"), "<html></html>\n");
    fs.writeFileSync(path.join(tempDir, "app.css"), "body{}\n");

    const result = await runDeployStaticWebsite({
      cwd: tempDir,
      indexFile: "landing.html",
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      deployImpl: async (options) => ({
        success: true,
        stage: "completed",
        deployOptions: options,
      }),
      analyzeImpl: async () => {
        throw new Error("--index should use plain static deployment");
      },
    });

    expect(result.success).toBe(true);
    expect(result.staticDeployMode).toBe("plain-static");
    expect(result.deployOptions).toMatchObject({
      cwd: tempDir,
      databaseMode: "skip",
      buildCommand: "true",
      staticIndexFile: "landing.html",
      output: ".",
      runtimeKind: "static",
      framework: "static",
    });
  });

  it("supports nested html files as the selected index file", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.mkdirSync(path.join(tempDir, "pages"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "pages", "home.html"), "<html></html>");

    const result = await resolveStaticDeployPlan({
      cwd: tempDir,
      indexFile: "pages/home.html",
      analyzeImpl: async () => {
        throw new Error("--index should not call analyze");
      },
    });

    expect(result.success).toBe(true);
    expect(result.deployOptions.buildCommand).toBe("true");
    expect(result.deployOptions.staticIndexFile).toBe("pages/home.html");
  });

  it("accepts framework static projects and lets deploy-arbitrary use detected settings", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        scripts: { build: "vite build" },
        devDependencies: { vite: "^7.0.0" },
      }),
    );
    fs.writeFileSync(path.join(tempDir, "index.html"), '<div id="app"></div>');

    const result = await runDeployStaticWebsite({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: { runtimeKind: "static", framework: "vite" },
      }),
      deployImpl: async (options) => ({
        success: true,
        stage: "completed",
        deployOptions: options,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.staticDeployMode).toBe("framework-static");
    expect(result.deployOptions).toMatchObject({
      cwd: tempDir,
      databaseMode: "skip",
    });
    expect(result.deployOptions).not.toHaveProperty("buildCommand");
  });

  it("rejects projects that are not detected as static websites", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        scripts: { start: "node server.js" },
        dependencies: { express: "^4.18.0" },
      }),
    );

    const result = await resolveStaticDeployPlan({
      cwd: tempDir,
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: { runtimeKind: "process", framework: "express" },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("does not look like a static website");
  });

  it("requires index.html even when raw-file static mode is forced", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "asset.css"), "body{}\n");

    const result = await resolveStaticDeployPlan({
      cwd: tempDir,
      forcePlain: true,
      analyzeImpl: async () => {
        throw new Error("forced plain mode should not call analyze");
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("requires an index.html");
  });

  it("rejects selected index files outside the static website directory", async () => {
    const tempDir = makeTempDir();
    const outsideDir = makeTempDir();
    tempDirs.push(tempDir, outsideDir);
    fs.writeFileSync(path.join(outsideDir, "landing.html"), "<html></html>\n");

    const result = await resolveStaticDeployPlan({
      cwd: tempDir,
      indexFile: path.join("..", path.basename(outsideDir), "landing.html"),
      analyzeImpl: async () => {
        throw new Error("invalid --index should not call analyze");
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("inside");
  });

  it("rejects selected index files without an html extension", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "landing.txt"), "<html></html>\n");

    const result = await resolveStaticDeployPlan({
      cwd: tempDir,
      indexFile: "landing.txt",
      analyzeImpl: async () => {
        throw new Error("invalid --index should not call analyze");
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(".html");
  });

  it("documents the selected index file option in the helper usage", () => {
    expect(renderHelp()).toContain("--index <html-file>");
    expect(renderHelp()).toContain("--reconfigure");
    expect(renderHelp()).toContain("status [--cwd <dir>] [--taskId <id>]");
    expect(renderHelp()).toContain("--timeoutSeconds <s>");
  });

  it("normalizes CLI args through the shared deploy-static website command helper", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "landing.html"), "<html></html>\n");

    const { args, result } = await runDeployStaticWebsiteCli(
      [
        "--cwd",
        tempDir,
        "--index",
        "landing.html",
        "--appName",
        "site-app",
        "--json",
      ],
      {
        env: {
          ZAI_API_TOKEN: "token",
          ZAI_API_BASE_URL: "https://api.example.com",
        },
        deployImpl: async (options) => ({
          success: true,
          stage: "completed",
          deployOptions: options,
        }),
        analyzeImpl: async () => {
          throw new Error("--index should use plain static deployment");
        },
      },
    );

    expect(args.json).toBe(true);
    expect(args.cwd).toBe(tempDir);
    expect(args.indexFile).toBe("landing.html");
    expect(result.success).toBe(true);
    expect(result.deployOptions).toMatchObject({
      appName: "site-app",
      staticIndexFile: "landing.html",
    });
  });

  it("returns a structured CLI failure for invalid deploy-static website args", async () => {
    const { args, result } = await runDeployStaticWebsiteCli([
      "--json",
      "--unknown",
    ]);

    expect(args.json).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown argument");
  });
});
