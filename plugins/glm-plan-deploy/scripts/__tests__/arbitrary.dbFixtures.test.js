import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { runArbitraryAnalyze } from "../arbitrary/analyze.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, "../../tests");

const fixtureCases = [
  {
    name: "nodejs-prisma-mysql",
    migrationPath: "prisma/migrations/20260526000100_init/migration.sql",
    requiredFiles: ["package-lock.json"],
    detectedConfig: {
      language: "Node.js",
      runtimeKind: "process",
      buildCommand: "npm ci --omit=dev",
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
  },
  {
    name: "python-flask-postgres",
    migrationPath: "migrations/001_init.sql",
    requiredFiles: [],
    detectedConfig: {
      language: "Python",
      buildCommand: "pip install --no-cache-dir -r requirements.txt",
      output: "Source files",
      startCommand: "python app.py",
      database: {
        detected: true,
        type: "postgresql",
        requiredEnv: ["DATABASE_URL"],
        orm: "sqlalchemy",
        migrationCommand: null,
      },
    },
  },
  {
    name: "java-spring-mysql",
    migrationPath: "src/main/resources/db/migration/V1__init.sql",
    requiredFiles: [],
    detectedConfig: {
      language: "Java",
      version: "17",
      buildCommand: "mvn clean package -DskipTests",
      output: "target/*.jar",
      startCommand: "java -jar app.jar",
      database: {
        detected: true,
        type: "mysql",
        requiredEnv: ["DATABASE_URL"],
        orm: "spring-data-jpa",
        migrationCommand: null,
      },
    },
  },
];

describe("deploy-arbitrary database fixtures", () => {
  for (const fixture of fixtureCases) {
    it(`analyzes ${fixture.name} as a real database-backed project`, async () => {
      const fixtureDir = path.join(fixturesRoot, fixture.name);
      expect(fs.existsSync(fixtureDir)).toBe(true);
      expect(fs.existsSync(path.join(fixtureDir, fixture.migrationPath))).toBe(
        true,
      );
      for (const requiredFile of fixture.requiredFiles) {
        expect(fs.existsSync(path.join(fixtureDir, requiredFile))).toBe(true);
      }

      const result = await runArbitraryAnalyze({ cwd: fixtureDir });

      expect(result.success).toBe(true);
      expect(result.needsUserInput).toBe(false);
      expect(result.detectedConfig).toMatchObject(fixture.detectedConfig);
    });
  }
});
