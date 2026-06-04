import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveDatabaseBindings } from "../arbitrary/database.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-db-"));
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

describe("arbitrary/database", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("plans and prepares a managed MySQL binding through the deploy API server", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const requests = [];

    const result = await resolveDatabaseBindings({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, body: JSON.parse(init.body) });
        if (url === "https://api.example.com/client/tcb/database/plan") {
          return makeJsonResponse({
            code: 200,
            data: {
              mode: "managed",
              type: "mysql",
              action: "prepare",
            },
          });
        }
        if (url === "https://api.example.com/client/tcb/database/prepare") {
          return makeJsonResponse({
            code: 200,
            data: {
              operationId: "dbop-1",
              bindingId: "dbbind-1",
              status: "success",
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      projectId: "project-1",
      appName: "demo-app",
      mode: "managed",
      detectedDatabase: {
        detected: true,
        type: "mysql",
        requiredEnv: ["DATABASE_URL"],
        orm: "prisma",
        migrationCommand: "npx prisma migrate deploy",
      },
    });

    expect(result.success).toBe(true);
    expect(result.databaseBindings).toEqual([
      {
        bindingId: "dbbind-1",
        env: {
          DATABASE_URL: "secretRef:DATABASE_URL",
          MYSQL_DATABASE: "valueRef:database",
          MYSQL_HOST: "valueRef:host",
          MYSQL_PORT: "valueRef:port",
          MYSQL_USER: "valueRef:username",
        },
      },
    ]);
    expect(requests).toEqual([
      {
        url: "https://api.example.com/client/tcb/database/plan",
        body: {
          projectId: "project-1",
          appName: "demo-app",
          detected: {
            type: "mysql",
            requiredEnv: ["DATABASE_URL"],
            orm: "prisma",
            migrationCommand: "npx prisma migrate deploy",
          },
          mode: "managed",
        },
      },
      {
        url: "https://api.example.com/client/tcb/database/prepare",
        body: {
          projectId: "project-1",
          appName: "demo-app",
          mode: "managed",
          type: "mysql",
        },
      },
    ]);
  });

  it("reserves a project before managed DB prepare when projectId is missing", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const requests = [];

    const result = await resolveDatabaseBindings({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, body: JSON.parse(init.body) });
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "reserved-project",
              files: [
                {
                  relativePath: "db-migration-source.tar.gz",
                  objectKey: "uploads/db/source.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/source",
                },
              ],
            },
          });
        }
        if (url === "https://api.example.com/client/tcb/database/plan") {
          return makeJsonResponse({ code: 200, data: {} });
        }
        if (url === "https://api.example.com/client/tcb/database/prepare") {
          return makeJsonResponse({
            code: 200,
            data: {
              operationId: "dbop-1",
              bindingId: "dbbind-1",
              status: "success",
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      appName: "demo-app",
      mode: "managed",
      detectedDatabase: {
        detected: true,
        type: "mysql",
        requiredEnv: ["DATABASE_URL"],
      },
    });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe("reserved-project");
    expect(requests.map((entry) => entry.url)).toEqual([
      "https://api.example.com/client/tcb/initUpload",
      "https://api.example.com/client/tcb/database/plan",
      "https://api.example.com/client/tcb/database/prepare",
    ]);
    expect(requests[0].body).toEqual({
      reserveProject: true,
      files: ["db-migration-source.tar.gz"],
    });
    expect(requests[1].body.projectId).toBe("reserved-project");
    expect(requests[2].body.projectId).toBe("reserved-project");
  });
});
