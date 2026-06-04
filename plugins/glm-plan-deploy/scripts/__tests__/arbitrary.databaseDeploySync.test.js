import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runDeployDatabaseSync } from "../arbitrary/databaseDeploySync.js";
import { computeDatabaseMigrationFingerprint } from "../arbitrary/databaseFingerprint.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-db-deploy-sync-"));
}

function writePrismaProject(tempDir) {
  fs.mkdirSync(path.join(tempDir, "prisma/migrations/001_init"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(tempDir, "prisma/schema.prisma"),
    [
      "datasource db {",
      '  provider = "mysql"',
      '  url      = env("DATABASE_URL")',
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(tempDir, "prisma/migrations/001_init/migration.sql"),
    "CREATE TABLE users (id int primary key);\n",
  );
}

function writeSettings(tempDir, database = {}) {
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
        ...database,
      },
    }),
  );
}

function database() {
  return {
    detected: true,
    mode: "managed",
    type: "mysql",
    orm: "prisma",
    migrationCommand: "npx prisma migrate deploy",
    bindingId: "dbbind-1",
  };
}

function migrationResult(overrides = {}) {
  return {
    framework: "prisma",
    connected: true,
    migrationTableExists: true,
    appliedMigrations: ["001_init"],
    pendingMigrations: [],
    drift: false,
    summary: "status ok",
    ...overrides,
  };
}

describe("arbitrary/databaseDeploySync", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("auto mode skips remote status when migration fingerprint is unchanged", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    const fingerprint = computeDatabaseMigrationFingerprint({ cwd: tempDir });
    writeSettings(tempDir, { migrationFingerprint: fingerprint.hash });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      databaseStatusImpl: async () => {
        throw new Error("should not check remote DB when unchanged");
      },
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe("skipped");
    expect(result.reason).toContain("No project-side");
    expect(result.migrationFingerprint).toBe(fingerprint.hash);
    expect(result.recordMigrationFingerprint).toBe(true);
  });

  it("auto mode checks remote status when checked-in migrations changed and blocks pending migrations", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, { migrationFingerprint: "old" });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      projectId: "project-1",
      databaseStatusImpl: async (options) => {
        expect(options.bindingId).toBe("dbbind-1");
        expect(options.projectId).toBe("project-1");
        return {
          success: true,
          needsUserInput: false,
          stage: "completed",
          migrationResult: migrationResult({
            pendingMigrations: ["002_add_email"],
          }),
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("DATABASE_MIGRATIONS_PENDING");
    expect(result.summary).toContain("--databaseSync apply");
  });

  it("check mode forces a remote status check even when fingerprint is unchanged", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    const fingerprint = computeDatabaseMigrationFingerprint({ cwd: tempDir });
    writeSettings(tempDir, { migrationFingerprint: fingerprint.hash });
    let checked = false;

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      databaseSync: "check",
      databaseStatusImpl: async () => {
        checked = true;
        return {
          success: true,
          needsUserInput: false,
          stage: "completed",
          migrationResult: migrationResult(),
        };
      },
    });

    expect(checked).toBe(true);
    expect(result.success).toBe(true);
    expect(result.action).toBe("checked");
    expect(result.recordMigrationFingerprint).toBe(true);
  });

  it("requires explicit deploy-time confirmation before applying migrations", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, { migrationFingerprint: "old" });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      databaseSync: "apply",
      databaseSyncApplyImpl: async () => {
        throw new Error("should not apply without confirmation");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("DATABASE_SYNC_CONFIRM_REQUIRED");
  });

  it("reserves a project for deploy-time DB sync when no projectId exists yet", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      databaseStatusImpl: async (options) => {
        expect(options.projectId).toBeNull();
        expect(options.reserveProject).toBe(true);
        return {
          success: true,
          needsUserInput: false,
          stage: "completed",
          projectId: "reserved-project",
          migrationResult: migrationResult(),
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.action).toBe("checked");
    expect(result.projectId).toBe("reserved-project");
  });

  it("returns the reserved project when first-deploy DB sync blocks on pending migrations", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      databaseStatusImpl: async (options) => {
        expect(options.reserveProject).toBe(true);
        return {
          success: true,
          needsUserInput: false,
          stage: "completed",
          projectId: "reserved-project",
          migrationResult: migrationResult({
            pendingMigrations: ["002_add_email"],
          }),
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("DATABASE_MIGRATIONS_PENDING");
    expect(result.projectId).toBe("reserved-project");
  });

  it("applies migrations through the database sync helper when confirmed", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, { migrationFingerprint: "old" });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      databaseSync: "apply",
      databaseSyncConfirm: true,
      databaseSyncApplyImpl: async (options) => {
        expect(options.confirm).toBe(true);
        return {
          success: true,
          needsUserInput: false,
          stage: "completed",
          migrationResult: migrationResult({
            appliedMigrations: ["001_init", "002_add_email"],
          }),
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe("applied");
    expect(result.recordMigrationFingerprint).toBe(true);
  });

  it("blocks deploy on remote drift instead of applying or continuing", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, { migrationFingerprint: "old" });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      databaseStatusImpl: async () => ({
        success: true,
        needsUserInput: false,
        stage: "completed",
        migrationResult: migrationResult({
          drift: true,
          summary: "remote column exists only in DB",
        }),
      }),
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("DATABASE_DRIFT_DETECTED");
    expect(result.summary).toContain("drift");
  });

  it("requires migration config when explicit sync is requested", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, {
      migrationFingerprint: "old",
      framework: null,
      migrationCommand: null,
    });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: {
        detected: true,
        mode: "managed",
        type: "mysql",
        bindingId: "dbbind-1",
      },
      databaseSync: "check",
      databaseStatusImpl: async () => {
        throw new Error("should not check without migration config");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("DATABASE_MIGRATION_COMMAND_REQUIRED");
    expect(result.summary).toContain("--databaseMigrationCommand");
  });

  it("requires migration config when auto mode sees changed migration files", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, {
      migrationFingerprint: "old",
      framework: null,
      migrationCommand: null,
    });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: {
        detected: true,
        mode: "managed",
        type: "mysql",
        bindingId: "dbbind-1",
      },
      databaseStatusImpl: async () => {
        throw new Error("should not check without migration config");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("DATABASE_MIGRATION_COMMAND_REQUIRED");
  });

  it("does not reuse a stored managed binding for the current external database", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, { migrationFingerprint: "old" });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: {
        detected: true,
        mode: "external",
        type: "mysql",
        orm: "prisma",
        migrationCommand: "npx prisma migrate deploy",
      },
      databaseStatusImpl: async () => {
        throw new Error("should not check stale stored binding");
      },
      computeFingerprintImpl: () => {
        throw new Error("should not fingerprint external DB auto skip");
      },
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe("skipped");
    expect(result.reason).toContain("external");
  });

  it("requires an explicit binding when external database sync is explicitly requested", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, { migrationFingerprint: "old" });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: {
        detected: true,
        mode: "external",
        type: "mysql",
        orm: "prisma",
        migrationCommand: "npx prisma migrate deploy",
      },
      databaseSync: "check",
      databaseStatusImpl: async () => {
        throw new Error("should not check without an explicit binding");
      },
      computeFingerprintImpl: () => {
        throw new Error("should not fingerprint external DB binding prompt");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("DATABASE_BINDING_REQUIRED");
    expect(result.summary).toContain("--databaseBindingId");
  });

  it("returns structured failure when migration fingerprinting fails for a managed sync", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, { migrationFingerprint: "old" });

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: database(),
      computeFingerprintImpl: () => {
        throw new Error("EACCES: permission denied, scandir 'private-build'");
      },
      databaseStatusImpl: async () => {
        throw new Error("should not check after fingerprint failure");
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("database");
    expect(result.reasonCode).toBe("DATABASE_MIGRATION_FINGERPRINT_FAILED");
    expect(result.summary).toContain("EACCES");
    expect(result.summary).toContain("--databaseSync skip");
  });

  it("allows explicit binding override for an external database sync check", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    writePrismaProject(tempDir);
    writeSettings(tempDir, { migrationFingerprint: "old" });
    let checkedBindingId = null;

    const result = await runDeployDatabaseSync({
      cwd: tempDir,
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      database: {
        detected: true,
        mode: "external",
        type: "mysql",
        orm: "prisma",
        migrationCommand: "npx prisma migrate deploy",
      },
      databaseSync: "check",
      databaseBindingId: "dbbind-manual",
      databaseStatusImpl: async (options) => {
        checkedBindingId = options.bindingId;
        return {
          success: true,
          needsUserInput: false,
          stage: "completed",
          migrationResult: migrationResult(),
        };
      },
    });

    expect(checkedBindingId).toBe("dbbind-manual");
    expect(result.success).toBe(true);
    expect(result.action).toBe("checked");
  });

  it.each([
    ["missing result object", undefined],
    ["missing framework", migrationResult({ framework: null })],
    ["missing connected marker", migrationResult({ connected: false })],
    [
      "missing migration table marker",
      migrationResult({ migrationTableExists: undefined }),
    ],
    [
      "missing applied migrations",
      migrationResult({ appliedMigrations: null }),
    ],
    ["missing drift field", migrationResult({ drift: undefined })],
    ["missing summary", migrationResult({ summary: undefined })],
  ])(
    "fails closed when migration status is invalid: %s",
    async (_, migrationResult) => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      writePrismaProject(tempDir);
      writeSettings(tempDir, { migrationFingerprint: "old" });

      const result = await runDeployDatabaseSync({
        cwd: tempDir,
        env: {
          ZAI_API_TOKEN: "token",
          ZAI_API_BASE_URL: "https://api.example.com",
        },
        database: database(),
        databaseStatusImpl: async () => ({
          success: true,
          needsUserInput: false,
          stage: "completed",
          ...(migrationResult === undefined ? {} : { migrationResult }),
        }),
      });

      expect(result.success).toBe(false);
      expect(result.reasonCode).toBe("DATABASE_MIGRATION_STATUS_INVALID");
      expect(result.summary).toContain("incomplete");
    },
  );
});
