import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  computeDatabaseMigrationFingerprint,
  isDatabaseMigrationFile,
} from "../arbitrary/databaseFingerprint.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-db-fingerprint-"));
}

describe("arbitrary/databaseFingerprint", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("fingerprints checked-in Prisma schema and migration files", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.mkdirSync(path.join(tempDir, "prisma/migrations/001_init"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, "prisma/schema.prisma"),
      'datasource db { provider = "mysql" url = env("DATABASE_URL") }\n',
    );
    fs.writeFileSync(
      path.join(tempDir, "prisma/migrations/001_init/migration.sql"),
      "CREATE TABLE users (id int primary key);\n",
    );
    fs.mkdirSync(path.join(tempDir, "node_modules/prisma/migrations/noise"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, "node_modules/prisma/migrations/noise/migration.sql"),
      "DROP TABLE ignored;\n",
    );

    const first = computeDatabaseMigrationFingerprint({ cwd: tempDir });
    fs.writeFileSync(
      path.join(tempDir, "prisma/migrations/001_init/migration.sql"),
      "CREATE TABLE users (id int primary key, email varchar(255));\n",
    );
    const second = computeDatabaseMigrationFingerprint({ cwd: tempDir });

    expect(first.files).toEqual([
      "prisma/migrations/001_init/migration.sql",
      "prisma/schema.prisma",
    ]);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.hash).not.toBe(first.hash);
  });

  it("recognizes common framework migration paths", () => {
    expect(
      isDatabaseMigrationFile("db/migrate/20260101000000_add_user.rb"),
    ).toBe(true);
    expect(
      isDatabaseMigrationFile("db/migrations/001_init/migration.sql"),
    ).toBe(true);
    expect(isDatabaseMigrationFile("db/migrations/create_users.sql")).toBe(
      true,
    );
    expect(isDatabaseMigrationFile("migrations/create_orders.sql")).toBe(true);
    expect(
      isDatabaseMigrationFile(
        "packages/api/prisma/migrations/001_init/migration.sql",
      ),
    ).toBe(true);
    expect(
      isDatabaseMigrationFile("src/main/resources/db/migration/V1__init.sql"),
    ).toBe(true);
    expect(
      isDatabaseMigrationFile("migrations/versions/a1b2c3_add_user.py"),
    ).toBe(true);
    expect(isDatabaseMigrationFile("app/users/migrations/0002_email.py")).toBe(
      true,
    );
    expect(isDatabaseMigrationFile("app/users/migrations/helper.py")).toBe(
      false,
    );
    expect(isDatabaseMigrationFile("migrations/readme.md")).toBe(false);
    expect(isDatabaseMigrationFile("migrations/notes.json")).toBe(false);
    expect(isDatabaseMigrationFile("app/users/migrations/__init__.py")).toBe(
      false,
    );
  });

  it("fingerprints custom Prisma schema and sibling db migrations", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.mkdirSync(path.join(tempDir, "packages/api/db/migrations/001_init"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, "packages/api/db/schema.prisma"),
      'datasource db { provider = "mysql" url = env("DATABASE_URL") }\n',
    );
    fs.writeFileSync(
      path.join(tempDir, "packages/api/db/migrations/001_init/migration.sql"),
      "CREATE TABLE teams (id int primary key);\n",
    );

    const fingerprint = computeDatabaseMigrationFingerprint({ cwd: tempDir });

    expect(fingerprint.files).toEqual([
      "packages/api/db/migrations/001_init/migration.sql",
      "packages/api/db/schema.prisma",
    ]);
    expect(fingerprint.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprints symlinked Prisma schema and migration directory inside the service root", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.mkdirSync(path.join(tempDir, "shared/generated-migrations/001_init"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, "shared/database.prisma"),
      'datasource db { provider = "mysql" url = env("DATABASE_URL") }\n',
    );
    fs.writeFileSync(
      path.join(tempDir, "shared/generated-migrations/001_init/migration.sql"),
      "CREATE TABLE shared_users (id int primary key);\n",
    );
    fs.mkdirSync(path.join(tempDir, "prisma"), { recursive: true });
    fs.symlinkSync(
      path.join(tempDir, "shared/database.prisma"),
      path.join(tempDir, "prisma/schema.prisma"),
    );
    fs.symlinkSync(
      path.join(tempDir, "shared/generated-migrations"),
      path.join(tempDir, "prisma/migrations"),
      "dir",
    );

    const fingerprint = computeDatabaseMigrationFingerprint({ cwd: tempDir });

    expect(fingerprint.files).toEqual([
      "prisma/migrations/001_init/migration.sql",
      "prisma/schema.prisma",
    ]);
    expect(fingerprint.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not follow symlinked migration directories outside the service root", () => {
    const tempDir = makeTempDir();
    const outsideDir = makeTempDir();
    tempDirs.push(tempDir, outsideDir);
    fs.mkdirSync(path.join(outsideDir, "migrations/001_init"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(outsideDir, "migrations/001_init/migration.sql"),
      "CREATE TABLE outside_users (id int primary key);\n",
    );
    fs.mkdirSync(path.join(tempDir, "prisma"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "prisma/schema.prisma"),
      'datasource db { provider = "mysql" url = env("DATABASE_URL") }\n',
    );
    fs.symlinkSync(
      path.join(outsideDir, "migrations"),
      path.join(tempDir, "prisma/migrations"),
      "dir",
    );

    const fingerprint = computeDatabaseMigrationFingerprint({ cwd: tempDir });

    expect(fingerprint.files).toEqual(["prisma/schema.prisma"]);
  });

  it("fingerprints a symlinked migration directory even when its target was traversed first", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.mkdirSync(path.join(tempDir, "aaa-target/001_init"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, "aaa-target/001_init/migration.sql"),
      "CREATE TABLE ordered_users (id int primary key);\n",
    );
    fs.mkdirSync(path.join(tempDir, "zzz/prisma"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "zzz/prisma/schema.prisma"),
      'datasource db { provider = "mysql" url = env("DATABASE_URL") }\n',
    );
    fs.symlinkSync(
      path.join(tempDir, "aaa-target"),
      path.join(tempDir, "zzz/prisma/migrations"),
      "dir",
    );

    const fingerprint = computeDatabaseMigrationFingerprint({ cwd: tempDir });

    expect(fingerprint.files).toEqual([
      "zzz/prisma/migrations/001_init/migration.sql",
      "zzz/prisma/schema.prisma",
    ]);
  });

  it("does not double-count the same migration file through a sibling symlink", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    fs.mkdirSync(path.join(tempDir, "prisma/migrations/001_init"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, "prisma/schema.prisma"),
      'datasource db { provider = "mysql" url = env("DATABASE_URL") }\n',
    );
    fs.writeFileSync(
      path.join(tempDir, "prisma/migrations/001_init/migration.sql"),
      "CREATE TABLE deduped_users (id int primary key);\n",
    );
    fs.mkdirSync(path.join(tempDir, "copy/prisma"), { recursive: true });
    fs.symlinkSync(
      path.join(tempDir, "prisma/migrations"),
      path.join(tempDir, "copy/prisma/migrations"),
      "dir",
    );

    const fingerprint = computeDatabaseMigrationFingerprint({ cwd: tempDir });
    const migrationFiles = fingerprint.files.filter((file) =>
      file.endsWith("001_init/migration.sql"),
    );

    expect(migrationFiles).toHaveLength(1);
    expect(fingerprint.files).toContain("prisma/schema.prisma");
  });
});
