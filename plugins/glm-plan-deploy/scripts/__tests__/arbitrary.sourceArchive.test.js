import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { uploadMigrationSourceArchive } from "../arbitrary/sourceArchive.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-source-archive-"));
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

describe("arbitrary/sourceArchive", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("excludes secret-bearing files while preserving migration source files", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const workDir = path.join(tempDir, ".zai", "archive-test");

    fs.mkdirSync(path.join(tempDir, "prisma", "migrations", "001_init"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, "prisma", "migrations", "001_init", "migration.sql"),
      "CREATE TABLE users (id int primary key);\n",
    );
    fs.writeFileSync(path.join(tempDir, ".env"), "SECRET=real\n");
    fs.writeFileSync(path.join(tempDir, ".env.production"), "SECRET=prod\n");
    fs.writeFileSync(path.join(tempDir, ".env.example"), "DATABASE_URL=\n");
    fs.writeFileSync(
      path.join(tempDir, ".npmrc"),
      "//registry/:_authToken=x\n",
    );
    fs.writeFileSync(path.join(tempDir, ".pypirc"), "password=x\n");
    fs.mkdirSync(path.join(tempDir, ".bundle"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".bundle", "config"), "secret\n");
    fs.mkdirSync(path.join(tempDir, "config"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "config", "master.key"), "key\n");
    fs.writeFileSync(path.join(tempDir, "private.pem"), "pem\n");
    fs.writeFileSync(path.join(tempDir, "server.js"), "console.log('ok')\n");

    const result = await uploadMigrationSourceArchive({
      context: {
        cwd: tempDir,
        baseUrl: "https://api.example.com",
        token: "token",
      },
      projectId: "project-1",
      workDir,
      fetchImpl: async (url) => {
        if (url === "https://api.example.com/client/tcb/initUpload") {
          return makeJsonResponse({
            code: 200,
            data: {
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
        if (url === "https://upload.example.com/source") {
          return makeEmptyResponse(200);
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    const entries = execFileSync("tar", ["-tzf", result.archivePath], {
      encoding: "utf8",
    }).split(/\r?\n/);
    expect(entries).toContain("./prisma/migrations/001_init/migration.sql");
    expect(entries).toContain("./server.js");
    expect(entries).toContain("./.env.example");
    expect(entries).not.toContain("./.env");
    expect(entries).not.toContain("./.env.production");
    expect(entries).not.toContain("./.npmrc");
    expect(entries).not.toContain("./.pypirc");
    expect(entries).not.toContain("./.bundle/config");
    expect(entries).not.toContain("./config/master.key");
    expect(entries).not.toContain("./private.pem");
  });

  it("can reserve a project while uploading migration source", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const workDir = path.join(tempDir, ".zai", "archive-test");
    const requests = [];

    fs.writeFileSync(path.join(tempDir, "server.js"), "console.log('ok')\n");

    const result = await uploadMigrationSourceArchive({
      context: {
        cwd: tempDir,
        baseUrl: "https://api.example.com",
        token: "token",
      },
      reserveProject: true,
      workDir,
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
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
        if (url === "https://upload.example.com/source") {
          return makeEmptyResponse(200);
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe("reserved-project");
    expect(JSON.parse(requests[0].init.body)).toEqual({
      reserveProject: true,
      files: ["db-migration-source.tar.gz"],
    });
  });
});
