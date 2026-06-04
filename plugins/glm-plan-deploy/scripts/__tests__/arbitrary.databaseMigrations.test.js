import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runArbitraryDatabaseStatus,
  runArbitraryDatabaseSync,
} from "../arbitrary/databaseMigrations.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-db-migrations-"));
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

function writePrismaProject(tempDir) {
  fs.writeFileSync(
    path.join(tempDir, "package.json"),
    JSON.stringify({
      scripts: { start: "node server.js" },
      dependencies: {
        "@prisma/client": "^5.0.0",
        express: "^4.18.0",
      },
      devDependencies: { prisma: "^5.0.0" },
    }),
  );
  fs.writeFileSync(
    path.join(tempDir, "server.js"),
    "require('express')().listen(process.env.PORT || 3000)\n",
  );
  fs.mkdirSync(path.join(tempDir, "prisma", "migrations", "001_init"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(tempDir, "prisma", "schema.prisma"),
    [
      "datasource db {",
      '  provider = "mysql"',
      '  url = env("DATABASE_URL")',
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(tempDir, "prisma", "migrations", "001_init", "migration.sql"),
    "CREATE TABLE users (id int primary key);\n",
  );
}

function writeSettings(tempDir) {
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
        type: "mysql",
        framework: "prisma",
        migrationCommand: "npx prisma migrate deploy",
        envKeys: ["DATABASE_URL"],
      },
    }),
  );
}

function migrationResult(overrides = {}) {
  return {
    framework: "prisma",
    connected: true,
    migrationTableExists: true,
    appliedMigrations: [],
    pendingMigrations: [],
    drift: false,
    summary: "status ok",
    ...overrides,
  };
}

describe("arbitrary/databaseMigrations", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("uploads source metadata and checks migration status through the deploy API server", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir);

    const requests = [];
    const result = await runArbitraryDatabaseStatus({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (
          url ===
          "https://api.example.com/client/tcb/status?projectId=project-1"
        ) {
          return makeJsonResponse({
            code: 200,
            data: {
              env: { envStatus: "normal", isReady: true },
              project: { projectId: "project-1" },
              config: {
                timeout: 300,
                retryTimes: 3,
                uploadSizeLimit: 104857600,
              },
              database: {
                supports: ["mysql"],
                mysql: { provisioning: true, accounts: true, sql: true },
              },
            },
          });
        }
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-1",
              files: [
                {
                  relativePath: "db-migration-source.tar.gz",
                  objectKey: "uploads/db/db-migration-source.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/db-source",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/db-source") {
          return makeEmptyResponse(200);
        }
        if (
          url === "https://api.example.com/client/tcb/database/migrations/check"
        ) {
          return makeJsonResponse({
            code: 200,
            data: {
              operationId: "dbop-check",
              bindingId: "dbbind-1",
              status: "success",
              result: {
                framework: "prisma",
                connected: true,
                migrationTableExists: true,
                appliedMigrations: ["001_init"],
                pendingMigrations: ["002_add_email"],
                drift: false,
                summary: "1 pending migration",
              },
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe("completed");
    expect(result.migrationResult.pendingMigrations).toEqual(["002_add_email"]);
    expect(result.summary).toContain("Pending migrations: 1");

    const initUploadRequest = requests.find((entry) =>
      entry.url.endsWith("/client/tcb/initUpload"),
    );
    expect(JSON.parse(initUploadRequest.init.body)).toEqual({
      projectId: "project-1",
      files: ["db-migration-source.tar.gz"],
    });

    const checkRequest = requests.find((entry) =>
      entry.url.endsWith("/client/tcb/database/migrations/check"),
    );
    expect(JSON.parse(checkRequest.init.body)).toEqual({
      projectId: "project-1",
      appName: path.basename(tempDir).toLowerCase(),
      bindingId: "dbbind-1",
      framework: "prisma",
      migrationCommand: "npx prisma migrate deploy",
      workingDir: ".",
      sourceArchiveObjectKey: "uploads/db/db-migration-source.tar.gz",
    });
  });

  it("reserves a project for migration status when requested and projectId is missing", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        projectName: path.basename(tempDir),
        endpoint: "https://api.example.com",
        database: {
          bindingId: "dbbind-1",
          framework: "prisma",
          migrationCommand: "npx prisma migrate deploy",
        },
      }),
    );

    const requests = [];
    const result = await runArbitraryDatabaseStatus({
      cwd: tempDir,
      reserveProject: true,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (url === "https://api.example.com/client/tcb/status") {
          return makeJsonResponse({
            code: 200,
            data: {
              env: { envStatus: "normal", isReady: true },
              project: null,
              config: {
                timeout: 300,
                retryTimes: 3,
                uploadSizeLimit: 104857600,
              },
              database: { supports: ["mysql"] },
            },
          });
        }
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "reserved-project",
              files: [
                {
                  relativePath: "db-migration-source.tar.gz",
                  objectKey: "uploads/db/db-migration-source.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/db-source",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/db-source") {
          return makeEmptyResponse(200);
        }
        if (
          url === "https://api.example.com/client/tcb/database/migrations/check"
        ) {
          return makeJsonResponse({
            code: 200,
            data: {
              operationId: "dbop-check",
              bindingId: "dbbind-1",
              status: "success",
              migrationResult: migrationResult(),
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe("reserved-project");
    const initUploadRequest = requests.find((entry) =>
      entry.url.endsWith("/client/tcb/initUpload"),
    );
    expect(JSON.parse(initUploadRequest.init.body)).toEqual({
      reserveProject: true,
      files: ["db-migration-source.tar.gz"],
    });
    const checkRequest = requests.find((entry) =>
      entry.url.endsWith("/client/tcb/database/migrations/check"),
    );
    expect(JSON.parse(checkRequest.init.body).projectId).toBe(
      "reserved-project",
    );
  });

  it("requires explicit confirmation before applying migrations", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir);

    const result = await runArbitraryDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async () => {
        throw new Error("should not call remote API without confirmation");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("confirm");
    expect(result.summary).toContain("--confirm");
  });

  it("rejects unsafe live-diff migration commands before upload", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir);

    const result = await runArbitraryDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      confirm: true,
      migrationCommand: "npx prisma db push",
      fetchImpl: async () => {
        throw new Error("should not call remote API with unsafe command");
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("validate");
    expect(result.message).toContain("Unsafe migration command");
  });

  it.each([
    "npx prisma migrate reset",
    "npx prisma migrate dev",
    "bundle exec rails db:migrate --force",
  ])("rejects unsafe migration command `%s` before upload", async (command) => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir);

    let uploaded = false;
    const result = await runArbitraryDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      confirm: true,
      migrationCommand: command,
      uploadSourceArchiveImpl: async () => {
        uploaded = true;
        throw new Error("should not upload");
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("validate");
    expect(result.message).toContain("Unsafe migration command");
    expect(uploaded).toBe(false);
  });

  it("normalizes Rails ActiveRecord detection to the server-supported rails framework id", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, "Gemfile"), "gem 'rails'\ngem 'pg'\n");
    writeSettings(tempDir);

    const requests = [];
    const result = await runArbitraryDatabaseStatus({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          serviceRoot: ".",
          database: {
            detected: true,
            type: "postgresql",
            orm: "activerecord",
            migrationCommand: "bundle exec rails db:migrate",
          },
        },
      }),
      preflightImpl: async () => ({
        success: true,
        envReady: true,
        uploadSizeLimit: 104857600,
      }),
      uploadSourceArchiveImpl: async () => ({
        success: true,
        sourceArchiveObjectKey: "uploads/db/source.tar.gz",
        apiRecords: [],
      }),
      requestJsonImpl: async (options) => {
        requests.push(options);
        return {
          data: {
            operationId: "op-1",
            status: "success",
            result: migrationResult({ framework: "rails" }),
          },
        };
      },
    });

    expect(result.success).toBe(true);
    expect(requests[0].body.framework).toBe("rails");
    expect(requests[0].body.migrationCommand).toBe(
      "bundle exec rails db:migrate",
    );
  });

  it("does not upload when detected framework is unsupported by the server", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writeSettings(tempDir);

    let uploaded = false;
    const result = await runArbitraryDatabaseStatus({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          serviceRoot: ".",
          database: {
            detected: true,
            type: "mysql",
            orm: "laravel",
            migrationCommand: "php artisan migrate --force",
          },
        },
      }),
      uploadSourceArchiveImpl: async () => {
        uploaded = true;
        throw new Error("should not upload");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("database");
    expect(result.summary).toContain("Unsupported migration framework");
    expect(uploaded).toBe(false);
  });

  it("bypasses unrelated deploy analyzer prompts when DB metadata is explicit", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);

    const requests = [];
    const result = await runArbitraryDatabaseStatus({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      projectId: "project-1",
      bindingId: "dbbind-1",
      framework: "prisma",
      migrationCommand: "npx prisma migrate deploy",
      analyzeImpl: async () => ({
        success: true,
        needsUserInput: true,
        reasonCode: "START_COMMAND_UNCLEAR",
        message: "Could not determine start command.",
        detectedConfig: { serviceRoot: "." },
      }),
      preflightImpl: async () => ({
        success: true,
        envReady: true,
        uploadSizeLimit: 104857600,
      }),
      uploadSourceArchiveImpl: async () => ({
        success: true,
        sourceArchiveObjectKey: "uploads/db/source.tar.gz",
        apiRecords: [],
      }),
      requestJsonImpl: async (options) => {
        requests.push(options);
        return {
          data: {
            operationId: "op-1",
            status: "success",
            result: migrationResult(),
          },
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(requests[0].body).toMatchObject({
      bindingId: "dbbind-1",
      framework: "prisma",
      migrationCommand: "npx prisma migrate deploy",
    });
  });

  it("applies checked-in migrations through the deploy API server when confirmed", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir);

    const requests = [];
    const result = await runArbitraryDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      confirm: true,
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (
          url ===
          "https://api.example.com/client/tcb/status?projectId=project-1"
        ) {
          return makeJsonResponse({
            code: 200,
            data: {
              env: { envStatus: "normal", isReady: true },
              project: { projectId: "project-1" },
              config: {
                timeout: 300,
                retryTimes: 3,
                uploadSizeLimit: 104857600,
              },
              database: { supports: ["mysql"] },
            },
          });
        }
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
              projectId: "project-1",
              files: [
                {
                  relativePath: "db-migration-source.tar.gz",
                  objectKey: "uploads/db/db-migration-source.tar.gz",
                  presignedUploadUrl: "https://upload.example.com/db-source",
                },
              ],
            },
          });
        }
        if (url === "https://upload.example.com/db-source") {
          return makeEmptyResponse(200);
        }
        if (
          url === "https://api.example.com/client/tcb/database/migrations/apply"
        ) {
          return makeJsonResponse({
            code: 200,
            data: {
              operationId: "dbop-apply",
              bindingId: "dbbind-1",
              status: "success",
              result: {
                framework: "prisma",
                connected: true,
                migrationTableExists: true,
                appliedMigrations: ["001_init", "002_add_email"],
                pendingMigrations: [],
                drift: false,
                summary: "applied",
              },
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe("completed");
    const applyRequest = requests.find((entry) =>
      entry.url.endsWith("/client/tcb/database/migrations/apply"),
    );
    expect(JSON.parse(applyRequest.init.body)).toMatchObject({
      bindingId: "dbbind-1",
      confirmed: true,
      migrationCommand: "npx prisma migrate deploy",
      sourceArchiveObjectKey: "uploads/db/db-migration-source.tar.gz",
    });
  });

  it("asks for a binding id when no stored database binding exists", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);

    const result = await runArbitraryDatabaseStatus({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("database");
    expect(result.summary).toContain("--bindingId");
  });
});
