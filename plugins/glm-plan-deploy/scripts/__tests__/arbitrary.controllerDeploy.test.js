import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runArbitraryControllerDeploy } from "../arbitrary/controllerDeploy.js";

const NGINX_ACCESS_CONTROL_CAPABILITY =
  "runtime-nginx-x-envoy-external-address-v1";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-controller-"));
}

function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function makeEmptyResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return "";
    },
  };
}

describe("arbitrary/controllerDeploy", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("packs source files into a tar.gz, uploads the archive, creates a task, and records deployment state", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "Dockerfile.run"), "FROM node:20\n");
    fs.writeFileSync(path.join(packageDir, "app.js"), "console.log('ready')\n");

    const requests = [];
    const archiveUploads = [];
    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      appName: "demo-app",
      area: "global",
      now: "2026-04-16T15:00:00.000Z",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-1",
              objectPrefix: "uploads/demo/",
              area: "global",
              files: [
                {
                  relativePath: "deploy-package.tar.gz",
                  objectKey: "uploads/demo/deploy-package.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/archive",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/archive") {
          archiveUploads.push(init);
          return makeEmptyResponse(200);
        }
        if (url === "https://api.example.com/client/tcb/createTask") {
          return makeJsonResponse({
            code: 200,
            data: {
              taskId: "task-1",
              projectId: "project-1",
              status: "Processing",
              currentStep: "BUILDING",
              accessControl: {
                enabled: true,
                mode: "restricted",
                source: "server-config",
                enforcement: NGINX_ACCESS_CONTROL_CAPABILITY,
                policyVersion: "acp_test",
                status: "pending",
                expectedDeniedStatus: 403,
              },
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(result.taskId).toBe("task-1");
    expect(result.projectId).toBe("project-1");
    expect(result.accessControl).toEqual({
      enabled: true,
      mode: "restricted",
      source: "server-config",
      enforcement: NGINX_ACCESS_CONTROL_CAPABILITY,
      policyVersion: "acp_test",
      status: "pending",
      expectedDeniedStatus: 403,
    });
    expect(result.objectPrefix).toBe("uploads/demo/");
    expect(result.uploadedFiles).toEqual(["deploy-package.tar.gz"]);
    expect(result.apiRecords).toHaveLength(2);
    expect(result.apiRecords[0]).toMatchObject({
      url: "https://api.example.com/client/tcb/initUpload",
      method: "POST",
      requestBody: {
        files: ["deploy-package.tar.gz"],
      },
      responseStatus: 200,
      responseBody: {
        code: 200,
        data: {
          projectId: "project-1",
          objectPrefix: "uploads/demo/",
        },
      },
    });
    expect(result.apiRecords[1]).toMatchObject({
      url: "https://api.example.com/client/tcb/createTask",
      method: "POST",
      requestBody: {
        archiveObjectKey: "uploads/demo/deploy-package.tar.gz",
        appName: "demo-app",
        runtimeCapabilities: {
          nginxAccessControl: NGINX_ACCESS_CONTROL_CAPABILITY,
        },
      },
      responseBody: {
        code: 200,
        data: {
          taskId: "task-1",
        },
      },
    });
    // envType is removed in API v2 — the request body must not carry it.
    expect(result.apiRecords[1].requestBody.envType).toBeUndefined();
    expect(result.archiveObjectKey).toBe("uploads/demo/deploy-package.tar.gz");
    const createTaskRequest = requests.find(
      (entry) => entry.url === "https://api.example.com/client/tcb/createTask",
    );
    expect(JSON.parse(createTaskRequest.init.body)).not.toHaveProperty(
      "objectPrefix",
    );
    expect(JSON.parse(createTaskRequest.init.body)).toMatchObject({
      runtimeCapabilities: {
        nginxAccessControl: NGINX_ACCESS_CONTROL_CAPABILITY,
      },
    });

    const settings = JSON.parse(
      fs.readFileSync(
        path.join(tempDir, ".zai/deploy/tcb-settings.json"),
        "utf8",
      ),
    );
    expect(settings.projectId).toBe("project-1");
    expect(settings.deployments[0]).toEqual({
      taskId: "task-1",
      date: "2026-04-16T15:00:00.000Z",
    });

    const initUploadRequest = requests.find(
      (entry) => entry.url === "https://api.example.com/client/tcb/initUpload",
    );
    expect(JSON.parse(initUploadRequest.init.body)).toEqual({
      files: ["deploy-package.tar.gz"],
    });

    const archivePath = path.join(tempDir, "deploy-package.tar.gz");
    expect(fs.existsSync(archivePath)).toBe(true);
    expect(fs.statSync(archivePath).size).toBeGreaterThan(0);
    expect(archiveUploads).toHaveLength(1);
    expect(archiveUploads[0].headers["Content-Type"]).toBe(
      "application/octet-stream",
    );
    expect(archiveUploads[0].body).toBeInstanceOf(Buffer);
    expect(archiveUploads[0].body.length).toBe(fs.statSync(archivePath).size);
  });

  it("passes managed database bindings to createTask", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "Dockerfile.run"), "FROM node:20\n");

    const createTaskBodies = [];
    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      appName: "demo-app",
      databaseBindings: [
        {
          bindingId: "dbbind-1",
          env: {
            DATABASE_URL: "secretRef:DATABASE_URL",
            MYSQL_HOST: "valueRef:host",
            MYSQL_PORT: "valueRef:port",
            MYSQL_DATABASE: "valueRef:database",
            MYSQL_USER: "valueRef:username",
          },
        },
      ],
      fetchImpl: async (url, init = {}) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-1",
              files: [
                {
                  relativePath: "deploy-package.tar.gz",
                  objectKey: "uploads/demo/deploy-package.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/archive",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/archive") {
          return makeEmptyResponse(200);
        }
        if (url === "https://api.example.com/client/tcb/createTask") {
          createTaskBodies.push(JSON.parse(init.body));
          return makeJsonResponse({
            code: 200,
            data: {
              taskId: "task-1",
              projectId: "project-1",
              status: "Processing",
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(createTaskBodies).toHaveLength(1);
    expect(createTaskBodies[0].databaseBindings).toEqual([
      {
        bindingId: "dbbind-1",
        env: {
          DATABASE_URL: "secretRef:DATABASE_URL",
          MYSQL_HOST: "valueRef:host",
          MYSQL_PORT: "valueRef:port",
          MYSQL_DATABASE: "valueRef:database",
          MYSQL_USER: "valueRef:username",
        },
      },
    ]);
  });

  it("uses an explicit projectId for initUpload and createTask", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "Dockerfile.run"), "FROM node:20\n");

    const requestBodies = [];
    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      projectId: "reserved-project",
      fetchImpl: async (url, init = {}) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          requestBodies.push(["initUpload", JSON.parse(init.body)]);
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "reserved-project",
              files: [
                {
                  relativePath: "deploy-package.tar.gz",
                  objectKey: "uploads/demo/deploy-package.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/archive",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/archive") {
          return makeEmptyResponse(200);
        }
        if (url === "https://api.example.com/client/tcb/createTask") {
          requestBodies.push(["createTask", JSON.parse(init.body)]);
          return makeJsonResponse({
            code: 200,
            data: {
              taskId: "task-1",
              projectId: "reserved-project",
              status: "Processing",
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(requestBodies).toEqual([
      [
        "initUpload",
        {
          projectId: "reserved-project",
          files: ["deploy-package.tar.gz"],
        },
      ],
      [
        "createTask",
        {
          projectId: "reserved-project",
          archiveObjectKey: "uploads/demo/deploy-package.tar.gz",
          appName: path.basename(tempDir).toLowerCase(),
          runtimeCapabilities: {
            nginxAccessControl: NGINX_ACCESS_CONTROL_CAPABILITY,
          },
        },
      ],
    ]);
  });

  it("passes sanitized database metadata to deployment state recording", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "Dockerfile.run"), "FROM node:20\n");

    const recordCalls = [];
    const database = {
      mode: "managed",
      type: "mysql",
      orm: "prisma",
      migrationCommand: "npx prisma migrate deploy",
      bindingId: "dbbind-1",
    };
    const databaseBindings = [
      {
        bindingId: "dbbind-1",
        env: {
          DATABASE_URL: "secretRef:DATABASE_URL",
        },
      },
    ];
    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      database,
      databaseBindings,
      recordDeploymentImpl: (options) => {
        recordCalls.push(options);
        return { success: true };
      },
      fetchImpl: async (url) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-1",
              files: [
                {
                  relativePath: "deploy-package.tar.gz",
                  objectKey: "uploads/demo/deploy-package.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/archive",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/archive") {
          return makeEmptyResponse(200);
        }
        if (url === "https://api.example.com/client/tcb/createTask") {
          return makeJsonResponse({
            code: 200,
            data: {
              taskId: "task-1",
              projectId: "project-1",
              status: "Processing",
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(recordCalls[0]).toMatchObject({
      database,
      databaseBindings,
      projectId: "project-1",
      taskId: "task-1",
    });
  });

  it("fails before upload when a database binding contains a literal env value", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "Dockerfile.run"), "FROM node:20\n");

    let requests = 0;
    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      databaseBindings: [
        {
          bindingId: "dbbind-1",
          env: {
            DATABASE_URL: "mysql://user:password@example.com/app",
          },
        },
      ],
      fetchImpl: async () => {
        requests += 1;
        throw new Error("should not fetch");
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("controllerDeploy");
    expect(result.message).toContain("databaseBindings");
    expect(result.message).toContain("secretRef:");
    expect(requests).toBe(0);
  });

  it("retries presigned archive upload once on network connection failure", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "app.js"), "console.log('ready')\n");

    let uploadAttempts = 0;
    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      appName: "demo-app",
      fetchImpl: async (url) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-1",
              objectPrefix: "uploads/demo/",
              files: [
                {
                  relativePath: "deploy-package.tar.gz",
                  objectKey: "uploads/demo/deploy-package.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/archive",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/archive") {
          uploadAttempts += 1;
          if (uploadAttempts === 1) {
            const error = new TypeError("fetch failed");
            error.cause = { code: "ECONNRESET" };
            throw error;
          }
          return makeEmptyResponse(200);
        }
        if (url === "https://api.example.com/client/tcb/createTask") {
          return makeJsonResponse({
            code: 200,
            data: {
              taskId: "task-1",
              projectId: "project-1",
              status: "Processing",
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(uploadAttempts).toBe(2);
    expect(result.uploadedFiles).toEqual(["deploy-package.tar.gz"]);
  });

  it("fails before network calls when the compressed archive exceeds the limit", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "app.js"), "x".repeat(32));

    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 4,
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Upload size limit exceeded");
    expect(result.message).toContain("Compressed package size");
  });

  it("retries initUpload without a stale projectId and clears persisted state", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "app.js"), "console.log('ready')\n");

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: path.basename(tempDir),
        endpoint: "https://api.example.com",
        projectId: "stale-project",
        deployments: [{ taskId: "task-old", envType: "BASIC" }],
      }),
    );

    let initUploadAttempts = 0;
    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      now: "2026-04-16T15:00:00.000Z",
      fetchImpl: async (url, init = {}) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          initUploadAttempts += 1;
          if (initUploadAttempts === 1) {
            const body = JSON.parse(init.body);
            expect(body.projectId).toBe("stale-project");
            expect(body.files).toEqual(["deploy-package.tar.gz"]);
            return makeJsonResponse({ code: 1220, msg: "Invalid projectId" });
          }

          const body = JSON.parse(init.body);
          expect(body.projectId).toBeUndefined();
          expect(body.files).toEqual(["deploy-package.tar.gz"]);
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-2",
              objectPrefix: "uploads/demo/",
              area: "global",
              files: [
                {
                  relativePath: "deploy-package.tar.gz",
                  objectKey: "uploads/demo/deploy-package.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/archive",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/archive") {
          return makeEmptyResponse(200);
        }
        if (url === "https://api.example.com/client/tcb/createTask") {
          return makeJsonResponse({
            code: 200,
            data: {
              taskId: "task-2",
              projectId: "project-2",
              status: "Processing",
              currentStep: "BUILDING",
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(initUploadAttempts).toBe(2);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(settings.projectId).toBe("project-2");
    expect(settings.deployments[0].taskId).toBe("task-2");
  });

  it("fails when initUpload response omits the archive presigned URL", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "app.js"), "console.log('ready')\n");

    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      fetchImpl: async (url) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-1",
              objectPrefix: "uploads/demo/",
              area: "global",
              files: [
                {
                  relativePath: "some-other-file.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/other",
                },
              ],
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("upload");
    expect(result.message).toContain("deploy-package.tar.gz");
  });

  it("returns initUpload API diagnostics when the API request fails", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "app.js"), "console.log('ready')\n");

    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      fetchImpl: async (url) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({ code: 500, msg: "internal upload error" });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("initUpload");
    expect(result.apiRecords).toHaveLength(1);
    expect(result.apiRecords[0]).toMatchObject({
      url: "https://api.example.com/client/tcb/initUpload",
      method: "POST",
      requestBody: {
        files: ["deploy-package.tar.gz"],
      },
      responseStatus: 200,
      responseBody: {
        code: 500,
        msg: "internal upload error",
      },
    });
  });

  it("returns initUpload request diagnostics when fetch fails before a response", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "app.js"), "console.log('ready')\n");

    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      fetchImpl: async (url) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          const error = new TypeError("fetch failed");
          error.cause = { code: "ECONNRESET" };
          throw error;
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("initUpload");
    expect(result.apiRecords).toHaveLength(1);
    expect(result.apiRecords[0]).toMatchObject({
      url: "https://api.example.com/client/tcb/initUpload",
      method: "POST",
      requestBody: {
        files: ["deploy-package.tar.gz"],
      },
      responseStatus: null,
      responseBody: null,
      errorMessage: "fetch failed",
      causeCode: "ECONNRESET",
    });
  });

  it("labels local deployment-state persistence failure as recordDeployment", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const packageDir = path.join(tempDir, "package");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "app.js"), "console.log('ready')\n");

    const result = await runArbitraryControllerDeploy({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir,
      uploadSizeLimit: 1024 * 1024,
      fetchImpl: async (url) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-1",
              objectPrefix: "uploads/demo/",
              area: "global",
              files: [
                {
                  relativePath: "deploy-package.tar.gz",
                  objectKey: "uploads/demo/deploy-package.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/archive",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/archive") {
          return makeEmptyResponse(200);
        }
        if (url === "https://api.example.com/client/tcb/createTask") {
          return makeJsonResponse({
            code: 200,
            data: {
              taskId: "task-1",
              projectId: "project-1",
              status: "Processing",
              currentStep: "BUILDING",
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      recordDeploymentImpl: () => ({
        success: false,
        message: "failed to persist local state",
        summary: "failed to persist local state",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("recordDeployment");
    expect(result.message).toBe("failed to persist local state");
  });

  it("labels pre-network validation failures as controllerDeploy", async () => {
    const result = await runArbitraryControllerDeploy({
      cwd: makeTempDir(),
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      packageDir: "/does/not/exist",
      uploadSizeLimit: 1024 * 1024,
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("controllerDeploy");
    expect(result.message).toContain("Package directory does not exist");
  });
});
