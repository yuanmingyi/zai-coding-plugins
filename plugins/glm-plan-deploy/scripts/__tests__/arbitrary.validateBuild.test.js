import { describe, expect, it } from "vitest";

import { runArbitraryValidateBuild } from "../arbitrary/validateBuild.js";

describe("arbitrary/validateBuild", () => {
  it("returns structured success for a passing build command", async () => {
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/project",
      buildCommand: "npm ci && npm run build",
      execImpl: async (command, options) => {
        expect(command).toBe("npm ci && npm run build");
        expect(options.cwd).toBe("/tmp/project");
        return {
          code: 0,
          stdout: "done",
          stderr: "",
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.buildSucceeded).toBe(true);
    expect(result.needsFix).toBe(false);
    expect(result.stdout).toBe("done");
  });

  it("returns needsFix for a failing build command", async () => {
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/project",
      buildCommand: "pip install -r requirements.txt",
      execImpl: async () => ({
        code: 1,
        stdout: "",
        stderr: "No matching distribution found",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.buildSucceeded).toBe(false);
    expect(result.needsFix).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No matching distribution found");
  });

  it("fails when buildCommand is missing", async () => {
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/project",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("buildCommand");
  });

  it("auto-recovers from a cargo --locked unsatisfiable-lockfile failure", async () => {
    const calls = [];
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/rust-actix",
      buildCommand: "cargo build --release --locked",
      execImpl: async (command, options) => {
        calls.push({ command, cwd: options.cwd });
        if (calls.length === 1) {
          return {
            code: 101,
            stdout: "",
            stderr:
              'error: failed to select a version for the requirement `rand = "^0.10.1"`',
          };
        }
        if (calls.length === 2) {
          expect(command).toBe("cargo update");
          return { code: 0, stdout: "Updating crates.io index", stderr: "" };
        }
        return { code: 0, stdout: "Finished release", stderr: "" };
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].command).toBe("cargo build --release --locked");
    expect(calls[1].command).toBe("cargo update");
    expect(calls[2].command).toBe("cargo build --release --locked");
    expect(calls.every((c) => c.cwd === "/tmp/rust-actix")).toBe(true);

    expect(result.success).toBe(true);
    expect(result.buildSucceeded).toBe(true);
    expect(result.needsFix).toBe(false);
    expect(result.recovery).toBeDefined();
    expect(result.recovery.attempted).toBe(true);
    expect(result.recovery.command).toBe("cargo update");
    expect(result.recovery.retried).toBe(true);
    expect(result.recovery.succeeded).toBe(true);
    expect(result.summary).toContain("cargo update");
  });

  it("does not attempt recovery when --locked is absent", async () => {
    let invocations = 0;
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/rust",
      buildCommand: "cargo build --release",
      execImpl: async () => {
        invocations += 1;
        return {
          code: 101,
          stdout: "",
          stderr:
            'error: failed to select a version for the requirement `rand = "^0.10.1"`',
        };
      },
    });

    expect(invocations).toBe(1);
    expect(result.buildSucceeded).toBe(false);
    expect(result.recovery).toBeUndefined();
  });

  it("does not attempt recovery when stderr does not match the lockfile pattern", async () => {
    let invocations = 0;
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/rust",
      buildCommand: "cargo build --release --locked",
      execImpl: async () => {
        invocations += 1;
        return {
          code: 101,
          stdout: "",
          stderr: "error[E0432]: unresolved import `foo::bar`",
        };
      },
    });

    expect(invocations).toBe(1);
    expect(result.buildSucceeded).toBe(false);
    expect(result.recovery).toBeUndefined();
  });

  it("surfaces recovery info when cargo update itself fails", async () => {
    const calls = [];
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/rust",
      buildCommand: "cargo build --release --locked",
      execImpl: async (command) => {
        calls.push(command);
        if (calls.length === 1) {
          return {
            code: 101,
            stdout: "",
            stderr:
              "error: the lock file /tmp/Cargo.lock needs to be updated but --locked was passed",
          };
        }
        return { code: 1, stdout: "", stderr: "network unreachable" };
      },
    });

    expect(calls).toEqual(["cargo build --release --locked", "cargo update"]);
    expect(result.buildSucceeded).toBe(false);
    expect(result.exitCode).toBe(101);
    expect(result.recovery).toBeDefined();
    expect(result.recovery.attempted).toBe(true);
    expect(result.recovery.retried).toBe(false);
    expect(result.recovery.succeeded).toBe(false);
    expect(result.recovery.exitCode).toBe(1);
    expect(result.recovery.stderr).toContain("network unreachable");
  });

  it("skips local validation when the system Ruby major differs from the detected version", async () => {
    let buildInvocations = 0;
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/ruby-sinatra",
      buildCommand: "bundle install --deployment --without development test",
      detectedLanguage: "Ruby",
      detectedVersion: "3.2",
      execImpl: async (command) => {
        if (/^ruby --version$/.test(command)) {
          return {
            code: 0,
            stdout:
              "ruby 2.6.10p210 (2022-04-12 revision 67958) [universal.arm64e-darwin25]",
            stderr: "",
          };
        }
        buildInvocations += 1;
        return {
          code: 5,
          stdout: "",
          stderr: "rack-protection requires Ruby version >= 2.7.8",
        };
      },
    });

    expect(buildInvocations).toBe(0);
    expect(result.success).toBe(true);
    expect(result.buildSucceeded).toBe(true);
    expect(result.needsFix).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/Ruby/);
    expect(result.skipReason).toMatch(/2\.6/);
    expect(result.skipReason).toMatch(/3\.2/);
  });

  it("skips local validation for Node when the local major differs from the detected version", async () => {
    let buildInvocations = 0;
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/node-app",
      buildCommand: "npm ci",
      detectedLanguage: "Node.js",
      detectedVersion: "20",
      execImpl: async (command) => {
        if (/^node --version$/.test(command)) {
          return { code: 0, stdout: "v18.17.0", stderr: "" };
        }
        buildInvocations += 1;
        return { code: 1, stdout: "", stderr: "engines.node mismatch" };
      },
    });

    expect(buildInvocations).toBe(0);
    expect(result.skipped).toBe(true);
    expect(result.buildSucceeded).toBe(true);
  });

  it("skips local validation when the interpreter binary is missing", async () => {
    let buildInvocations = 0;
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/python-app",
      buildCommand: "pip install -r requirements.txt",
      detectedLanguage: "Python",
      detectedVersion: "3.11",
      execImpl: async (command) => {
        if (/^python3 --version$/.test(command)) {
          return {
            code: 127,
            stdout: "",
            stderr: "python3: command not found",
          };
        }
        buildInvocations += 1;
        return { code: 0, stdout: "ok", stderr: "" };
      },
    });

    expect(buildInvocations).toBe(0);
    expect(result.skipped).toBe(true);
    expect(result.buildSucceeded).toBe(true);
    expect(result.skipReason).toMatch(/python3/i);
  });

  it("runs validation when the local interpreter major matches the detected version", async () => {
    const calls = [];
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/python-app",
      buildCommand: "pip install -r requirements.txt",
      detectedLanguage: "Python",
      detectedVersion: "3.11",
      execImpl: async (command) => {
        calls.push(command);
        if (/^python3 --version$/.test(command)) {
          return { code: 0, stdout: "Python 3.11.4", stderr: "" };
        }
        return { code: 0, stdout: "ok", stderr: "" };
      },
    });

    expect(calls).toEqual([
      "python3 --version",
      "pip install -r requirements.txt",
    ]);
    expect(result.skipped).toBeUndefined();
    expect(result.buildSucceeded).toBe(true);
  });

  it("does not check the interpreter for compiled languages", async () => {
    const calls = [];
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/go-app",
      buildCommand: "go build -o server .",
      detectedLanguage: "Go",
      detectedVersion: "1.21",
      execImpl: async (command) => {
        calls.push(command);
        return { code: 0, stdout: "ok", stderr: "" };
      },
    });

    expect(calls).toEqual(["go build -o server ."]);
    expect(result.skipped).toBeUndefined();
    expect(result.buildSucceeded).toBe(true);
  });

  it("skips local validation when detectedLanguage is set but detectedVersion is unknown and interpreter is missing", async () => {
    let buildInvocations = 0;
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/ruby-app",
      buildCommand: "bundle install",
      detectedLanguage: "Ruby",
      detectedVersion: null,
      execImpl: async (command) => {
        if (/^ruby --version$/.test(command)) {
          return { code: 127, stdout: "", stderr: "ruby: not found" };
        }
        buildInvocations += 1;
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(buildInvocations).toBe(0);
    expect(result.skipped).toBe(true);
  });

  it("runs validation when detectedLanguage is missing (legacy callers stay on the existing happy path)", async () => {
    const calls = [];
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/anything",
      buildCommand: "echo build",
      execImpl: async (command) => {
        calls.push(command);
        return { code: 0, stdout: "build", stderr: "" };
      },
    });

    expect(calls).toEqual(["echo build"]);
    expect(result.skipped).toBeUndefined();
    expect(result.buildSucceeded).toBe(true);
  });

  it("surfaces recovery info when retried build still fails", async () => {
    const calls = [];
    const result = await runArbitraryValidateBuild({
      cwd: "/tmp/rust",
      buildCommand: "cargo build --release --locked",
      execImpl: async (command) => {
        calls.push(command);
        if (calls.length === 1) {
          return {
            code: 101,
            stdout: "",
            stderr:
              'error: failed to select a version for the requirement `rand = "^0.10.1"`',
          };
        }
        if (calls.length === 2) {
          return { code: 0, stdout: "", stderr: "" };
        }
        return {
          code: 101,
          stdout: "",
          stderr: "error[E0432]: unresolved import",
        };
      },
    });

    expect(calls).toHaveLength(3);
    expect(result.buildSucceeded).toBe(false);
    expect(result.exitCode).toBe(101);
    expect(result.stderr).toContain("unresolved import");
    expect(result.recovery).toBeDefined();
    expect(result.recovery.retried).toBe(true);
    expect(result.recovery.succeeded).toBe(false);
    expect(result.recovery.retryExitCode).toBe(101);
  });
});
