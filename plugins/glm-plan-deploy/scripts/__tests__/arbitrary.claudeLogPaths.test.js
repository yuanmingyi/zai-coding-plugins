import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectClaudeLogPaths,
  mangleCwd,
} from "../arbitrary/claudeLogPaths.js";

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-claude-logs-"));
}

function seedJsonl(dir, name, contents = "{}\n", mtimeMs = Date.now()) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, "utf8");
  fs.utimesSync(filePath, new Date(mtimeMs), new Date(mtimeMs));
  return filePath;
}

describe("arbitrary/claudeLogPaths", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("returns null when ZAI_DEPLOY_DEBUG is unset", () => {
    expect(collectClaudeLogPaths({ cwd: "/tmp/whatever", env: {} })).toBeNull();
  });

  it("returns null when ZAI_DEPLOY_DEBUG is anything other than '1'", () => {
    for (const value of ["", "0", "true", "yes", "TRUE"]) {
      expect(
        collectClaudeLogPaths({
          cwd: "/tmp/whatever",
          env: { ZAI_DEPLOY_DEBUG: value },
        }),
      ).toBeNull();
    }
  });

  it("returns the mangled project log dir even when no .jsonl files exist", () => {
    const tempHome = makeTempHome();
    tempDirs.push(tempHome);
    const cwd = "/Users/me/myapp";

    const result = collectClaudeLogPaths({
      cwd,
      env: { ZAI_DEPLOY_DEBUG: "1" },
      homeDir: tempHome,
    });

    expect(result).toEqual({
      projectLogDir: path.join(
        tempHome,
        ".claude",
        "projects",
        "-Users-me-myapp",
      ),
      jsonlFiles: [],
    });
  });

  it("lists .jsonl files sorted by mtime descending and caps at 5", () => {
    const tempHome = makeTempHome();
    tempDirs.push(tempHome);
    const cwd = "/Users/me/myapp";
    const projectLogDir = path.join(
      tempHome,
      ".claude",
      "projects",
      mangleCwd(cwd),
    );
    fs.mkdirSync(projectLogDir, { recursive: true });

    const base = 1_700_000_000_000;
    const expectedOrder = [];
    for (let i = 0; i < 7; i += 1) {
      const filePath = seedJsonl(
        projectLogDir,
        `session-${i}.jsonl`,
        "{}\n",
        base + i * 1000,
      );
      expectedOrder.unshift(filePath);
    }

    seedJsonl(projectLogDir, "ignored.txt", "noise", base + 99 * 1000);

    const result = collectClaudeLogPaths({
      cwd,
      env: { ZAI_DEPLOY_DEBUG: "1" },
      homeDir: tempHome,
    });

    expect(result).not.toBeNull();
    expect(result.projectLogDir).toBe(projectLogDir);
    expect(result.jsonlFiles).toEqual(expectedOrder.slice(0, 5));
    expect(result.jsonlFiles.every((p) => p.endsWith(".jsonl"))).toBe(true);
  });

  it("respects an explicit maxFiles override", () => {
    const tempHome = makeTempHome();
    tempDirs.push(tempHome);
    const cwd = "/Users/me/myapp";
    const projectLogDir = path.join(
      tempHome,
      ".claude",
      "projects",
      mangleCwd(cwd),
    );
    fs.mkdirSync(projectLogDir, { recursive: true });

    const base = 1_700_000_000_000;
    for (let i = 0; i < 4; i += 1) {
      seedJsonl(projectLogDir, `session-${i}.jsonl`, "{}\n", base + i * 1000);
    }

    const result = collectClaudeLogPaths({
      cwd,
      env: { ZAI_DEPLOY_DEBUG: "1" },
      homeDir: tempHome,
      maxFiles: 2,
    });

    expect(result.jsonlFiles).toHaveLength(2);
  });

  it("falls back to os.homedir when env.HOME is missing", () => {
    const result = collectClaudeLogPaths({
      cwd: "/tmp/whatever",
      env: { ZAI_DEPLOY_DEBUG: "1" },
    });
    expect(result).not.toBeNull();
    expect(result.projectLogDir).toContain(".claude/projects/-tmp-whatever");
  });
});
