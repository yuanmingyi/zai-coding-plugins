import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PROJECT_GONE_MESSAGE,
  runArbitraryPreflight,
} from "../arbitrary/preflight.js";

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-preflight-"));
}

const NORMAL_ENV = {
  envId: "env_abc",
  envAlias: "e12345",
  envStatus: "normal",
  defaultDomain: "env_abc.tcb.qcloud.la",
  region: "ap-shanghai",
  isReady: true,
  errorMessage: null,
};

const SHARED_CONFIG = {
  timeout: 300,
  retryTimes: 3,
  uploadSizeLimit: 104857600,
};

describe("arbitrary/preflight (TCB API v2)", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("succeeds for a returning customer with a normal env and existing project", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: path.basename(tempDir),
        endpoint: "https://api.example.com",
        projectId: "project-1",
        deployments: [{ taskId: "task-1" }],
      }),
    );

    const requestedUrls = [];
    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async (url) => {
        requestedUrls.push(url);
        return makeResponse({
          code: 200,
          data: {
            env: NORMAL_ENV,
            project: { projectId: "project-1" },
            config: SHARED_CONFIG,
            database: {
              supports: ["mysql"],
              mysql: { provisioning: true, accounts: true, sql: true },
              postgresql: { provisioning: false, sql: false },
            },
            accessControl: {
              enabled: true,
              mode: "restricted",
              source: "server-config",
              enforcement: "runtime-nginx-x-envoy-external-address-v1",
              policyVersion: "acp_test",
              status: "pending",
              expectedDeniedStatus: 403,
            },
          },
        });
      },
    });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe("project-1");
    expect(result.envStatus).toBe("normal");
    expect(result.envReady).toBe(true);
    expect(result.firstDeployNotice).toBeNull();
    expect(result.timeoutSeconds).toBe(300);
    expect(result.maxRetries).toBe(3);
    expect(result.uploadSizeLimit).toBe(104857600);
    expect(result.databaseCapabilities).toEqual({
      supports: ["mysql"],
      mysql: { provisioning: true, accounts: true, sql: true },
      postgresql: { provisioning: false, sql: false },
    });
    expect(result.accessControl).toEqual({
      enabled: true,
      mode: "restricted",
      source: "server-config",
      enforcement: "runtime-nginx-x-envoy-external-address-v1",
      policyVersion: "acp_test",
      status: "pending",
      expectedDeniedStatus: 403,
    });
    expect(result.summary).toContain("Pre-flight checks passed");
    expect(result.envType).toBeUndefined();
    expect(result.envBenefit).toBeUndefined();
    expect(result.capacity).toBeUndefined();
    expect(result.projectEnvTypes).toBeUndefined();
    expect(requestedUrls).toEqual([
      "https://api.example.com/client/tcb/status?projectId=project-1",
    ]);
  });

  it("returns a first-deploy notice when the customer has no env yet", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: {
              envId: "",
              envAlias: "",
              envStatus: "not_initialized",
              isReady: false,
              errorMessage: null,
            },
            project: null,
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(true);
    expect(result.envStatus).toBe("not_initialized");
    expect(result.envReady).toBe(false);
    expect(result.firstDeployNotice).toMatch(/first-time deploy/i);
    expect(result.firstDeployNotice).toMatch(/several minutes/i);
    expect(result.summary).toContain("Pre-flight checks passed");
    expect(result.summary).toContain(result.firstDeployNotice);
  });

  it("also passes notice through when the env is still being created concurrently", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: {
              ...NORMAL_ENV,
              envStatus: "creating",
              isReady: false,
            },
            project: null,
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(true);
    expect(result.envStatus).toBe("creating");
    expect(result.firstDeployNotice).toContain("still being provisioned");
  });

  it("fails fast when the env is in a failed state", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: {
              ...NORMAL_ENV,
              envStatus: "failed",
              isReady: false,
              errorMessage: "TCB API rejected env creation",
            },
            project: null,
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Deployment environment is not usable");
    expect(result.message).toContain("envStatus: `failed`");
    expect(result.message).toContain("TCB API rejected env creation");
  });

  it("fails fast when the env is isolated", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: {
              ...NORMAL_ENV,
              envStatus: "isolated",
              isReady: false,
            },
            project: null,
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("envStatus: `isolated`");
  });

  it("clears stale local settings when the server forgot the project", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: path.basename(tempDir),
        endpoint: "https://api.example.com",
        projectId: "project-gone",
        deployments: [{ taskId: "task-1" }],
      }),
    );

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: NORMAL_ENV,
            project: null,
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe(PROJECT_GONE_MESSAGE);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("cleans stale settings when status returns PROJECT_NOT_FOUND", async () => {
    const tempDir = makeTempProject();
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

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 3012,
          msg: "PROJECT_NOT_FOUND",
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe(PROJECT_GONE_MESSAGE);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("returns a user-facing failure when auth is missing", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: { ZAI_API_BASE_URL: "https://api.example.com" },
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Authentication token not configured");
  });

  it("keeps sanitized API evidence when the deploy server returns an auth error envelope", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 401,
          msg: "身份验证失败。",
          data: null,
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Deploy API error: 身份验证失败。");
    expect(result.apiRecord).toMatchObject({
      url: "https://api.example.com/client/tcb/status",
      method: "GET",
      responseStatus: 200,
      responseBody: {
        code: 401,
        msg: "身份验证失败。",
        data: null,
      },
      errorMessage: "Deploy API error: 身份验证失败。",
    });
    expect(result.apiRecords).toEqual([result.apiRecord]);
  });

  it("returns a user-facing failure when the settings file is malformed", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "{bad json");

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe(
      `Invalid deploy settings file: ${settingsPath}`,
    );
  });

  it("returns a user-facing failure when the status config payload is invalid", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: NORMAL_ENV,
            project: null,
            config: { ...SHARED_CONFIG, timeout: 0 },
          },
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("invalid `timeout` config");
  });

  it("normalizes stale project-scoped settings and persists the cleaned file", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: "old-project",
        endpoint: "https://api.example.com",
        projectId: "project-1",
        deployments: [{ taskId: "task-1", envType: "ADVANCED" }],
      }),
    );

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: NORMAL_ENV,
            project: null,
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(true);
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(saved.projectName).toBe(path.basename(tempDir));
    expect(saved.projectId).toBeUndefined();
    expect(saved.deployments).toBeUndefined();
  });

  it("normalizes upper-case envStatus values (e.g. 'NORMAL') to lower-case", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: { ...NORMAL_ENV, envStatus: "NORMAL" },
            project: null,
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(true);
    expect(result.envStatus).toBe("normal");
    expect(result.envReady).toBe(true);
  });

  it("enforces isReady invariant locally: envReady is false if envStatus isn't 'normal' even when isReady=true", async () => {
    const tempDir = makeTempProject();
    tempDirs.push(tempDir);

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: { ...NORMAL_ENV, envStatus: "creating", isReady: true },
            project: null,
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(true);
    expect(result.envStatus).toBe("creating");
    // Server lied about isReady; preflight must trust envStatus.
    expect(result.envReady).toBe(false);
  });

  it("ignores legacy envType fields recorded in deployments and does not surface them", async () => {
    const tempDir = makeTempProject();
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
          { taskId: "task-2", envType: "ADVANCED" },
          { taskId: "task-1", envType: "BASIC" },
        ],
      }),
    );

    const result = await runArbitraryPreflight({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            env: NORMAL_ENV,
            project: { projectId: "project-1" },
            config: SHARED_CONFIG,
          },
        }),
    });

    expect(result.success).toBe(true);
    expect(result.envType).toBeUndefined();
    expect(result.summary).not.toContain("ADVANCED");
    expect(result.summary).not.toContain("envType");
  });
});
