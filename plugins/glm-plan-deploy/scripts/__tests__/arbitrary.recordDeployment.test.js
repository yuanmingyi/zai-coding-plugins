import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runRecordArbitraryDeployment } from "../arbitrary/recordDeployment.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-record-"));
}

describe("arbitrary/recordDeployment (TCB API v2)", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("persists project and latest task state for a new deployment without envType", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.writeFileSync(path.join(tempDir, ".env"), "PORT=9000\nSECRET=hidden\n");

    const result = await runRecordArbitraryDeployment({
      cwd: tempDir,
      env: { ZAI_API_BASE_URL: "https://api.example.com" },
      taskId: "task-1",
      projectId: "project-1",
      area: "overseas",
      now: "2026-04-16T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
    expect(result.envType).toBeUndefined();
    const settingsPath = path.join(tempDir, ".zai/deploy/tcb-settings.json");
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(saved).toMatchObject({
      projectName: path.basename(tempDir),
      endpoint: "https://api.example.com",
      projectId: "project-1",
      area: "overseas",
      createTime: "2026-04-16T12:00:00.000Z",
      env: ["PORT", "SECRET"],
    });
    expect(saved.envHash).toBeTruthy();
    expect(saved.deployments).toEqual([
      { taskId: "task-1", date: "2026-04-16T12:00:00.000Z" },
    ]);
    // Migration: writer must NOT emit envType on the latest record.
    expect(saved.deployments[0].envType).toBeUndefined();
  });

  it("persists sanitized database binding metadata for follow-up migration commands", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    const result = await runRecordArbitraryDeployment({
      cwd: tempDir,
      env: { ZAI_API_BASE_URL: "https://api.example.com" },
      taskId: "task-1",
      projectId: "project-1",
      now: "2026-04-16T12:00:00.000Z",
      database: {
        mode: "managed",
        type: "mysql",
        orm: "prisma",
        migrationCommand: "npx prisma migrate deploy",
        migrationFingerprint: "fingerprint-1",
        lastMigrationSyncAction: "applied",
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
    });

    expect(result.success).toBe(true);
    const saved = JSON.parse(
      fs.readFileSync(
        path.join(tempDir, ".zai/deploy/tcb-settings.json"),
        "utf8",
      ),
    );
    expect(saved.database).toEqual({
      bindingId: "dbbind-1",
      envKeys: ["DATABASE_URL", "MYSQL_HOST"],
      framework: "prisma",
      lastMigrationSyncAction: "applied",
      migrationCommand: "npx prisma migrate deploy",
      migrationFingerprint: "fingerprint-1",
      mode: "managed",
      type: "mysql",
    });
    expect(JSON.stringify(saved.database)).not.toContain("secretRef:");
    expect(JSON.stringify(saved.database)).not.toContain("valueRef:");
  });

  it("clears stale database metadata when a later deploy has no managed binding", async () => {
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
          bindingId: "dbbind-old",
          framework: "prisma",
          migrationCommand: "npx prisma migrate deploy",
        },
      }),
    );

    const result = await runRecordArbitraryDeployment({
      cwd: tempDir,
      env: { ZAI_API_BASE_URL: "https://api.example.com" },
      taskId: "task-2",
      projectId: "project-1",
      databaseBindings: [],
    });

    expect(result.success).toBe(true);
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(saved.database).toBeUndefined();
  });

  it("prepends the latest task and de-duplicates an existing task id", async () => {
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
          {
            taskId: "task-1",
            envType: "BASIC",
            date: "2026-04-15T00:00:00.000Z",
          },
          {
            taskId: "task-older",
            envType: "ADVANCED",
            date: "2026-04-14T00:00:00.000Z",
          },
        ],
      }),
    );

    const result = await runRecordArbitraryDeployment({
      cwd: tempDir,
      env: { ZAI_API_BASE_URL: "https://api.example.com" },
      taskId: "task-1",
      projectId: "project-1",
      now: "2026-04-16T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    // Every rewrite scrubs `envType` from surviving entries too, so the file
    // converges to a clean v2 shape on the first deploy after migration.
    expect(saved.deployments).toEqual([
      { taskId: "task-1", date: "2026-04-16T12:00:00.000Z" },
      { taskId: "task-older", date: "2026-04-14T00:00:00.000Z" },
    ]);
    for (const record of saved.deployments) {
      expect(record.envType).toBeUndefined();
    }
  });

  it("preserves createTime when projectId stays the same", async () => {
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
        createTime: "2026-04-10T00:00:00.000Z",
      }),
    );

    const result = await runRecordArbitraryDeployment({
      cwd: tempDir,
      env: { ZAI_API_BASE_URL: "https://api.example.com" },
      taskId: "task-2",
      projectId: "project-1",
      now: "2026-04-16T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(saved.createTime).toBe("2026-04-10T00:00:00.000Z");
  });

  it("fails when taskId is missing", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    const missingTask = await runRecordArbitraryDeployment({
      cwd: tempDir,
    });
    expect(missingTask.success).toBe(false);
    expect(missingTask.message).toContain("taskId");
  });

  it("succeeds without an envType input (envType no longer required)", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    const result = await runRecordArbitraryDeployment({
      cwd: tempDir,
      env: { ZAI_API_BASE_URL: "https://api.example.com" },
      taskId: "task-1",
      now: "2026-04-16T12:00:00.000Z",
    });

    expect(result.success).toBe(true);
    expect(result.taskId).toBe("task-1");
  });
});
