"use strict";

const { exec } = require("child_process");

const { formatArbitraryBuildValidationResult } = require("../common/format");

// Cargo emits these strings when `--locked` is enforced against a Cargo.lock
// that no longer resolves (e.g. a pinned transitive dep was yanked or never
// published). Regenerating the lockfile via `cargo update` recovers the build
// without touching the user's Cargo.toml.
const CARGO_LOCKFILE_RECOVERABLE_STDERR =
  /failed to select a version for the requirement|needs to be updated but --(locked|frozen) was passed/;

// Interpreted languages need the local interpreter to match the project's
// declared runtime, since the build command runs against it directly.
// Compiled languages aren't included: the local toolchain typically rebuilds
// fine across minor versions and the remote container will use the pinned
// version regardless.
const INTERPRETER_PROBES = {
  ruby: {
    binary: "ruby",
    parse: (out) => out.match(/ruby\s+(\d+(?:\.\d+){0,2})/i)?.[1],
  },
  python: {
    binary: "python3",
    parse: (out) => out.match(/python\s+(\d+(?:\.\d+){0,2})/i)?.[1],
  },
  "node.js": {
    binary: "node",
    parse: (out) => out.match(/v?(\d+(?:\.\d+){0,2})/)?.[1],
  },
  nodejs: {
    binary: "node",
    parse: (out) => out.match(/v?(\d+(?:\.\d+){0,2})/)?.[1],
  },
  node: {
    binary: "node",
    parse: (out) => out.match(/v?(\d+(?:\.\d+){0,2})/)?.[1],
  },
  php: {
    binary: "php",
    parse: (out) => out.match(/php\s+(\d+(?:\.\d+){0,2})/i)?.[1],
  },
};

async function runArbitraryValidateBuild(options = {}) {
  try {
    const cwd = options.cwd || process.cwd();
    const buildCommand = resolveBuildCommand(options.buildCommand);
    const execImpl = options.execImpl || defaultExec;

    const skip = await maybeSkipForInterpreterMismatch({
      detectedLanguage: options.detectedLanguage,
      detectedVersion: options.detectedVersion,
      execImpl,
      cwd,
    });
    if (skip) {
      const skipped = {
        success: true,
        buildSucceeded: true,
        needsFix: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        buildCommand,
        cwd,
        skipped: true,
        skipReason: skip,
      };
      skipped.summary = formatArbitraryBuildValidationResult(skipped);
      return skipped;
    }

    let execution = await execImpl(buildCommand, { cwd });
    let recovery = null;

    if (
      execution.code !== 0 &&
      isCargoLockedBuild(buildCommand) &&
      CARGO_LOCKFILE_RECOVERABLE_STDERR.test(execution.stderr || "")
    ) {
      recovery = await attemptCargoLockfileRecovery({
        buildCommand,
        cwd,
        execImpl,
      });
      if (recovery.retried) {
        // The lockfile has now been mutated; the retried build is the
        // authoritative outcome regardless of whether it passed or failed.
        execution = recovery.retryExecution;
      }
    }

    const result = {
      success: true,
      buildSucceeded: execution.code === 0,
      needsFix: execution.code !== 0,
      exitCode: Number.isInteger(execution.code) ? execution.code : 1,
      stdout: execution.stdout || "",
      stderr: execution.stderr || "",
      buildCommand,
      cwd,
    };
    if (recovery) result.recovery = sanitizeRecovery(recovery);
    result.summary = formatArbitraryBuildValidationResult(result);
    return result;
  } catch (error) {
    return failure(error.message);
  }
}

async function maybeSkipForInterpreterMismatch({
  detectedLanguage,
  detectedVersion,
  execImpl,
  cwd,
}) {
  if (typeof detectedLanguage !== "string" || !detectedLanguage.trim()) {
    return null;
  }
  const probe = INTERPRETER_PROBES[detectedLanguage.trim().toLowerCase()];
  if (!probe) return null;

  const probeResult = await execImpl(`${probe.binary} --version`, { cwd });
  if (probeResult.code !== 0) {
    return `Local validation skipped: ${probe.binary} is not available locally (the remote build will use the project's declared ${detectedLanguage} runtime).`;
  }

  const localVersion = probe.parse(
    `${probeResult.stdout || ""}\n${probeResult.stderr || ""}`,
  );
  if (!localVersion) {
    return `Local validation skipped: could not parse local ${probe.binary} version (the remote build will use the project's declared ${detectedLanguage} runtime).`;
  }

  if (typeof detectedVersion !== "string" || !detectedVersion.trim()) {
    return null;
  }
  const detectedMajor = detectedVersion.trim().split(".")[0];
  const localMajor = localVersion.split(".")[0];
  if (detectedMajor && localMajor && detectedMajor !== localMajor) {
    return `Local validation skipped: detected ${detectedLanguage} ${detectedVersion} but local ${probe.binary} reports ${localVersion}; the remote build will use the declared runtime.`;
  }
  return null;
}

function isCargoLockedBuild(buildCommand) {
  return (
    /(^|\s)cargo\s+build\b/.test(buildCommand) &&
    /(^|\s)--locked(\s|$)/.test(buildCommand)
  );
}

async function attemptCargoLockfileRecovery({ buildCommand, cwd, execImpl }) {
  const updateCommand = "cargo update";
  const updateExecution = await execImpl(updateCommand, { cwd });
  const recovery = {
    attempted: true,
    command: updateCommand,
    exitCode: Number.isInteger(updateExecution.code) ? updateExecution.code : 1,
    stdout: updateExecution.stdout || "",
    stderr: updateExecution.stderr || "",
    retried: false,
    succeeded: false,
    reason:
      "cargo --locked build failed with an unsatisfiable Cargo.lock; ran `cargo update` to regenerate it.",
  };

  if (updateExecution.code !== 0) return recovery;

  const retryExecution = await execImpl(buildCommand, { cwd });
  recovery.retried = true;
  recovery.retryExitCode = Number.isInteger(retryExecution.code)
    ? retryExecution.code
    : 1;
  recovery.retryExecution = retryExecution;
  recovery.succeeded = retryExecution.code === 0;
  return recovery;
}

function sanitizeRecovery(recovery) {
  // Drop the raw retryExecution payload; callers only need the summary fields.
  const { retryExecution: _retryExecution, ...rest } = recovery;
  return rest;
}

function resolveBuildCommand(buildCommand) {
  if (typeof buildCommand !== "string" || !buildCommand.trim()) {
    throw new Error("Missing required build validation input: `buildCommand`.");
  }

  return buildCommand.trim();
}

function defaultExec(command, options = {}) {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: options.cwd,
        shell: true,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          code:
            error && Number.isInteger(error.code) ? error.code : error ? 1 : 0,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      },
    );
  });
}

function failure(message) {
  return {
    success: false,
    message,
    summary: message,
  };
}

module.exports = {
  runArbitraryValidateBuild,
};
