import { describe, expect, it } from "vitest";

import { runArbitraryDeploy } from "../arbitrary/deploy.js";

describe("arbitrary/deploy", () => {
  it("runs local prep then remote deploy and formats final report with top-level timing", async () => {
    const calls = [];
    const times = [100_000, 109_400, 109_400];
    const onTaskCreated = () => {};
    const onTaskStatusChange = () => {};

    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      appName: "demo-app",
      onTaskCreated,
      onTaskStatusChange,
      nowFn: () => times.shift(),
      prepareLocalImpl: async (options) => {
        calls.push(["prepare", options]);
        return {
          success: true,
          stage: "completed",
          needsUserInput: false,
          timeoutSeconds: 300,
          uploadSizeLimit: 104857600,
          detectedConfig: {
            serviceRoot: "apps/api",
          },
          agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
          elapsedSeconds: 2,
        };
      },
      remoteDeployImpl: async (options) => {
        calls.push(["remote", options]);
        return {
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          taskId: "task-1",
          elapsedSeconds: 5,
          finalReport: "old remote-only report",
        };
      },
    });

    expect(calls.map(([name]) => name)).toEqual(["prepare", "remote"]);
    expect(calls[0][1]).toMatchObject({
      cwd: "/tmp/demo",
      appName: "demo-app",
    });
    expect(calls[1][1]).toMatchObject({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: "apps/api",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      appName: "demo-app",
      localElapsedSeconds: 2,
    });
    expect(calls[1][1].onTaskCreated).toBe(onTaskCreated);
    expect(calls[1][1].onTaskStatusChange).toBe(onTaskStatusChange);
    expect(result.success).toBe(true);
    expect(result.elapsedSeconds).toBe(9);
    expect(result.localElapsedSeconds).toBe(2);
    expect(result.remoteElapsedSeconds).toBe(5);
    expect(result.startedAt).toBe(100_000);
    expect(result.finishedAt).toBe(109_400);
    expect(result.finalReport).toContain("Deployment Completed Successfully");
    expect(result.finalReport).toContain("https://demo.example.com");
    expect(result.finalReport).toMatch(/Local Prep\s+│\s+2s/);
    expect(result.finalReport).toMatch(/Remote Deploy\s+│\s+5s/);
    expect(result.finalReport).toMatch(/Total\s+│\s+9s/);
    expect(result.finalReport).not.toContain("old remote-only report");
  });

  it("passes the entry path option to local preparation", async () => {
    const calls = [];

    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      path: "landing.html",
      nowFn: () => 0,
      prepareLocalImpl: async (options) => {
        calls.push(["prepare", options]);
        return {
          success: true,
          stage: "completed",
          needsUserInput: false,
          timeoutSeconds: 300,
          uploadSizeLimit: 104857600,
          detectedConfig: {
            serviceRoot: ".",
          },
          agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
          elapsedSeconds: 0,
        };
      },
      databaseSyncImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
      }),
      remoteDeployImpl: async (options) => {
        calls.push(["remote", options]);
        return {
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          elapsedSeconds: 0,
          finalReport: "done",
        };
      },
      formatReportImpl: async () => ({
        success: true,
        report: "done",
      }),
    });

    expect(result.success).toBe(true);
    expect(calls[0]).toMatchObject([
      "prepare",
      {
        cwd: "/tmp/demo",
        path: "landing.html",
      },
    ]);
  });

  it("includes final report construction in the top-level elapsed time", async () => {
    const times = [0, 9_000, 11_000, 11_000];
    const formatCalls = [];

    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      nowFn: () => times.shift(),
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        detectedConfig: {
          serviceRoot: ".",
        },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
        elapsedSeconds: 2,
      }),
      remoteDeployImpl: async () => ({
        success: true,
        stage: "completed",
        accessUrl: "https://demo.example.com",
        elapsedSeconds: 5,
        finalReport: "old remote-only report",
      }),
      formatReportImpl: async (options) => {
        formatCalls.push(options);
        return {
          success: true,
          report: `totalSeconds=${options.totalSeconds}`,
        };
      },
    });

    expect(result.elapsedSeconds).toBe(11);
    expect(result.finishedAt).toBe(11_000);
    expect(result.finalReport).toBe("totalSeconds=11");
    expect(formatCalls.map((options) => options.totalSeconds)).toEqual([9, 11]);
  });

  it("stabilizes final report timing across multiple delayed formatting passes", async () => {
    const times = [0, 9_000, 11_000, 12_000, 12_000];
    const formatCalls = [];

    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      nowFn: () => times.shift(),
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        detectedConfig: {
          serviceRoot: ".",
        },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
        elapsedSeconds: 2,
      }),
      remoteDeployImpl: async () => ({
        success: true,
        stage: "completed",
        accessUrl: "https://demo.example.com",
        elapsedSeconds: 5,
        finalReport: "old remote-only report",
      }),
      formatReportImpl: async (options) => {
        formatCalls.push(options);
        return {
          success: true,
          report: `totalSeconds=${options.totalSeconds}`,
        };
      },
    });

    expect(result.elapsedSeconds).toBe(12);
    expect(result.finishedAt).toBe(12_000);
    expect(result.finalReport).toBe("totalSeconds=12");
    expect(formatCalls.map((options) => options.totalSeconds)).toEqual([
      9, 11, 12,
    ]);
  });

  it("emits firstDeployNotice to the noticeStream BEFORE invoking remote deploy", async () => {
    const noticeWrites = [];
    const events = [];
    const noticeStream = {
      write(chunk) {
        noticeWrites.push(chunk);
        events.push("notice");
      },
    };

    await runArbitraryDeploy({
      cwd: "/tmp/demo",
      appName: "demo-app",
      noticeStream,
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        firstDeployNotice:
          "First-time deploy: the platform will provision a CloudBase env (several minutes).",
        detectedConfig: { serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-x",
        elapsedSeconds: 1,
      }),
      remoteDeployImpl: async () => {
        events.push("remote");
        return {
          success: true,
          stage: "completed",
          accessUrl: "https://x.example.com",
          taskId: "task-x",
          elapsedSeconds: 1,
        };
      },
    });

    expect(noticeWrites).toHaveLength(1);
    expect(noticeWrites[0]).toContain("[deploy-notice]");
    expect(noticeWrites[0]).toContain("First-time deploy");
    expect(events).toEqual(["notice", "remote"]);
  });

  it("passes prepared database bindings into the remote deploy stage", async () => {
    const database = {
      mode: "managed",
      type: "mysql",
      orm: "prisma",
      migrationCommand: "npx prisma migrate deploy",
      bindingId: "dbbind-1",
    };
    const databaseBindings = [
      {
        bindingId: "dbbind-1",
        env: {
          DATABASE_URL: "secretRef:DATABASE_URL",
          MYSQL_HOST: "valueRef:host",
        },
      },
    ];
    const calls = [];

    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      appName: "demo-app",
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        detectedConfig: { serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-db",
        database,
        databaseBindings,
        elapsedSeconds: 1,
      }),
      remoteDeployImpl: async (options) => {
        calls.push(options);
        return {
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          taskId: "task-1",
          elapsedSeconds: 1,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(calls[0].databaseBindings).toEqual(databaseBindings);
    expect(calls[0].database).toEqual(database);
  });

  it("runs deploy-time database sync before remote deploy and records the synced fingerprint", async () => {
    const database = {
      detected: true,
      mode: "managed",
      type: "mysql",
      orm: "prisma",
      migrationCommand: "npx prisma migrate deploy",
      bindingId: "dbbind-1",
    };
    const events = [];
    const remoteCalls = [];

    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      appName: "demo-app",
      databaseSync: "apply",
      databaseSyncConfirm: true,
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        projectId: "project-1",
        detectedConfig: { serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-db",
        database,
        databaseBindings: [{ bindingId: "dbbind-1", env: {} }],
        elapsedSeconds: 1,
      }),
      databaseSyncImpl: async (options) => {
        events.push("database");
        expect(options.databaseSync).toBe("apply");
        expect(options.databaseSyncConfirm).toBe(true);
        expect(options.projectId).toBe("project-1");
        expect(options.database.bindingId).toBe("dbbind-1");
        return {
          success: true,
          stage: "completed",
          needsUserInput: false,
          action: "applied",
          projectId: "project-1",
          migrationFingerprint: "fingerprint-1",
          recordMigrationFingerprint: true,
        };
      },
      remoteDeployImpl: async (options) => {
        events.push("remote");
        remoteCalls.push(options);
        return {
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          taskId: "task-1",
          elapsedSeconds: 1,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(events).toEqual(["database", "remote"]);
    expect(remoteCalls[0].database).toMatchObject({
      bindingId: "dbbind-1",
      migrationFingerprint: "fingerprint-1",
      lastMigrationSyncAction: "applied",
    });
    expect(remoteCalls[0].projectId).toBe("project-1");
    expect(remoteCalls[0].databaseSync).toBeUndefined();
  });

  it("preserves migration fingerprint through a deploy-time database auto skip", async () => {
    const database = {
      detected: true,
      mode: "managed",
      type: "mysql",
      orm: "prisma",
      migrationCommand: "npx prisma migrate deploy",
      bindingId: "dbbind-1",
    };
    const remoteCalls = [];

    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      appName: "demo-app",
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        projectId: "project-1",
        detectedConfig: { serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-db",
        database,
        databaseBindings: [{ bindingId: "dbbind-1", env: {} }],
        elapsedSeconds: 1,
      }),
      databaseSyncImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        action: "skipped",
        migrationFingerprint: "fingerprint-unchanged",
        recordMigrationFingerprint: true,
      }),
      remoteDeployImpl: async (options) => {
        remoteCalls.push(options);
        return {
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          taskId: "task-1",
          elapsedSeconds: 1,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(remoteCalls[0].database).toMatchObject({
      bindingId: "dbbind-1",
      migrationFingerprint: "fingerprint-unchanged",
      lastMigrationSyncAction: "skipped",
    });
    expect(remoteCalls[0].databaseSync).toBeUndefined();
  });

  it("stops before remote deploy when deploy-time database sync needs user input", async () => {
    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        detectedConfig: { serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-db",
        database: {
          detected: true,
          mode: "managed",
          type: "mysql",
          bindingId: "dbbind-1",
        },
        databaseBindings: [{ bindingId: "dbbind-1", env: {} }],
        elapsedSeconds: 1,
      }),
      databaseSyncImpl: async () => ({
        success: true,
        stage: "database",
        needsUserInput: true,
        reasonCode: "DATABASE_MIGRATIONS_PENDING",
        message: "Detected pending migrations.",
        summary: "Detected pending migrations.",
      }),
      remoteDeployImpl: async () => {
        throw new Error("should not run remote deploy");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("database");
    expect(result.reasonCode).toBe("DATABASE_MIGRATIONS_PENDING");
    expect(result.finalReport).toBeUndefined();
  });

  it("does not emit firstDeployNotice when prepareLocal didn't set one", async () => {
    const noticeWrites = [];
    await runArbitraryDeploy({
      cwd: "/tmp/demo",
      appName: "demo-app",
      noticeStream: {
        write(chunk) {
          noticeWrites.push(chunk);
        },
      },
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        firstDeployNotice: null,
        detectedConfig: { serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-y",
        elapsedSeconds: 1,
      }),
      remoteDeployImpl: async () => ({
        success: true,
        stage: "completed",
        accessUrl: "https://y.example.com",
        taskId: "task-y",
        elapsedSeconds: 1,
      }),
    });
    expect(noticeWrites).toHaveLength(0);
  });

  it("stops before remote deploy when local prep needs user input", async () => {
    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      nowFn: (() => {
        const times = [0, 1_000];
        return () => times.shift();
      })(),
      prepareLocalImpl: async () => ({
        success: true,
        needsUserInput: true,
        stage: "analyze",
        reasonCode: "UNKNOWN_RUNTIME",
        message: "Please confirm the runtime.",
        summary: "Please confirm the runtime.",
        elapsedSeconds: 1,
      }),
      remoteDeployImpl: async () => {
        throw new Error("should not run remote deploy");
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.stage).toBe("analyze");
    expect(result.finalReport).toBeUndefined();
    expect(result.elapsedSeconds).toBe(1);
  });

  it("passes pollElapsedSeconds through to the report formatter", async () => {
    const formatCalls = [];
    const times = [100_000, 160_000, 160_000];

    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      nowFn: () => times.shift(),
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        detectedConfig: { language: "Node.js", serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
        elapsedSeconds: 3,
      }),
      remoteDeployImpl: async () => ({
        success: false,
        stage: "pollTask",
        message: "CloudBase function update was rejected.",
        summary: "Wait and retry.",
        elapsedSeconds: 57,
        pollElapsedSeconds: 50,
      }),
      formatReportImpl: async (options) => {
        formatCalls.push(options);
        return { success: true, report: "ok" };
      },
    });

    expect(result.pollElapsedSeconds).toBe(50);
    expect(formatCalls[0]).toMatchObject({
      localSeconds: 3,
      remoteSeconds: 57,
      pollSeconds: 50,
      totalSeconds: 60,
    });
  });

  it("propagates detectedConfig and agentWorkDir to the remote-failure terminal result", async () => {
    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      nowFn: (() => {
        const times = [0, 9_000];
        return () => times.shift();
      })(),
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        detectedConfig: { language: "Node.js", serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
        elapsedSeconds: 2,
      }),
      remoteDeployImpl: async () => ({
        success: false,
        stage: "pollTask",
        message: "fetch failed",
        summary: "fetch failed",
        elapsedSeconds: 5,
        classification: {
          success: true,
          retryable: false,
          category: "REMOTE_HELPER_TERMINAL_FAILURE",
        },
        apiRecord: {
          causeCode: "UND_ERR_CONNECT_TIMEOUT",
          errorMessage: "fetch failed",
        },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("pollTask");
    expect(result.detectedConfig).toMatchObject({ language: "Node.js" });
    expect(result.agentWorkDir).toBe("/tmp/demo/.zai/deploy/arbitrary/run-1");
  });

  it("falls back to a debugLogs string when the formatter throws on a hard failure (ZAI_DEPLOY_DEBUG=1)", async () => {
    const claudeLogPaths = {
      projectLogDir: "/home/me/.claude/projects/-tmp-demo",
      jsonlFiles: ["/home/me/.claude/projects/-tmp-demo/aaa.jsonl"],
    };
    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      collectClaudeLogPathsImpl: () => claudeLogPaths,
      formatReportImpl: async () => {
        throw new Error("template parse error");
      },
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        detectedConfig: { serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
        elapsedSeconds: 1,
      }),
      remoteDeployImpl: async () => ({
        success: false,
        stage: "verifyAccessUrl",
        message: "upstream 502",
        summary: "upstream 502",
        elapsedSeconds: 2,
      }),
    });
    expect(result.success).toBe(false);
    expect(result.finalReport).toBeUndefined();
    expect(result.debugLogs).toBeDefined();
    expect(result.debugLogs).toContain("ZAI_DEPLOY_DEBUG=1");
    expect(result.debugLogs).toContain(
      "/home/me/.claude/projects/-tmp-demo/aaa.jsonl",
    );
  });

  it("preserves retryable remote failures without manufacturing a final report", async () => {
    const result = await runArbitraryDeploy({
      cwd: "/tmp/demo",
      nowFn: (() => {
        const times = [0, 7_000];
        return () => times.shift();
      })(),
      prepareLocalImpl: async () => ({
        success: true,
        stage: "completed",
        needsUserInput: false,
        timeoutSeconds: 300,
        uploadSizeLimit: 104857600,
        detectedConfig: { serviceRoot: "." },
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
        elapsedSeconds: 2,
      }),
      remoteDeployImpl: async () => ({
        success: false,
        stage: "packageProject",
        message: "missing packaged file",
        summary: "missing packaged file",
        elapsedSeconds: 5,
        classification: {
          success: true,
          retryable: true,
          category: "PACKAGE_MISSING_FILE",
          suggestedFix: "include the missing file",
        },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("packageProject");
    expect(result.classification.retryable).toBe(true);
    expect(result.elapsedSeconds).toBe(7);
    expect(result.finalReport).toBeUndefined();
  });
});
