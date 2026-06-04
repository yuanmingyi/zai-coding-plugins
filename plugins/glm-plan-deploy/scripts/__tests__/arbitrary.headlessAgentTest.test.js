import fs from "fs";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  buildAgentPrompt,
  classifyDeployOutcome,
  collectSessionTimings,
  detectProjectStack,
  evaluateHeadlessAgentLog,
  evaluateProjectFit,
  evaluateStageCoverage,
  extractDeployAttempts,
  extractDeployTaskResult,
  extractSessionIdFromStdoutLine,
  extractTerminalStructuredResult,
  findTerminalFinalReportLine,
  getClaudeProjectLogDir,
  isServerLimitFailure,
  languagesMatch,
  readJsonlWithSubagents,
  resolveHeadlessLogPath,
  runHeadlessAgentTest,
} from "../runDeployArbitraryAgentHeadlessTest.js";

function assistantBash(line, command) {
  return {
    __line: line,
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Bash",
          input: { command },
        },
      ],
    },
  };
}

function assistantTool(line, name, input) {
  return {
    __line: line,
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name,
          input,
        },
      ],
    },
  };
}

function assistantText(line, text) {
  return {
    __line: line,
    type: "assistant",
    message: {
      content: [{ type: "text", text }],
    },
  };
}

function userToolResult(line, content) {
  return {
    __line: line,
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          content,
        },
      ],
    },
  };
}

function successfulLogLines(projectDir, repoRoot) {
  return (
    [
      assistantBash(
        1,
        `node "${repoRoot}/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "${projectDir}"`,
      ),
      userToolResult(
        2,
        JSON.stringify({
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          verificationStatus: 200,
          usedDiagnosticRequest: false,
          finalReport:
            "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
        }),
      ),
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n"
  );
}

function writeFakeClaude({
  tmpDir,
  projectDir,
  claudeProjectsDir,
  logLines,
  logName = "headless-test.jsonl",
  exitCode = 0,
  hang = false,
}) {
  const fakeClaude = path.join(
    tmpDir,
    `fake-claude-${exitCode}${hang ? "-hang" : ""}.js`,
  );
  fs.writeFileSync(
    fakeClaude,
    [
      "const fs = require('fs');",
      "const path = require('path');",
      "const promptIndex = process.argv.indexOf('-p');",
      "const prompt = promptIndex === -1 ? '' : process.argv[promptIndex + 1];",
      "if (!prompt.includes('/glm-plan-deploy:deploy-arbitrary --run-test')) process.exit(11);",
      "if (!prompt.includes(" +
        JSON.stringify(projectDir) +
        ")) process.exit(12);",
      "if (process.env.CLAUDE_PROJECTS_DIR !== " +
        JSON.stringify(claudeProjectsDir) +
        ") process.exit(13);",
      "const logDir = path.join(process.env.CLAUDE_PROJECTS_DIR, " +
        JSON.stringify(projectDir.replace(/\//g, "-")) +
        ");",
      "fs.mkdirSync(logDir, { recursive: true });",
      "fs.writeFileSync(path.join(logDir, " +
        JSON.stringify(logName) +
        "), " +
        JSON.stringify(logLines) +
        ");",
      hang ? "setInterval(() => {}, 1000);" : `process.exit(${exitCode});`,
    ].join("\n"),
  );
  return fakeClaude;
}

describe("runDeployArbitraryAgentHeadlessTest", () => {
  it("builds a headless prompt with the requested absolute project path", () => {
    const prompt = buildAgentPrompt("/tmp/demo-app");

    expect(prompt).toContain("/glm-plan-deploy:deploy-arbitrary");
    expect(prompt).toContain("Deploy the project located at: /tmp/demo-app");
    expect(prompt).toContain("absolute path");
  });

  it("does not inject SESSION_STARTED_AT_MS or --agentStartedAtMs guidance", () => {
    const prompt = buildAgentPrompt("/tmp/demo-app", "/repo");
    expect(prompt).not.toContain("SESSION_STARTED_AT_MS");
    expect(prompt).not.toContain("--agentStartedAtMs");
  });

  it("maps an absolute project path to the Claude Code project log directory", () => {
    expect(
      getClaudeProjectLogDir("/Users/me/work/app", "/tmp/claude-projects"),
    ).toBe("/tmp/claude-projects/-Users-me-work-app");
  });

  it("extracts a successful deploy task result from a Claude JSONL transcript", () => {
    const entries = [
      assistantBash(
        1,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
      ),
      userToolResult(
        2,
        JSON.stringify({
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          finalReport:
            "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
        }),
      ),
      assistantText(
        3,
        "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
      ),
    ];

    expect(extractDeployTaskResult(entries)).toMatchObject({
      status: "success",
      accessUrl: "https://demo.example.com",
      line: 2,
    });
  });

  it("extracts a failed deploy task result from a terminal finalReport", () => {
    const entries = [
      userToolResult(
        1,
        `Exit code 1\n${JSON.stringify({
          success: false,
          stage: "preflight",
          message: "Project capacity exceeded",
          finalReport: "Deployment Failed\nProject capacity exceeded",
        })}`,
      ),
    ];

    expect(extractDeployTaskResult(entries)).toMatchObject({
      status: "failure",
      stage: "preflight",
      reason: "Project capacity exceeded",
      line: 1,
    });
  });

  it("passes only when the task succeeds and process adherence is at least 90", () => {
    const entries = [
      assistantBash(
        1,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
      ),
      userToolResult(
        2,
        JSON.stringify({
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          verificationStatus: 200,
          usedDiagnosticRequest: false,
          finalReport:
            "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
        }),
      ),
      assistantText(
        3,
        "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
      ),
    ];

    const report = evaluateHeadlessAgentLog({
      logPath: "synthetic.jsonl",
      entries,
      projectDir: "/app",
      minScore: 90,
    });

    expect(report.passed).toBe(true);
    expect(report.task.status).toBe("success");
    expect(report.process.score).toBe(100);
    expect(report.process.actionSummary).toEqual({
      total: 1,
      unexpected: 0,
      compliant: 1,
    });
    expect(report.process.unexpectedAttempts).toEqual([]);
  });

  it("runs Claude headless mode, finds the generated JSONL log, and evaluates it", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "deploy-headless-agent-"),
    );
    const projectDir = path.join(tmpDir, "app");
    const repoRoot = path.join(tmpDir, "repo");
    const claudeProjectsDir = path.join(tmpDir, "claude-projects");
    const logDir = getClaudeProjectLogDir(projectDir, claudeProjectsDir);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const fakeClaude = writeFakeClaude({
      tmpDir,
      projectDir,
      claudeProjectsDir,
      logLines: successfulLogLines(projectDir, repoRoot),
    });

    const report = await runHeadlessAgentTest({
      projectDir,
      repoRoot,
      sessionCwd: projectDir,
      claudeProjectsDir,
      claudeCli: `"${process.execPath}" "${fakeClaude}"`,
      timeoutMs: 5000,
      minScore: 90,
      json: true,
    });

    expect(report.logPath).toBe(path.join(logDir, "headless-test.jsonl"));
    expect(report.claude).toMatchObject({ code: 0 });
    expect(report.claudeStatus).toMatchObject({ ok: true, status: "ok" });
    expect(report.passed).toBe(true);
    expect(report.process.score).toBe(100);
    expect(report.claude.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(report.claude.startedAtMs).toBeGreaterThan(0);
    expect(report.claude.finishedAtMs).toBeGreaterThanOrEqual(
      report.claude.startedAtMs,
    );
  });

  it("evaluates subagent JSONL files referenced by a parent Claude Code log", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "deploy-headless-agent-"),
    );
    const projectDir = path.join(tmpDir, "app");
    const repoRoot = path.join(tmpDir, "repo");
    const sessionId = "session-with-subagent";
    const parentLog = path.join(tmpDir, `${sessionId}.jsonl`);
    const subagentsDir = path.join(tmpDir, sessionId, "subagents");
    const subagentLog = path.join(subagentsDir, "agent-a123.jsonl");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(subagentsDir, { recursive: true });

    fs.writeFileSync(
      parentLog,
      [
        JSON.stringify({
          ...assistantText(1, "Invoking deploy subagent."),
          timestamp: "2026-04-22T00:00:00.000Z",
        }),
        JSON.stringify({
          ...assistantText(
            2,
            "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
          ),
          timestamp: "2026-04-22T00:00:03.000Z",
        }),
      ].join("\n") + "\n",
    );
    fs.writeFileSync(
      subagentLog,
      [
        JSON.stringify({
          ...assistantBash(
            1,
            `node "${repoRoot}/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "${projectDir}"`,
          ),
          timestamp: "2026-04-22T00:00:01.000Z",
        }),
        JSON.stringify({
          ...userToolResult(
            2,
            JSON.stringify({
              success: true,
              stage: "completed",
              accessUrl: "https://demo.example.com",
              verificationStatus: 200,
              usedDiagnosticRequest: false,
              finalReport:
                "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
            }),
          ),
          timestamp: "2026-04-22T00:00:02.000Z",
        }),
      ].join("\n") + "\n",
    );

    const entries = readJsonlWithSubagents(parentLog);
    expect(entries.map((entry) => entry.__source)).toContain(subagentLog);

    const report = await runHeadlessAgentTest({
      projectDir,
      repoRoot,
      logFile: parentLog,
      minScore: 90,
    });

    expect(report.task.status).toBe("success");
    expect(report.process.score).toBe(100);
    expect(report.passed).toBe(true);
  });

  it("scores terminal helper failures as valid process evidence", () => {
    const entries = [
      assistantBash(
        1,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
      ),
      userToolResult(
        2,
        `Exit code 1\n${JSON.stringify({
          success: false,
          stage: "preflight",
          message: "Project capacity exceeded",
          finalReport: "Deployment Failed\nProject capacity exceeded",
        })}`,
      ),
    ];

    const report = evaluateHeadlessAgentLog({
      logPath: "synthetic.jsonl",
      entries,
      projectDir: "/app",
      minScore: 90,
    });

    expect(report.task).toMatchObject({
      status: "failure",
      stage: "preflight",
      reason: "Project capacity exceeded",
    });
    expect(report.process.score).toBe(100);
    expect(report.outcome).toMatchObject({
      category: "server_limit_failure",
      stage: "preflight",
    });
    expect(report.passed).toBe(true);
  });

  it("fails the headless result when Claude writes a passing log but exits non-zero", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "deploy-headless-agent-"),
    );
    const projectDir = path.join(tmpDir, "app");
    const repoRoot = path.join(tmpDir, "repo");
    const claudeProjectsDir = path.join(tmpDir, "claude-projects");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(repoRoot, { recursive: true });

    const fakeClaude = writeFakeClaude({
      tmpDir,
      projectDir,
      claudeProjectsDir,
      logLines: successfulLogLines(projectDir, repoRoot),
      exitCode: 42,
    });

    const report = await runHeadlessAgentTest({
      projectDir,
      repoRoot,
      sessionCwd: projectDir,
      claudeProjectsDir,
      claudeCli: `"${process.execPath}" "${fakeClaude}"`,
      timeoutMs: 5000,
      minScore: 90,
      json: true,
    });

    expect(report.task.status).toBe("success");
    expect(report.process.score).toBe(100);
    expect(report.claudeStatus).toMatchObject({
      ok: false,
      status: "non-zero-exit",
    });
    expect(report.passed).toBe(false);
  });

  it("fails the headless result when Claude writes a passing log but times out", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "deploy-headless-agent-"),
    );
    const projectDir = path.join(tmpDir, "app");
    const repoRoot = path.join(tmpDir, "repo");
    const claudeProjectsDir = path.join(tmpDir, "claude-projects");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(repoRoot, { recursive: true });

    const fakeClaude = writeFakeClaude({
      tmpDir,
      projectDir,
      claudeProjectsDir,
      logLines: successfulLogLines(projectDir, repoRoot),
      hang: true,
    });

    const report = await runHeadlessAgentTest({
      projectDir,
      repoRoot,
      sessionCwd: projectDir,
      claudeProjectsDir,
      claudeCli: `"${process.execPath}" "${fakeClaude}"`,
      timeoutMs: 1000,
      minScore: 90,
      json: true,
    });

    expect(report.task.status).toBe("success");
    expect(report.process.score).toBe(100);
    expect(report.claudeStatus).toMatchObject({
      ok: false,
      status: "timed-out",
    });
    expect(report.passed).toBe(false);
  });

  it("fails below 90 when the process uses unexpected split helpers and searches", () => {
    const entries = [
      assistantBash(
        1,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" prepare-local-arbitrary --json --cwd "/app"',
      ),
      assistantBash(
        2,
        'find . -name "*.md" -exec grep -l deploy-arbitrary {} \\;',
      ),
      assistantBash(
        3,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" remote-deploy-arbitrary --json --cwd "/app"',
      ),
      assistantBash(
        4,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" classify-failure-arbitrary --json --detailLog "failed"',
      ),
      assistantBash(
        5,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" format-deploy-arbitrary-report --json --outcome failed',
      ),
      assistantBash(
        6,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" record-arbitrary-deployment --json --taskId task-1',
      ),
      userToolResult(
        7,
        JSON.stringify({
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          verificationStatus: 200,
          usedDiagnosticRequest: false,
          finalReport:
            "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
        }),
      ),
    ];

    const report = evaluateHeadlessAgentLog({
      logPath: "synthetic.jsonl",
      entries,
      projectDir: "/app",
      minScore: 90,
    });

    expect(report.task.status).toBe("success");
    expect(report.process.score).toBeLessThan(90);
    expect(report.process.actionScore).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.process.unexpectedAttempts.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["split-helper", "search"]),
    );
    expect(
      report.process.unexpectedAttempts
        .filter((item) => item.kind === "split-helper")
        .map((item) => item.command),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("classify-failure-arbitrary"),
        expect.stringContaining("format-deploy-arbitrary-report"),
        expect.stringContaining("record-arbitrary-deployment"),
      ]),
    );
  });

  it("fails when a deployment transcript patches plugin source or runs repo tests", () => {
    const entries = [
      assistantBash(
        1,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
      ),
      userToolResult(
        2,
        JSON.stringify({
          success: false,
          stage: "pollTask",
          message: "Generated Dockerfile has invalid image tag",
          finalReport:
            "Deployment Failed\nGenerated Dockerfile has invalid image tag",
        }),
      ),
      assistantBash(
        3,
        'node -e "require(\\"fs\\").writeFileSync(\\"/repo/plugins/glm-plan-deploy/scripts/arbitrary/renderDockerfiles.js\\", \\"patched\\")"',
      ),
      assistantBash(
        4,
        "cd /repo/plugins/glm-plan-deploy/scripts && npm run test:deploy",
      ),
    ];

    const report = evaluateHeadlessAgentLog({
      logPath: "synthetic.jsonl",
      entries,
      projectDir: "/app",
      minScore: 90,
    });

    expect(report.passed).toBe(false);
    expect(report.process.score).toBeLessThan(90);
    expect(report.process.unexpectedAttempts.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "plugin-source-edit",
        "repo-test-command",
        "post-terminal-tool",
      ]),
    );
    expect(
      report.process.checks.find(
        (check) => check.id === "no_plugin_source_edits",
      ),
    ).toMatchObject({
      status: "fail",
    });
    expect(
      report.process.checks.find(
        (check) => check.id === "no_repo_test_commands",
      ),
    ).toMatchObject({
      status: "fail",
    });
  });

  it("detects relative plugin edits and optioned repo test command variants", () => {
    const entries = [
      assistantBash(
        1,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
      ),
      userToolResult(
        2,
        JSON.stringify({
          success: false,
          stage: "pollTask",
          message: "Generated Dockerfile has invalid image tag",
          finalReport:
            "Deployment Failed\nGenerated Dockerfile has invalid image tag",
        }),
      ),
      assistantTool(3, "Edit", {
        file_path: "plugins/glm-plan-deploy/agents/deploy-arbitrary.md",
        old_string: "old",
        new_string: "new",
      }),
      assistantBash(
        4,
        "printf '%s\\n' patched > plugins/glm-plan-deploy/scripts/arbitrary/renderDockerfiles.js",
      ),
      assistantBash(
        5,
        "cp /tmp/renderDockerfiles.js ./plugins/glm-plan-deploy/scripts/arbitrary/renderDockerfiles.js",
      ),
      assistantBash(
        6,
        "perl -pi -e 's/old/new/g' plugins/glm-plan-deploy/agents/deploy-arbitrary.md",
      ),
      assistantBash(
        7,
        "printf patched | tee plugins/glm-plan-deploy/scripts/arbitrary/renderDockerfiles.js >/dev/null",
      ),
      assistantBash(
        8,
        "npm --prefix /repo/plugins/glm-plan-deploy/scripts run test:deploy",
      ),
      assistantBash(9, "npm -C /repo/plugins/glm-plan-deploy/scripts test"),
      assistantBash(10, "npm exec vitest"),
      assistantBash(11, "node node_modules/vitest/vitest.mjs run"),
    ];

    const report = evaluateHeadlessAgentLog({
      logPath: "synthetic.jsonl",
      entries,
      projectDir: "/app",
      minScore: 90,
    });
    const pluginEditCheck = report.process.checks.find(
      (check) => check.id === "no_plugin_source_edits",
    );
    const repoTestCheck = report.process.checks.find(
      (check) => check.id === "no_repo_test_commands",
    );

    expect(report.passed).toBe(false);
    expect(pluginEditCheck).toMatchObject({ status: "fail" });
    expect(pluginEditCheck.evidence).toHaveLength(5);
    expect(repoTestCheck).toMatchObject({ status: "fail" });
    expect(repoTestCheck.evidence).toHaveLength(4);
    expect(report.process.unexpectedAttempts.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["plugin-source-edit", "repo-test-command"]),
    );
  });

  describe("findTerminalFinalReportLine", () => {
    it("returns the line of the LAST terminal report, not the first", () => {
      const texts = [
        {
          line: 10,
          text: JSON.stringify({
            success: true,
            stage: "completed",
            finalReport: "Deployment Completed Successfully",
          }),
        },
        { line: 20, text: "some intermediate chatter" },
        {
          line: 30,
          text: JSON.stringify({
            success: false,
            stage: "pollTask",
            finalReport: "Deployment Failed\nupstream 503",
          }),
        },
      ];
      expect(findTerminalFinalReportLine(texts)).toBe(30);
    });
  });

  describe("extractTerminalStructuredResult", () => {
    it("returns the last structured helper result with a success field", () => {
      const texts = [
        {
          line: 1,
          text: JSON.stringify({ success: true, stage: "completed" }),
        },
        { line: 2, text: "noise" },
        {
          line: 3,
          text: JSON.stringify({
            success: false,
            stage: "pollTask",
            finalReport: "Deployment Failed",
          }),
        },
      ];
      expect(extractTerminalStructuredResult(texts)).toMatchObject({
        line: 3,
        result: { success: false, stage: "pollTask" },
      });
    });
  });

  describe("detectProjectStack", () => {
    it("detects Node.js from package.json", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-node-"));
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      expect(detectProjectStack(tmpDir)).toEqual({
        language: "Node.js",
        indicator: "package.json",
      });
    });

    it("detects Go from go.mod", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-go-"));
      fs.writeFileSync(path.join(tmpDir, "go.mod"), "module foo\n");
      expect(detectProjectStack(tmpDir)).toEqual({
        language: "Go",
        indicator: "go.mod",
      });
    });

    it("returns null language when no signature file is present", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-empty-"));
      expect(detectProjectStack(tmpDir)).toEqual({
        language: null,
        indicator: null,
      });
    });
  });

  describe("languagesMatch", () => {
    it("matches Node.js to Node", () => {
      expect(languagesMatch("Node.js", "Node")).toBe(true);
    });
    it("rejects Node vs Python", () => {
      expect(languagesMatch("Node.js", "Python")).toBe(false);
    });
  });

  describe("evaluateProjectFit", () => {
    it("passes when detected stack matches reported language", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-node-"));
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      const fit = evaluateProjectFit({
        projectDir: tmpDir,
        terminalResult: {
          line: 1,
          result: { success: true, detectedConfig: { language: "Node.js" } },
        },
        task: { status: "success" },
      });
      expect(fit).toMatchObject({
        status: "pass",
        expected: "Node.js",
        actual: "Node.js",
      });
    });

    it("fails when detected stack does not match reported language", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-mismatch-"));
      fs.writeFileSync(path.join(tmpDir, "go.mod"), "module foo\n");
      const fit = evaluateProjectFit({
        projectDir: tmpDir,
        terminalResult: {
          line: 1,
          result: {
            success: true,
            detectedConfig: { language: "Python" },
          },
        },
        task: { status: "success" },
      });
      expect(fit).toMatchObject({
        status: "fail",
        expected: "Go",
        actual: "Python",
      });
    });

    it("infers the stack from uploadedFiles when detectedConfig is missing", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-fallback-"));
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      const fit = evaluateProjectFit({
        projectDir: tmpDir,
        terminalResult: {
          line: 1,
          result: {
            success: false,
            stage: "pollTask",
            uploadedFiles: ["server.js", "package.json", "package-lock.json"],
          },
        },
        task: { status: "failure", stage: "pollTask" },
      });
      expect(fit).toMatchObject({
        status: "pass",
        expected: "Node.js",
        actual: "Node.js",
      });
    });

    it("returns n/a when failure happens before analyze", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-early-"));
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      const fit = evaluateProjectFit({
        projectDir: tmpDir,
        terminalResult: {
          line: 1,
          result: { success: false, stage: "preflight" },
        },
        task: { status: "failure", stage: "preflight" },
      });
      expect(fit.status).toBe("n/a");
    });
  });

  describe("evaluateStageCoverage", () => {
    it("passes when a successful result has the terminal pollTask+verifyAccessUrl pair", () => {
      const cov = evaluateStageCoverage({
        terminalResult: {
          line: 1,
          result: {
            success: true,
            stage: "completed",
            accessUrl: "https://demo.example.com",
            verificationStatus: 200,
          },
        },
      });
      expect(cov.status).toBe("pass");
    });

    it("fails when success lacks pollTask+verifyAccessUrl evidence", () => {
      const cov = evaluateStageCoverage({
        terminalResult: {
          line: 1,
          result: { success: true, stage: "completed" },
        },
      });
      expect(cov.status).toBe("fail");
    });

    it("passes for a failure result that reports a stage", () => {
      const cov = evaluateStageCoverage({
        terminalResult: {
          line: 1,
          result: { success: false, stage: "pollTask" },
        },
      });
      expect(cov.status).toBe("pass");
      expect(cov.stoppedAt).toBe("pollTask");
    });
  });

  describe("isServerLimitFailure / classifyDeployOutcome", () => {
    it("classifies capacity/quota/rate-limit keywords as server-limit", () => {
      expect(
        isServerLimitFailure("preflight", "Project capacity exceeded"),
      ).toBe(true);
      expect(
        isServerLimitFailure("pollTask", "HTTP 429 Too Many Requests"),
      ).toBe(true);
      expect(isServerLimitFailure("pollTask", "upstream returned 503")).toBe(
        true,
      );
    });

    it("classifies plain build errors as not server-limit", () => {
      expect(
        isServerLimitFailure("validateBuild", "npm ERR! missing script: build"),
      ).toBe(false);
    });

    it("classifies fetch failed with UND_ERR_CONNECT_TIMEOUT causeCode as server-limit", () => {
      const terminalResult = {
        line: 1,
        result: {
          success: false,
          stage: "pollTask",
          classification: { category: "REMOTE_HELPER_TERMINAL_FAILURE" },
          apiRecord: {
            causeCode: "UND_ERR_CONNECT_TIMEOUT",
            errorMessage: "fetch failed",
          },
        },
      };
      expect(
        isServerLimitFailure("pollTask", "fetch failed", terminalResult),
      ).toBe(true);
    });

    it("classifies ECONNREFUSED via apiRecords as server-limit", () => {
      const terminalResult = {
        line: 1,
        result: {
          success: false,
          stage: "controllerDeploy",
          apiRecords: [{ causeCode: "ECONNREFUSED" }],
        },
      };
      expect(
        isServerLimitFailure(
          "controllerDeploy",
          "fetch failed",
          terminalResult,
        ),
      ).toBe(true);
    });

    it("classifyDeployOutcome uses terminalResult via processResult for server-limit classification", () => {
      const terminalResult = {
        line: 1,
        result: {
          success: false,
          stage: "pollTask",
          classification: { category: "REMOTE_HELPER_TERMINAL_FAILURE" },
          apiRecord: { causeCode: "UND_ERR_CONNECT_TIMEOUT" },
        },
      };
      const outcome = classifyDeployOutcome({
        task: { status: "failure", stage: "pollTask", reason: "fetch failed" },
        processResult: { unexpectedAttempts: [], terminalResult },
      });
      expect(outcome.category).toBe("server_limit_failure");
    });

    it("classifyDeployOutcome returns success for successful tasks without violations", () => {
      const outcome = classifyDeployOutcome({
        task: { status: "success", stage: "completed" },
        processResult: { unexpectedAttempts: [] },
      });
      expect(outcome).toMatchObject({ category: "success" });
    });

    it("classifyDeployOutcome marks violations as agent_caused_failure even on success", () => {
      const outcome = classifyDeployOutcome({
        task: { status: "success", stage: "completed" },
        processResult: {
          unexpectedAttempts: [{ kind: "plugin-source-edit", line: 5 }],
        },
      });
      expect(outcome.category).toBe("agent_caused_failure");
    });

    it("classifyDeployOutcome marks server keywords as server_limit_failure", () => {
      const outcome = classifyDeployOutcome({
        task: { status: "failure", stage: "pollTask", reason: "upstream 503" },
        processResult: { unexpectedAttempts: [] },
      });
      expect(outcome.category).toBe("server_limit_failure");
    });

    it("classifyDeployOutcome returns unknown for other failures", () => {
      const outcome = classifyDeployOutcome({
        task: {
          status: "failure",
          stage: "validateBuild",
          reason: "npm ERR! missing script: build",
        },
        processResult: { unexpectedAttempts: [] },
      });
      expect(outcome.category).toBe("unknown");
    });
  });

  describe("extractSessionIdFromStdoutLine", () => {
    it("extracts session_id from a stream-json init line", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc-123",
        cwd: "/tmp/app",
      });
      expect(extractSessionIdFromStdoutLine(line)).toBe("abc-123");
    });

    it("returns null for lines without session_id", () => {
      expect(extractSessionIdFromStdoutLine("plain text")).toBeNull();
      expect(extractSessionIdFromStdoutLine("{broken json")).toBeNull();
      expect(
        extractSessionIdFromStdoutLine(JSON.stringify({ type: "system" })),
      ).toBeNull();
    });
  });

  describe("resolveHeadlessLogPath", () => {
    it("prefers the session-id-named jsonl when it exists", () => {
      const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-session-"));
      const sessionId = "sess-xyz";
      const decoy = path.join(logDir, "other.jsonl");
      const expected = path.join(logDir, `${sessionId}.jsonl`);
      fs.writeFileSync(decoy, "{}\n");
      fs.writeFileSync(expected, "{}\n");
      const resolved = resolveHeadlessLogPath({
        logDir,
        sessionId,
        startedAtMs: 0,
        beforeFiles: [],
      });
      expect(resolved).toBe(expected);
    });

    it("falls back to the newest jsonl when the session file is missing", () => {
      const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-fallback-"));
      const older = path.join(logDir, "old.jsonl");
      const newer = path.join(logDir, "new.jsonl");
      fs.writeFileSync(older, "{}\n");
      fs.writeFileSync(newer, "{}\n");
      fs.utimesSync(
        older,
        new Date(Date.now() - 10000),
        new Date(Date.now() - 10000),
      );
      const resolved = resolveHeadlessLogPath({
        logDir,
        sessionId: "missing-session",
        startedAtMs: Date.now() - 5000,
        beforeFiles: [],
      });
      expect(resolved).toBe(newer);
    });
  });

  describe("runHeadlessAgentTest flag forwarding", () => {
    function writeArgsRecorderFakeClaude({
      tmpDir,
      projectDir,
      claudeProjectsDir,
      logLines,
    }) {
      const fakeClaude = path.join(tmpDir, "fake-claude-args.js");
      const argsPath = path.join(tmpDir, "recorded-args.json");
      fs.writeFileSync(
        fakeClaude,
        [
          "const fs = require('fs');",
          "const path = require('path');",
          "fs.writeFileSync(" +
            JSON.stringify(argsPath) +
            ", JSON.stringify(process.argv.slice(2)));",
          "const logDir = path.join(process.env.CLAUDE_PROJECTS_DIR, " +
            JSON.stringify(projectDir.replace(/\//g, "-")) +
            ");",
          "fs.mkdirSync(logDir, { recursive: true });",
          "fs.writeFileSync(path.join(logDir, 'args-fake.jsonl'), " +
            JSON.stringify(logLines) +
            ");",
          // Emit one stream-json-style line with session_id so capture still works.
          "process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'args-fake' }) + '\\n');",
          "process.exit(0);",
        ].join("\n"),
      );
      return { fakeClaude, argsPath };
    }

    it("forwards --settings-file and --model to the Claude CLI", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "args-"));
      const projectDir = path.join(tmpDir, "app");
      const repoRoot = path.join(tmpDir, "repo");
      const claudeProjectsDir = path.join(tmpDir, "claude-projects");
      const settingsFile = path.join(tmpDir, "settings.json");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(repoRoot, { recursive: true });
      fs.writeFileSync(settingsFile, "{}");

      const { fakeClaude, argsPath } = writeArgsRecorderFakeClaude({
        tmpDir,
        projectDir,
        claudeProjectsDir,
        logLines:
          [
            JSON.stringify({
              __line: 1,
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    name: "Bash",
                    input: {
                      command: `node "${repoRoot}/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "${projectDir}"`,
                    },
                  },
                ],
              },
            }),
            JSON.stringify({
              __line: 2,
              type: "user",
              message: {
                content: [
                  {
                    type: "tool_result",
                    content: JSON.stringify({
                      success: true,
                      stage: "completed",
                      accessUrl: "https://demo.example.com",
                      verificationStatus: 200,
                      finalReport:
                        "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
                    }),
                  },
                ],
              },
            }),
          ].join("\n") + "\n",
      });

      await runHeadlessAgentTest({
        projectDir,
        repoRoot,
        sessionCwd: projectDir,
        claudeProjectsDir,
        claudeCli: `"${process.execPath}" "${fakeClaude}"`,
        settingsFile,
        model: "claude-opus-4-7",
        timeoutMs: 5000,
        minScore: 90,
        json: true,
      });

      const recorded = JSON.parse(fs.readFileSync(argsPath, "utf8"));
      expect(recorded).toEqual(
        expect.arrayContaining([
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode=bypassPermissions",
          "--settings",
          path.resolve(settingsFile),
          "--model",
          "claude-opus-4-7",
        ]),
      );
    });

    it("captures session_id from stream-json stdout and uses the session-named jsonl", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-"));
      const projectDir = path.join(tmpDir, "app");
      const repoRoot = path.join(tmpDir, "repo");
      const claudeProjectsDir = path.join(tmpDir, "claude-projects");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(repoRoot, { recursive: true });

      const logDir = getClaudeProjectLogDir(projectDir, claudeProjectsDir);
      fs.mkdirSync(logDir, { recursive: true });
      const decoy = path.join(logDir, "decoy.jsonl");
      fs.writeFileSync(decoy, "{}\n");

      const sessionId = "real-session-42";
      const logLines =
        [
          JSON.stringify({
            __line: 1,
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  name: "Bash",
                  input: {
                    command: `node "${repoRoot}/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "${projectDir}"`,
                  },
                },
              ],
            },
          }),
          JSON.stringify({
            __line: 2,
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  content: JSON.stringify({
                    success: true,
                    stage: "completed",
                    accessUrl: "https://demo.example.com",
                    verificationStatus: 200,
                    finalReport:
                      "Deployment Completed Successfully\nAccess URL : https://demo.example.com",
                  }),
                },
              ],
            },
          }),
        ].join("\n") + "\n";

      const fakeClaude = path.join(tmpDir, "fake-claude-session.js");
      fs.writeFileSync(
        fakeClaude,
        [
          "const fs = require('fs');",
          "const path = require('path');",
          `const logDir = ${JSON.stringify(logDir)};`,
          "fs.mkdirSync(logDir, { recursive: true });",
          `fs.writeFileSync(path.join(logDir, ${JSON.stringify(
            sessionId + ".jsonl",
          )}), ${JSON.stringify(logLines)});`,
          `process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: ${JSON.stringify(
            sessionId,
          )} }) + '\\n');`,
          "setTimeout(() => process.exit(0), 10);",
        ].join("\n"),
      );

      const report = await runHeadlessAgentTest({
        projectDir,
        repoRoot,
        sessionCwd: projectDir,
        claudeProjectsDir,
        claudeCli: `"${process.execPath}" "${fakeClaude}"`,
        timeoutMs: 5000,
        minScore: 90,
        json: true,
      });

      expect(report.sessionId).toBe(sessionId);
      expect(report.logPath).toBe(path.join(logDir, `${sessionId}.jsonl`));
      expect(report.task.status).toBe("success");
    });
  });

  describe("collectSessionTimings / extractDeployAttempts", () => {
    function timedTool({ line, tsIso, toolUseId, toolName, command }) {
      return {
        __line: line,
        type: "assistant",
        timestamp: tsIso,
        message: {
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: toolName,
              input: { command },
            },
          ],
        },
      };
    }
    function timedResult({ line, tsIso, toolUseId, content, isError = false }) {
      return {
        __line: line,
        type: "user",
        timestamp: tsIso,
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              is_error: isError,
              content,
            },
          ],
        },
      };
    }

    it("aggregates per-tool durations and computes LLM reasoning as log-span minus tool total", () => {
      const entries = [
        {
          __line: 1,
          type: "user",
          timestamp: "2026-04-22T00:00:00.000Z",
          message: { content: [] },
        },
        timedTool({
          line: 2,
          tsIso: "2026-04-22T00:00:10.000Z",
          toolUseId: "a1",
          toolName: "Read",
          command: undefined,
        }),
        timedResult({
          line: 3,
          tsIso: "2026-04-22T00:00:11.500Z",
          toolUseId: "a1",
          content: "ok",
        }),
        timedTool({
          line: 4,
          tsIso: "2026-04-22T00:00:20.000Z",
          toolUseId: "b1",
          toolName: "Bash",
          command: "echo hi",
        }),
        timedResult({
          line: 5,
          tsIso: "2026-04-22T00:00:22.500Z",
          toolUseId: "b1",
          content: "hi",
        }),
        {
          __line: 6,
          type: "assistant",
          timestamp: "2026-04-22T00:00:30.000Z",
          message: { content: [] },
        },
      ];
      const session = collectSessionTimings(entries);
      expect(session.totalMs).toBe(30_000);
      expect(session.tools.totalCalls).toBe(2);
      expect(session.tools.totalDurationMs).toBe(1_500 + 2_500);
      expect(session.tools.byName.Read).toEqual({
        calls: 1,
        durationMs: 1_500,
      });
      expect(session.tools.byName.Bash).toEqual({
        calls: 1,
        durationMs: 2_500,
      });
      expect(session.llmReasoningMs).toBe(30_000 - 4_000);
    });

    it("extracts deploy-arbitrary attempts with stage/success/reason from tool results", () => {
      const entries = [
        timedTool({
          line: 1,
          tsIso: "2026-04-22T00:00:00.000Z",
          toolUseId: "t1",
          toolName: "Bash",
          command:
            'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
        }),
        timedResult({
          line: 2,
          tsIso: "2026-04-22T00:01:12.000Z",
          toolUseId: "t1",
          isError: true,
          content: `Exit code 1\n${JSON.stringify({
            success: false,
            stage: "pollTask",
            message: "fetch failed",
            elapsedSeconds: 72,
            classification: { retryable: true, category: "NETWORK" },
          })}`,
        }),
        timedTool({
          line: 3,
          tsIso: "2026-04-22T00:02:00.000Z",
          toolUseId: "t2",
          toolName: "Bash",
          command:
            'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
        }),
        timedResult({
          line: 4,
          tsIso: "2026-04-22T00:03:45.000Z",
          toolUseId: "t2",
          content: JSON.stringify({
            success: true,
            stage: "completed",
            accessUrl: "https://demo.example.com",
            elapsedSeconds: 105,
          }),
        }),
      ];
      const session = collectSessionTimings(entries);
      expect(session.attempts.length).toBe(2);
      expect(session.attempts[0]).toMatchObject({
        stage: "pollTask",
        success: false,
        elapsedSeconds: 72,
        reason: "fetch failed",
        retryable: true,
        classificationCategory: "NETWORK",
      });
      expect(session.attempts[0].durationMs).toBe(72_000);
      expect(session.attempts[1]).toMatchObject({
        stage: "completed",
        success: true,
        elapsedSeconds: 105,
      });
      expect(session.attempts[1].durationMs).toBe(105_000);
    });

    it("extractDeployAttempts ignores non-Bash or non-deploy tool calls", () => {
      const toolCalls = [
        {
          name: "Read",
          command: null,
          resultContent: null,
          startedAtMs: 0,
          finishedAtMs: 1000,
        },
        {
          name: "Bash",
          command: "ls",
          resultContent: "a",
          startedAtMs: 0,
          finishedAtMs: 500,
        },
        {
          name: "Bash",
          command: "node plugin-cli.js deploy-arbitrary --json --cwd /x",
          resultContent: JSON.stringify({ success: true, stage: "completed" }),
          startedAtMs: 0,
          finishedAtMs: 100,
          durationMs: 100,
        },
      ];
      const attempts = extractDeployAttempts(toolCalls);
      expect(attempts.length).toBe(1);
      expect(attempts[0].stage).toBe("completed");
    });
  });

  describe("evaluateHeadlessAgentLog outcome gating", () => {
    it("passes a server-limit failure when agent adherence is perfect", () => {
      const entries = [
        assistantBash(
          1,
          'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
        ),
        userToolResult(
          2,
          JSON.stringify({
            success: false,
            stage: "pollTask",
            message: "upstream 503 Service Unavailable",
            finalReport: "Deployment Failed\nupstream 503",
          }),
        ),
      ];
      const report = evaluateHeadlessAgentLog({
        logPath: "synthetic.jsonl",
        entries,
        projectDir: "/app",
        minScore: 90,
      });
      expect(report.outcome.category).toBe("server_limit_failure");
      expect(report.passed).toBe(true);
    });

    it("fails a success log when agent committed process violations", () => {
      const entries = [
        assistantBash(
          1,
          'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
        ),
        userToolResult(
          2,
          JSON.stringify({
            success: true,
            stage: "completed",
            accessUrl: "https://demo.example.com",
            verificationStatus: 200,
            finalReport: "Deployment Completed Successfully",
          }),
        ),
        assistantBash(3, "curl https://demo.example.com/debug"),
      ];
      const report = evaluateHeadlessAgentLog({
        logPath: "synthetic.jsonl",
        entries,
        projectDir: "/app",
        minScore: 90,
      });
      expect(report.outcome.category).toBe("agent_caused_failure");
      expect(report.passed).toBe(false);
    });
  });
});
