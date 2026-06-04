import { describe, expect, it, vi } from "vitest";

import { runFormatArbitraryDeployReport } from "../arbitrary/formatDeployReport.js";

describe("arbitrary/formatDeployReport", () => {
  it("formats the success box-drawing report with 2-row time table", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://demo.example.com",
      projectId: "proj_abc123",
      taskId: "task_def456",
      localSeconds: 25,
      remoteSeconds: 157,
      totalSeconds: 182,
    });

    expect(result.success).toBe(true);
    expect(result.report)
      .toBe(`╔══════════════════════════════════════════════════════════════╗
║  [OK]   Deployment Completed Successfully                    ║
╚══════════════════════════════════════════════════════════════╝

  Access URL : https://demo.example.com
  Project ID : proj_abc123
  Task ID    : task_def456
  Cleanup    : Deployment artifacts removed

┌──────────────────────────────────────────────────────────────┐
│  Time Cost                                                   │
├──────────────────────────────┬───────────────────────────────┤
│  Local Prep                  │  25s                          │
│  Remote Deploy               │  2m 37s                       │
├──────────────────────────────┼───────────────────────────────┤
│  Total                       │  3m 2s                        │
└──────────────────────────────┴───────────────────────────────┘`);
  });

  it("surfaces restricted access URL verification in the success report", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://demo.example.com",
      projectId: "proj_abc123",
      taskId: "task_def456",
      localSeconds: 25,
      remoteSeconds: 157,
      totalSeconds: 182,
      expectedAccessDenied: true,
      verificationStatus: 403,
    });

    expect(result.success).toBe(true);
    expect(result.report).toContain(
      "Access    : Restricted; verification got expected HTTP 403",
    );
  });

  it("formats the failure box-drawing report with 2-row time table and stage mapping", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "failure",
      stage: "verifyAccessUrl",
      reason: "Access URL returned an unhealthy response.",
      action:
        "Inspect the verification body and retry only if the classifier says it is retryable.",
      projectId: "proj_abc123",
      taskId: "task_def456",
      localSeconds: 20,
      remoteSeconds: 105,
      totalSeconds: 125,
    });

    expect(result.success).toBe(true);
    expect(result.report)
      .toBe(`╔══════════════════════════════════════════════════════════════╗
║  [FAIL] Deployment Failed                                    ║
╚══════════════════════════════════════════════════════════════╝

  Failed at  : Remote Deploy
  Reason     : Access URL returned an unhealthy response.
  Action     : Inspect the verification body and retry only if the classifier says it is retryable.
  Project ID : proj_abc123
  Task ID    : task_def456

┌──────────────────────────────────────────────────────────────┐
│  Time Cost                                                   │
├──────────────────────────────┬───────────────────────────────┤
│  Local Prep                  │  20s                          │
│  Remote Deploy               │  1m 45s                       │
├──────────────────────────────┼───────────────────────────────┤
│  Total                       │  2m 5s                        │
└──────────────────────────────┴───────────────────────────────┘`);
  });

  it("renders missing localSeconds and remoteSeconds as em dashes", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "failure",
      stage: "validateBuild",
      reason: "Local build validation failed.",
      action:
        "Review stdout and stderr, fix the local build, then rerun preparation.",
      localSeconds: null,
      remoteSeconds: null,
      totalSeconds: 12,
    });

    expect(result.success).toBe(true);
    expect(result.report).toContain("Local Prep");
    expect(result.report).toContain("Remote Deploy");
    expect(result.report).toContain("│  Local Prep                  │  —");
    expect(result.report).toContain("│  Remote Deploy               │  —");
    expect(result.report).toContain("│  Total                       │  12s");
  });

  it("maps all local-prep stages correctly", async () => {
    const localPrepStages = [
      "preflight",
      "analyze",
      "validateBuild",
      "renderDockerfiles",
    ];

    for (const stage of localPrepStages) {
      const result = await runFormatArbitraryDeployReport({
        outcome: "failure",
        stage,
        reason: "reason",
        action: "action",
        localSeconds: 1,
        remoteSeconds: 2,
        totalSeconds: 3,
      });

      expect(result.success).toBe(true);
      expect(result.report).toContain("Failed at  : Local Prep");
    }
  });

  it("maps all remote-deploy stages correctly", async () => {
    const remoteDeployStages = [
      "packageProject",
      "controllerDeploy",
      "initUpload",
      "upload",
      "createTask",
      "recordDeployment",
      "pollTask",
      "verifyAccessUrl",
    ];

    for (const stage of remoteDeployStages) {
      const result = await runFormatArbitraryDeployReport({
        outcome: "failure",
        stage,
        reason: "reason",
        action: "action",
        localSeconds: 1,
        remoteSeconds: 2,
        totalSeconds: 3,
      });

      expect(result.success).toBe(true);
      expect(result.report).toContain("Failed at  : Remote Deploy");
    }
  });

  it("splits deployment status polling time out of Remote Deploy when pollSeconds is provided", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "failure",
      stage: "pollTask",
      reason:
        "CloudBase function update was rejected because the SCF function is still Creating.",
      action: "Wait and retry.",
      localSeconds: 3,
      remoteSeconds: 136,
      pollSeconds: 129,
      totalSeconds: 139,
    });

    expect(result.success).toBe(true);
    expect(result.report).toContain("│  Local Prep                  │  3s");
    expect(result.report).toContain("│  Remote Deploy               │  7s");
    expect(result.report).toContain("│  Status Polling              │  2m 9s");
    expect(result.report).toContain("│  Total                       │  2m 19s");
  });

  it("throws on missing totalSeconds", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://example.com",
      localSeconds: 10,
      remoteSeconds: 20,
      totalSeconds: null,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("totalSeconds");
  });

  it("omits Project ID and Task ID lines on failure when both are absent", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "failure",
      stage: "preflight",
      reason: "Project capacity exceeded.",
      action: "Free a slot and retry.",
      localSeconds: 2,
      remoteSeconds: null,
      totalSeconds: 2,
    });

    expect(result.success).toBe(true);
    expect(result.report).not.toContain("Project ID");
    expect(result.report).not.toContain("Task ID");
  });

  it("renders only Project ID line on failure when taskId is absent", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "failure",
      stage: "createTask",
      reason: "createTask API returned 500.",
      action: "Retry after checking the backend.",
      projectId: "proj_mid",
      localSeconds: 3,
      remoteSeconds: 4,
      totalSeconds: 7,
    });

    expect(result.success).toBe(true);
    expect(result.report).toContain("Project ID : proj_mid");
    expect(result.report).not.toContain("Task ID");
  });

  it("warns and omits when projectId or taskId is missing on a successful deployment", async () => {
    const warnings = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((...args) => warnings.push(args.join(" ")));

    try {
      const result = await runFormatArbitraryDeployReport({
        outcome: "success",
        accessUrl: "https://demo.example.com",
        projectId: null,
        taskId: "",
        localSeconds: 10,
        remoteSeconds: 20,
        totalSeconds: 30,
      });

      expect(result.success).toBe(true);
      expect(result.report).not.toContain("Project ID");
      expect(result.report).not.toContain("Task ID");
      expect(warnings.some((w) => w.includes("projectId"))).toBe(true);
      expect(warnings.some((w) => w.includes("taskId"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("always renders Local Prep and Remote Deploy rows so the time-cost separators don't collapse", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://demo.example.com",
      projectId: "proj_1",
      taskId: "task_1",
      totalSeconds: 1,
    });

    expect(result.success).toBe(true);
    expect(result.report).toContain("│  Local Prep");
    expect(result.report).toContain("│  Remote Deploy");
  });

  it("keeps row widths intact for realistic 36-character UUID identifiers", async () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef0123456789";
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://demo.example.com",
      projectId: uuid,
      taskId: uuid,
      localSeconds: 1,
      remoteSeconds: 1,
      totalSeconds: 2,
    });
    expect(result.success).toBe(true);
    const lines = result.report.split("\n");
    const projectLine = lines.find((line) => line.includes("Project ID"));
    const taskLine = lines.find((line) => line.includes("Task ID"));
    // "  Project ID : " (15 chars) + 36-char UUID = 51 chars — fits under the 62-cell interior.
    expect(projectLine.length).toBeLessThanOrEqual(62);
    expect(taskLine.length).toBeLessThanOrEqual(62);
  });

  it("appends a debug logs block when claudeLogPaths is provided on success", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://demo.example.com",
      projectId: "proj_abc",
      taskId: "task_def",
      localSeconds: 10,
      remoteSeconds: 30,
      totalSeconds: 40,
      claudeLogPaths: {
        projectLogDir: "/Users/me/.claude/projects/-Users-me-app",
        jsonlFiles: [
          "/Users/me/.claude/projects/-Users-me-app/sess-abc.jsonl",
          "/Users/me/.claude/projects/-Users-me-app/sess-def.jsonl",
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.report).toContain("Debug Logs (ZAI_DEPLOY_DEBUG=1)");
    expect(result.report).toContain(
      "  Project Dir : /Users/me/.claude/projects/-Users-me-app",
    );
    expect(result.report).toContain(
      "  Sessions    : /Users/me/.claude/projects/-Users-me-app/sess-abc.jsonl",
    );
    expect(result.report).toContain(
      "                /Users/me/.claude/projects/-Users-me-app/sess-def.jsonl",
    );
    // Block sits at the end of the report and after the time-cost block.
    const debugIndex = result.report.indexOf("Debug Logs");
    const timeCostIndex = result.report.indexOf("Time Cost");
    expect(debugIndex).toBeGreaterThan(timeCostIndex);
  });

  it("appends a debug logs block on failure reports too", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "failure",
      stage: "verifyAccessUrl",
      reason: "Access URL returned an unhealthy response.",
      action: "Inspect the verification body.",
      localSeconds: 10,
      remoteSeconds: 30,
      totalSeconds: 40,
      claudeLogPaths: {
        projectLogDir: "/h/.claude/projects/-h-app",
        jsonlFiles: ["/h/.claude/projects/-h-app/abc.jsonl"],
      },
    });

    expect(result.success).toBe(true);
    expect(result.report).toContain("Debug Logs (ZAI_DEPLOY_DEBUG=1)");
    expect(result.report).toContain(
      "  Project Dir : /h/.claude/projects/-h-app",
    );
    expect(result.report).toContain(
      "  Sessions    : /h/.claude/projects/-h-app/abc.jsonl",
    );
  });

  it("renders the debug block with '(none)' when no .jsonl files were found", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://demo.example.com",
      projectId: "proj_abc",
      taskId: "task_def",
      localSeconds: 10,
      remoteSeconds: 30,
      totalSeconds: 40,
      claudeLogPaths: {
        projectLogDir: "/h/.claude/projects/-h-app",
        jsonlFiles: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.report).toContain("Debug Logs (ZAI_DEPLOY_DEBUG=1)");
    expect(result.report).toContain(
      "  Project Dir : /h/.claude/projects/-h-app",
    );
    expect(result.report).toContain("  Sessions    : (none)");
  });

  it("does not append the debug block when claudeLogPaths is null", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://demo.example.com",
      projectId: "proj_abc",
      taskId: "task_def",
      localSeconds: 10,
      remoteSeconds: 30,
      totalSeconds: 40,
      claudeLogPaths: null,
    });

    expect(result.success).toBe(true);
    expect(result.report).not.toContain("Debug Logs");
    expect(result.report).not.toContain("ZAI_DEPLOY_DEBUG");
  });

  it("keeps a 64-cell-wide header for the success box", async () => {
    const result = await runFormatArbitraryDeployReport({
      outcome: "success",
      accessUrl: "https://demo.example.com",
      projectId: "proj_1",
      taskId: "task_1",
      localSeconds: 1,
      remoteSeconds: 1,
      totalSeconds: 2,
    });
    const headerLine = result.report.split("\n")[1];
    // 2 border glyphs + 62 ASCII cells between them = 64 display cells
    expect(headerLine.startsWith("║")).toBe(true);
    expect(headerLine.endsWith("║")).toBe(true);
    expect(headerLine.length).toBe(64);
  });
});
