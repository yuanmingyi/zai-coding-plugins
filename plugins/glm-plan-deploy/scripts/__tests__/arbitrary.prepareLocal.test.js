import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runArbitraryPrepareLocal } from "../arbitrary/prepareLocal.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-prepare-local-"));
}

describe("arbitrary/prepareLocal", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("returns a staged hard failure when preflight fails", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      preflightImpl: async () => ({
        success: false,
        message: "auth missing",
        summary: "auth missing",
        apiRecord: {
          url: "https://api.example.com/client/tcb/status",
          method: "GET",
          responseStatus: 200,
          responseBody: { code: 401, msg: "身份验证失败。" },
          errorMessage: "Deploy API error: 身份验证失败。",
        },
        apiRecords: [
          {
            url: "https://api.example.com/client/tcb/status",
            method: "GET",
            responseStatus: 200,
            responseBody: { code: 401, msg: "身份验证失败。" },
            errorMessage: "Deploy API error: 身份验证失败。",
          },
        ],
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("preflight");
    expect(result.message).toBe("auth missing");
    expect(result.apiRecord).toMatchObject({
      url: "https://api.example.com/client/tcb/status",
      responseStatus: 200,
      responseBody: { code: 401, msg: "身份验证失败。" },
    });
    expect(result.apiRecords).toEqual([result.apiRecord]);
  });

  it("returns an analyze user-input boundary and carries preflight state forward", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: "project-1",
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: true,
        reasonCode: "UNKNOWN_RUNTIME",
        message: "Please confirm the runtime.",
        summary: "Please confirm the runtime.",
        detectedConfig: {
          language: "Python",
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("analyze");
    expect(result.reasonCode).toBe("UNKNOWN_RUNTIME");
    expect(result.timeoutSeconds).toBe(300);
    expect(result.uploadSizeLimit).toBe(104857600);
    expect(result.detectedConfig).toEqual({ language: "Python" });
  });

  it("returns a build-validation user-input boundary with logs", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci && npm run build",
          output: "dist",
          startCommand: "npm start",
        },
      }),
      validateBuildImpl: async () => ({
        success: true,
        buildSucceeded: false,
        needsFix: true,
        exitCode: 1,
        stdout: "stdout text",
        stderr: "stderr text",
        buildCommand: "npm ci && npm run build",
        summary: "build failed",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("validateBuild");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("stdout text");
    expect(result.stderr).toBe("stderr text");
    expect(result.buildCommand).toBe("npm ci && npm run build");
  });

  it("forwards an explicit raw static html path without copying it locally", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "landing.html"), "<html></html>\n");
    fs.writeFileSync(path.join(tempDir, "app.css"), "body{}\n");

    const calls = [];
    const result = await runArbitraryPrepareLocal({
      cwd: tempDir,
      path: "landing.html",
      agentWorkDir: path.join(tempDir, ".zai/deploy/arbitrary/run-path"),
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      validateBuildImpl: async (options) => {
        calls.push(["validate", options]);
        return {
          success: true,
          buildSucceeded: true,
          needsFix: false,
          exitCode: 0,
          stdout: "",
          stderr: "",
          buildCommand: options.buildCommand,
          summary: "ok",
        };
      },
      renderDockerfilesImpl: async (options) => {
        calls.push(["render", options]);
        return {
          success: true,
          summary: "rendered",
          dockerfileBuildPath: path.join(
            options.agentWorkDir,
            "Dockerfile.build",
          ),
          dockerfileRunPath: path.join(options.agentWorkDir, "Dockerfile.run"),
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe("completed");
    expect(result.detectedConfig).toMatchObject({
      runtimeKind: "static",
      buildCommand: "true",
      staticIndexFile: "landing.html",
    });
    expect(calls[0]).toMatchObject([
      "validate",
      {
        cwd: tempDir,
        buildCommand: "true",
      },
    ]);
    expect(calls[1][1]).toMatchObject({
      cwd: tempDir,
      staticIndexFile: "landing.html",
    });
    expect(fs.existsSync(path.join(tempDir, "index.html"))).toBe(false);
  });

  it("asks for a database mode when the project needs a database", async () => {
    let buildCalled = false;
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: "project-1",
        envStatus: "normal",
        envReady: true,
        databaseCapabilities: {
          supports: ["mysql"],
          mysql: { provisioning: true, accounts: true, sql: true },
        },
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci",
          output: "Source files",
          startCommand: "npm start",
          database: {
            detected: true,
            type: "mysql",
            requiredEnv: ["DATABASE_URL"],
            orm: "prisma",
            migrationCommand: "npx prisma migrate deploy",
          },
        },
      }),
      validateBuildImpl: async () => {
        buildCalled = true;
        throw new Error("should not build before DB mode is selected");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("analyze");
    expect(result.reasonCode).toBe("DATABASE_CONFIGURATION_REQUIRED");
    expect(result.database).toMatchObject({
      detected: true,
      type: "mysql",
      mode: null,
    });
    expect(result.message).toContain("--databaseMode managed");
    expect(buildCalled).toBe(false);
  });

  it("prepares managed database bindings after local build validation succeeds", async () => {
    const calls = [];
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo-run",
      databaseMode: "managed",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: "project-1",
        envStatus: "normal",
        envReady: true,
        databaseCapabilities: {
          supports: ["mysql"],
          mysql: { provisioning: true, accounts: true, sql: true },
        },
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci",
          output: "Source files",
          startCommand: "npm start",
          database: {
            detected: true,
            type: "mysql",
            requiredEnv: ["DATABASE_URL"],
            orm: "prisma",
            migrationCommand: "npx prisma migrate deploy",
          },
        },
      }),
      validateBuildImpl: async (options) => {
        calls.push(["build", options]);
        return {
          success: true,
          buildSucceeded: true,
          buildCommand: options.buildCommand,
          exitCode: 0,
          stdout: "",
          stderr: "",
          summary: "build ok",
        };
      },
      databaseResolveImpl: async (options) => {
        calls.push(["database", options]);
        return {
          success: true,
          database: {
            mode: "managed",
            type: "mysql",
            bindingId: "dbbind-1",
          },
          databaseBindings: [
            {
              bindingId: "dbbind-1",
              env: {
                DATABASE_URL: "secretRef:DATABASE_URL",
                MYSQL_HOST: "valueRef:host",
              },
            },
          ],
        };
      },
      renderDockerfilesImpl: async (options) => {
        calls.push(["render", options]);
        return {
          success: true,
          agentWorkDir: options.agentWorkDir,
          dockerfileBuildPath: path.join(
            options.agentWorkDir,
            "Dockerfile.build",
          ),
          dockerfileRunPath: path.join(options.agentWorkDir, "Dockerfile.run"),
          buildScriptPath: path.join(
            options.agentWorkDir,
            "buildDockerImage.sh",
          ),
          summary: "render ok",
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.stage).toBe("completed");
    expect(result.databaseBindings).toEqual([
      {
        bindingId: "dbbind-1",
        env: {
          DATABASE_URL: "secretRef:DATABASE_URL",
          MYSQL_HOST: "valueRef:host",
        },
      },
    ]);
    expect(calls.map(([name]) => name)).toEqual([
      "build",
      "database",
      "render",
    ]);
    expect(calls[1][1]).toMatchObject({
      projectId: "project-1",
      appName: "demo",
      mode: "managed",
      detectedDatabase: {
        type: "mysql",
        requiredEnv: ["DATABASE_URL"],
      },
    });
  });

  it("does not call database prepare when managed MySQL preconditions are not met", async () => {
    let databaseCalled = false;
    let buildCalled = false;
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      databaseMode: "managed",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: "project-1",
        envStatus: "creating",
        envReady: false,
        databaseCapabilities: {
          supports: ["mysql"],
          mysql: { provisioning: true, accounts: true, sql: true },
        },
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci",
          output: "Source files",
          startCommand: "npm start",
          database: {
            detected: true,
            type: "mysql",
            requiredEnv: ["DATABASE_URL"],
          },
        },
      }),
      validateBuildImpl: async () => {
        buildCalled = true;
        throw new Error("should not build before DB preconditions pass");
      },
      databaseResolveImpl: async () => {
        databaseCalled = true;
        throw new Error("should not prepare DB");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("analyze");
    expect(result.reasonCode).toBe("DATABASE_MODE_UNSUPPORTED");
    expect(result.message).toContain("normal");
    expect(result.message).toContain("MySQL");
    expect(buildCalled).toBe(false);
    expect(databaseCalled).toBe(false);
  });

  it("returns the full prepared local state on success and generates agentWorkDir when omitted", async () => {
    const calls = [];
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      nowFn: () => 1777000000000,
      pid: 4242,
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 600,
        maxRetries: 5,
        uploadSizeLimit: 209715200,
        projectId: "project-2",
        envReady: true,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Python",
          version: "3.11",
          serviceRoot: "apps/api",
          buildCommand: "pip install -r requirements.txt",
          output: "Source files",
          startCommand: "python app.py",
        },
      }),
      validateBuildImpl: async (options) => {
        calls.push(["build", options]);
        return {
          success: true,
          buildSucceeded: true,
          needsFix: false,
          exitCode: 0,
          stdout: "",
          stderr: "",
          buildCommand: options.buildCommand,
          summary: "build ok",
        };
      },
      renderDockerfilesImpl: async (options) => {
        calls.push(["render", options]);
        return {
          success: true,
          agentWorkDir: options.agentWorkDir,
          dockerfileBuildPath: path.join(
            options.agentWorkDir,
            "Dockerfile.build",
          ),
          dockerfileRunPath: path.join(options.agentWorkDir, "Dockerfile.run"),
          buildScriptPath: path.join(
            options.agentWorkDir,
            "buildDockerImage.sh",
          ),
          serviceRoot: options.serviceRoot,
          summary: "render ok",
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe("completed");
    expect(result.needsUserInput).toBe(false);
    expect(result.maxRetries).toBe(5);
    expect(result.agentWorkDir).toBe(
      "/tmp/demo/.zai/deploy/arbitrary/1777000000000-4242",
    );
    expect(result.dockerfileBuildPath).toContain("Dockerfile.build");
    expect(calls[0][1].cwd).toBe("/tmp/demo/apps/api");
    expect(calls[0][1].buildCommand).toBe("pip install -r requirements.txt");
    expect(calls[0][1].detectedLanguage).toBe("Python");
    expect(calls[0][1].detectedVersion).toBe("3.11");
    expect(calls[1][1].agentWorkDir).toBe(
      "/tmp/demo/.zai/deploy/arbitrary/1777000000000-4242",
    );
  });

  it("applies explicit overrides before build validation and dockerfile rendering", async () => {
    const calls = [];
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/custom-run",
      language: "Node.js",
      version: "22",
      serviceRoot: "packages/web",
      buildCommand: "pnpm build",
      output: "build",
      startCommand: "node server.js",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Python",
          version: "3.11",
          serviceRoot: ".",
          buildCommand: "pip install -r requirements.txt",
          output: "Source files",
          startCommand: "python app.py",
        },
      }),
      validateBuildImpl: async (options) => {
        calls.push(["build", options]);
        return {
          success: true,
          buildSucceeded: true,
          needsFix: false,
          exitCode: 0,
          stdout: "",
          stderr: "",
          buildCommand: options.buildCommand,
          summary: "build ok",
        };
      },
      renderDockerfilesImpl: async (options) => {
        calls.push(["render", options]);
        return {
          success: true,
          agentWorkDir: options.agentWorkDir,
          dockerfileBuildPath: path.join(
            options.agentWorkDir,
            "Dockerfile.build",
          ),
          dockerfileRunPath: path.join(options.agentWorkDir, "Dockerfile.run"),
          buildScriptPath: path.join(
            options.agentWorkDir,
            "buildDockerImage.sh",
          ),
          serviceRoot: options.serviceRoot,
          summary: "render ok",
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      version: "22",
      serviceRoot: "packages/web",
      buildCommand: "pnpm build",
      output: "build",
      startCommand: "node server.js",
    });
    expect(result.agentWorkDir).toBe("/tmp/custom-run");
    expect(calls[0][1].cwd).toBe("/tmp/demo/packages/web");
    expect(calls[0][1].buildCommand).toBe("pnpm build");
    expect(calls[1][1]).toMatchObject({
      agentWorkDir: "/tmp/custom-run",
      language: "Node.js",
      version: "22",
      serviceRoot: "packages/web",
      buildCommand: "pnpm build",
      output: "build",
      startCommand: "node server.js",
    });
  });

  it("proceeds past an analyze prompt when explicit overrides complete the config", async () => {
    // ruby-sinatra: analyze returns AMBIGUOUS_ENTRYPOINT (app.rb + config.ru)
    // with a partial detectedConfig. The agent supplies the missing pieces
    // via overrides; prepareLocal must reconcile and continue rather than
    // returning needsUserInput before applyConfigOverrides runs.
    const calls = [];
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/ruby",
      agentWorkDir: "/tmp/ruby-run",
      serviceRoot: "config.ru",
      runtimeKind: "process",
      startCommand: "bundle exec rackup config.ru --host 0.0.0.0 --port $PORT",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: true,
        reasonCode: "AMBIGUOUS_ENTRYPOINT",
        message: "Multiple Ruby entrypoints found.",
        summary: "Multiple Ruby entrypoints found.",
        detectedConfig: {
          language: "Ruby",
          version: "3.2",
          buildCommand:
            "bundle install --deployment --without development test",
          output: "Source files",
        },
      }),
      validateBuildImpl: async (options) => {
        calls.push(["build", options]);
        return {
          success: true,
          buildSucceeded: true,
          needsFix: false,
          exitCode: 0,
          stdout: "",
          stderr: "",
          buildCommand: options.buildCommand,
          summary: "build ok",
        };
      },
      renderDockerfilesImpl: async (options) => {
        calls.push(["render", options]);
        return {
          success: true,
          agentWorkDir: options.agentWorkDir,
          dockerfileBuildPath: path.join(
            options.agentWorkDir,
            "Dockerfile.build",
          ),
          dockerfileRunPath: path.join(options.agentWorkDir, "Dockerfile.run"),
          buildScriptPath: path.join(
            options.agentWorkDir,
            "buildDockerImage.sh",
          ),
          serviceRoot: options.serviceRoot,
          summary: "render ok",
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.stage).toBe("completed");
    expect(result.detectedConfig).toMatchObject({
      language: "Ruby",
      version: "3.2",
      serviceRoot: "config.ru",
      runtimeKind: "process",
      buildCommand: "bundle install --deployment --without development test",
      output: "Source files",
      startCommand: "bundle exec rackup config.ru --host 0.0.0.0 --port $PORT",
    });
    expect(calls[1][1]).toMatchObject({
      language: "Ruby",
      serviceRoot: "config.ru",
    });
  });

  it("strips failure-masking suffixes from override buildCommand so silent build failures don't ship", async () => {
    // ruby-sinatra adt-f8f7644fb38c425280b0835ccdaa60bd: `bundle install || true`
    // made CNB report success while bundle was actually broken, then a wrong
    // start command shipped and the container 446'd. Never let a build
    // command that swallows failure propagate to the Dockerfile.
    const calls = [];
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo-run",
      buildCommand: "bundle install || true",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Ruby",
          version: "3.2",
          serviceRoot: ".",
          buildCommand: "bundle install",
          output: "Source files",
          startCommand: "bundle exec rackup --host 0.0.0.0 --port $PORT",
        },
      }),
      validateBuildImpl: async (options) => {
        calls.push(["build", options]);
        return {
          success: true,
          buildSucceeded: true,
          needsFix: false,
          exitCode: 0,
          stdout: "",
          stderr: "",
          buildCommand: options.buildCommand,
          summary: "build ok",
        };
      },
      renderDockerfilesImpl: async (options) => {
        calls.push(["render", options]);
        return {
          success: true,
          agentWorkDir: options.agentWorkDir,
          dockerfileBuildPath: path.join(
            options.agentWorkDir,
            "Dockerfile.build",
          ),
          dockerfileRunPath: path.join(options.agentWorkDir, "Dockerfile.run"),
          buildScriptPath: path.join(
            options.agentWorkDir,
            "buildDockerImage.sh",
          ),
          serviceRoot: options.serviceRoot,
          summary: "render ok",
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.detectedConfig.buildCommand).toBe("bundle install");
    expect(calls[0][1].buildCommand).toBe("bundle install");
    expect(calls[1][1].buildCommand).toBe("bundle install");
  });

  it("still prompts when an analyze boundary is not resolved by overrides", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/ruby",
      // Only a partial override (serviceRoot) — startCommand still missing,
      // so the config is incomplete and the prompt must stand.
      serviceRoot: "config.ru",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: true,
        reasonCode: "AMBIGUOUS_ENTRYPOINT",
        message: "Multiple Ruby entrypoints found.",
        summary: "Multiple Ruby entrypoints found.",
        detectedConfig: {
          language: "Ruby",
          version: "3.2",
          buildCommand:
            "bundle install --deployment --without development test",
          output: "Source files",
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("analyze");
    expect(result.reasonCode).toBe("AMBIGUOUS_ENTRYPOINT");
  });

  it("returns elapsedSeconds on success", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      nowFn: () => 1777000000000,
      pid: 4242,
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci",
          output: "dist",
          startCommand: "npm start",
        },
      }),
      validateBuildImpl: async () => ({
        success: true,
        buildSucceeded: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        buildCommand: "npm ci",
        summary: "ok",
      }),
      renderDockerfilesImpl: async (opts) => ({
        success: true,
        agentWorkDir: opts.agentWorkDir,
        dockerfileBuildPath: opts.agentWorkDir + "/Dockerfile.build",
        dockerfileRunPath: opts.agentWorkDir + "/Dockerfile.run",
        buildScriptPath: opts.agentWorkDir + "/buildDockerImage.sh",
        summary: "ok",
      }),
    });
    expect(typeof result.elapsedSeconds).toBe("number");
    expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof result.startedAt).toBe("number");
    expect(typeof result.finishedAt).toBe("number");
  });

  it("returns elapsedSeconds on needsUserInput", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: true,
        reasonCode: "UNKNOWN_RUNTIME",
        message: "Confirm runtime",
        summary: "Confirm runtime",
        detectedConfig: { language: "Python" },
      }),
    });
    expect(result.needsUserInput).toBe(true);
    expect(typeof result.elapsedSeconds).toBe("number");
    expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  it("returns elapsedSeconds on failure", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      preflightImpl: async () => ({
        success: false,
        message: "auth missing",
        summary: "auth missing",
      }),
    });
    expect(result.success).toBe(false);
    expect(typeof result.elapsedSeconds).toBe("number");
    expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  it("emits finalReport on terminal failure", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      preflightImpl: async () => ({
        success: false,
        message: "auth missing",
        summary: "auth missing",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.finalReport).toContain("Deployment Failed");
    expect(result.finalReport).toContain("Local Prep");
    expect(result.finalReport).toContain("auth missing");
  });

  it("does not emit finalReport on needsUserInput", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: true,
        reasonCode: "UNKNOWN_RUNTIME",
        message: "Confirm runtime",
        summary: "Confirm runtime",
        detectedConfig: { language: "Python" },
      }),
    });
    expect(result.needsUserInput).toBe(true);
    expect(result.finalReport).toBeUndefined();
  });

  it("includes the Debug Logs block in finalReport on hard failure when ZAI_DEPLOY_DEBUG=1", async () => {
    const claudeLogPaths = {
      projectLogDir: "/home/me/.claude/projects/-tmp-demo",
      jsonlFiles: ["/home/me/.claude/projects/-tmp-demo/abc.jsonl"],
    };
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      collectClaudeLogPathsImpl: () => claudeLogPaths,
      preflightImpl: async () => ({
        success: false,
        message: "auth missing",
        summary: "auth missing",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.finalReport).toContain("Deployment Failed");
    // The whole point of this fix: prepareLocal-side hard failures must
    // surface the Debug Logs block just like remote-deploy failures already do.
    expect(result.finalReport).toContain("Debug Logs (ZAI_DEPLOY_DEBUG=1)");
    expect(result.finalReport).toContain("/home/me/.claude/projects/-tmp-demo");
    expect(result.finalReport).toContain("abc.jsonl");
  });

  it("does NOT include the Debug Logs block when ZAI_DEPLOY_DEBUG is unset", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      // collectClaudeLogPathsImpl returns null when debug is off.
      collectClaudeLogPathsImpl: () => null,
      preflightImpl: async () => ({
        success: false,
        message: "auth missing",
        summary: "auth missing",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.finalReport).toContain("Deployment Failed");
    expect(result.finalReport).not.toContain("Debug Logs");
  });

  it("falls back to a debugLogs string when the formatter throws (ZAI_DEPLOY_DEBUG=1)", async () => {
    const claudeLogPaths = {
      projectLogDir: "/home/me/.claude/projects/-tmp-demo",
      jsonlFiles: [
        "/home/me/.claude/projects/-tmp-demo/abc.jsonl",
        "/home/me/.claude/projects/-tmp-demo/def.jsonl",
      ],
    };
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      collectClaudeLogPathsImpl: () => claudeLogPaths,
      formatReportImpl: async () => {
        throw new Error("template parse error");
      },
      preflightImpl: async () => ({
        success: false,
        message: "auth missing",
        summary: "auth missing",
      }),
    });
    expect(result.success).toBe(false);
    // No box-drawing finalReport because the formatter threw, but the user
    // still needs to know where the logs are.
    expect(result.finalReport).toBeUndefined();
    expect(result.debugLogs).toBeDefined();
    expect(result.debugLogs).toContain("ZAI_DEPLOY_DEBUG=1");
    expect(result.debugLogs).toContain(
      "/home/me/.claude/projects/-tmp-demo/abc.jsonl",
    );
    expect(result.debugLogs).toContain(
      "/home/me/.claude/projects/-tmp-demo/def.jsonl",
    );
  });

  it("does not emit finalReport on success", async () => {
    const result = await runArbitraryPrepareLocal({
      cwd: "/tmp/demo",
      nowFn: () => 1777000000000,
      pid: 4242,
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envReady: false,
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci",
          output: "dist",
          startCommand: "npm start",
        },
      }),
      validateBuildImpl: async () => ({
        success: true,
        buildSucceeded: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        buildCommand: "npm ci",
        summary: "ok",
      }),
      renderDockerfilesImpl: async (opts) => ({
        success: true,
        agentWorkDir: opts.agentWorkDir,
        dockerfileBuildPath: opts.agentWorkDir + "/Dockerfile.build",
        dockerfileRunPath: opts.agentWorkDir + "/Dockerfile.run",
        buildScriptPath: opts.agentWorkDir + "/buildDockerImage.sh",
        summary: "ok",
      }),
    });
    expect(result.success).toBe(true);
    expect(result.finalReport).toBeUndefined();
  });

  it("persists a reserved managed database project before remote deploy", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    const result = await runArbitraryPrepareLocal({
      cwd: tempDir,
      databaseMode: "managed",
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: null,
        envStatus: "normal",
        envReady: true,
        databaseCapabilities: {
          supports: ["mysql"],
          mysql: { provisioning: true, accounts: true, sql: true },
        },
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci",
          output: "Source files",
          startCommand: "npm start",
          database: {
            detected: true,
            type: "mysql",
            requiredEnv: ["DATABASE_URL"],
            orm: "prisma",
            migrationCommand: "npx prisma migrate deploy",
          },
        },
      }),
      validateBuildImpl: async () => ({
        success: true,
        buildSucceeded: true,
        buildCommand: "npm ci",
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
      databaseResolveImpl: async () => ({
        success: true,
        projectId: "reserved-project",
        database: {
          mode: "managed",
          type: "mysql",
          orm: "prisma",
          migrationCommand: "npx prisma migrate deploy",
          bindingId: "dbbind-1",
        },
        databaseBindings: [
          {
            bindingId: "dbbind-1",
            env: {
              DATABASE_URL: "secretRef:DATABASE_URL",
              MYSQL_HOST: "valueRef:host",
            },
          },
        ],
      }),
      renderDockerfilesImpl: async (options) => ({
        success: true,
        dockerfileBuildPath: path.join(
          options.agentWorkDir,
          "Dockerfile.build",
        ),
        dockerfileRunPath: path.join(options.agentWorkDir, "Dockerfile.run"),
      }),
    });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe("reserved-project");
    const settings = JSON.parse(
      fs.readFileSync(
        path.join(tempDir, ".zai/deploy/tcb-settings.json"),
        "utf8",
      ),
    );
    expect(settings.projectId).toBe("reserved-project");
    expect(settings.database).toMatchObject({
      bindingId: "dbbind-1",
      mode: "managed",
      type: "mysql",
      framework: "prisma",
      migrationCommand: "npx prisma migrate deploy",
      envKeys: ["DATABASE_URL", "MYSQL_HOST"],
    });
  });

  it("preserves the stored migration fingerprint when refreshing a prepared binding", async () => {
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
        database: {
          bindingId: "dbbind-1",
          mode: "managed",
          type: "mysql",
          framework: "prisma",
          migrationCommand: "npx prisma migrate deploy",
          migrationFingerprint: "fingerprint-old",
          lastMigrationSyncAction: "checked",
        },
      }),
    );

    const result = await runArbitraryPrepareLocal({
      cwd: tempDir,
      databaseMode: "managed",
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      preflightImpl: async () => ({
        success: true,
        timeoutSeconds: 300,
        maxRetries: 3,
        uploadSizeLimit: 104857600,
        projectId: "project-1",
        envStatus: "normal",
        envReady: true,
        databaseCapabilities: {
          supports: ["mysql"],
          mysql: { provisioning: true, accounts: true, sql: true },
        },
      }),
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci",
          output: "Source files",
          startCommand: "npm start",
          database: {
            detected: true,
            type: "mysql",
            requiredEnv: ["DATABASE_URL"],
            orm: "prisma",
            migrationCommand: "npx prisma migrate deploy",
          },
        },
      }),
      validateBuildImpl: async () => ({
        success: true,
        buildSucceeded: true,
        buildCommand: "npm ci",
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
      databaseResolveImpl: async () => ({
        success: true,
        projectId: "project-1",
        database: {
          mode: "managed",
          type: "mysql",
          orm: "prisma",
          migrationCommand: "npx prisma migrate deploy",
          bindingId: "dbbind-1",
        },
        databaseBindings: [
          {
            bindingId: "dbbind-1",
            env: {
              DATABASE_URL: "secretRef:DATABASE_URL",
            },
          },
        ],
      }),
      renderDockerfilesImpl: async (options) => ({
        success: true,
        dockerfileBuildPath: path.join(
          options.agentWorkDir,
          "Dockerfile.build",
        ),
        dockerfileRunPath: path.join(options.agentWorkDir, "Dockerfile.run"),
      }),
    });

    expect(result.success).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(settings.database).toMatchObject({
      bindingId: "dbbind-1",
      migrationFingerprint: "fingerprint-old",
      lastMigrationSyncAction: "checked",
    });
  });
});
