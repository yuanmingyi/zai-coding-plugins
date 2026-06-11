import { describe, expect, it } from "vitest";

import { runArbitraryExecuteRemoteDeploy } from "../arbitrary/executeRemoteDeploy.js";

describe("arbitrary/executeRemoteDeploy", () => {
  it("runs package, controller deploy, polling, and verification as one success flow", async () => {
    const calls = [];
    const progressEvents = [];
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: "apps/api",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      appName: "demo-app",
      onTaskCreated: async (event) => {
        progressEvents.push(["created", event]);
      },
      onTaskStatusChange: async (event) => {
        progressEvents.push(["status", event]);
      },
      packageProjectImpl: async (options) => {
        calls.push(["package", options]);
        return {
          success: true,
          packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
          copiedFiles: ["Dockerfile.build", "app.js"],
        };
      },
      controllerDeployImpl: async (options) => {
        calls.push(["controller", options]);
        return {
          success: true,
          taskId: "task-1",
          projectId: "project-1",
          status: "Processing",
          currentStep: "BUILDING",
          uploadedFiles: ["Dockerfile.build", "app.js"],
        };
      },
      pollTaskImpl: async (options) => {
        calls.push(["poll", options]);
        await options.onStatusChange({
          taskId: options.taskId,
          status: "Processing",
          currentStep: "BUILDING",
          stepMessage: "Building image",
        });
        return {
          success: true,
          taskId: "task-1",
          projectId: "project-1",
          status: "Success",
          currentStep: "Succeeded",
          stepMessage: "Deployment completed",
          accessUrl: "https://demo.example.com",
          accessControl: {
            enabled: true,
            mode: "restricted",
            source: "server-config",
            enforcement: "runtime-nginx-x-envoy-external-address-v1",
            policyVersion: "acp_test",
            status: "applied",
            expectedDeniedStatus: 403,
          },
          snapshots: [
            {
              status: "Processing",
              currentStep: "BUILDING",
              stepMessage: "Building image",
            },
            {
              status: "Success",
              currentStep: "Succeeded",
              stepMessage: "Deployment completed",
            },
          ],
        };
      },
      verifyAccessUrlImpl: async (options) => {
        calls.push(["verify", options]);
        return {
          success: true,
          verified: true,
          status: 200,
          body: "ok",
          usedDiagnosticRequest: false,
          summary: "Deployment access URL verification passed.",
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe("completed");
    expect(result.taskId).toBe("task-1");
    expect(result.projectId).toBe("project-1");
    expect(result.accessUrl).toBe("https://demo.example.com");
    expect(result.accessControl).toMatchObject({
      enabled: true,
      mode: "restricted",
      policyVersion: "acp_test",
    });
    expect(result.uploadedFiles).toEqual(["Dockerfile.build", "app.js"]);
    expect(result.snapshots).toHaveLength(2);
    expect(result.usedDiagnosticRequest).toBe(false);
    expect(calls.map(([name]) => name)).toEqual([
      "package",
      "controller",
      "poll",
      "verify",
    ]);
    expect(calls[3][1].accessControl).toMatchObject({
      mode: "restricted",
      policyVersion: "acp_test",
    });
    expect(progressEvents).toEqual([
      [
        "created",
        {
          taskId: "task-1",
          projectId: "project-1",
          status: "Processing",
          currentStep: "BUILDING",
          stepMessage: null,
          accessControl: null,
        },
      ],
      [
        "status",
        {
          taskId: "task-1",
          status: "Processing",
          currentStep: "BUILDING",
          stepMessage: "Building image",
        },
      ],
    ]);
  });

  it("keeps a restricted URL 403 as a successful deploy result", async () => {
    const accessControl = {
      enabled: true,
      mode: "restricted",
      source: "server-config",
      enforcement: "runtime-nginx-x-envoy-external-address-v1",
      policyVersion: "acp_test",
      status: "applied",
      expectedDeniedStatus: 403,
    };
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        uploadedFiles: ["app.js"],
        accessControl: { ...accessControl, status: "pending" },
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        status: "Success",
        currentStep: "Succeeded",
        accessUrl: "https://demo.example.com",
        accessControl,
        snapshots: [],
      }),
      verifyAccessUrlImpl: async (options) => {
        expect(options.accessControl).toEqual(accessControl);
        return {
          success: true,
          verified: true,
          expectedAccessDenied: true,
          status: 403,
          body: "forbidden",
          usedDiagnosticRequest: false,
          summary:
            "Deployment access URL is restricted and returned the expected denied status from this IP.",
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.expectedAccessDenied).toBe(true);
    expect(result.verificationStatus).toBe(403);
    expect(result.summary).toContain("Access URL is restricted");
    expect(result.finalReport).toContain(
      "Access    : Restricted; verification got expected HTTP 403",
    );
    expect(result.accessControl).toEqual(accessControl);
  });

  it("passes database bindings through to controller deploy", async () => {
    const calls = [];
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

    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      database,
      databaseBindings,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async (options) => {
        calls.push(options);
        return {
          success: true,
          taskId: "task-1",
          projectId: "project-1",
          uploadedFiles: ["app.js"],
        };
      },
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        status: "Success",
        currentStep: "Succeeded",
        accessUrl: "https://demo.example.com",
        snapshots: [],
      }),
      verifyAccessUrlImpl: async () => ({
        success: true,
        verified: true,
        status: 200,
        body: "ok",
        usedDiagnosticRequest: false,
        summary: "ok",
      }),
    });

    expect(result.success).toBe(true);
    expect(calls[0].databaseBindings).toEqual(databaseBindings);
    expect(calls[0].database).toEqual(database);
  });

  it("stops immediately when package assembly fails", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: false,
        message: "Dockerfile validation failed: missing path `dist`.",
        summary: "Dockerfile validation failed: missing path `dist`.",
      }),
      controllerDeployImpl: async () => {
        throw new Error("should not reach controller deploy");
      },
      classifyFailureImpl: async (options) => ({
        success: true,
        retryable: true,
        category: "PACKAGE_MISSING_FILE",
        suggestedFix: `fix from ${options.detailLog || options.errorMessage || ""}`,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("packageProject");
    expect(result.message).toContain("missing path `dist`");
    expect(result.classification).toMatchObject({
      retryable: true,
      category: "PACKAGE_MISSING_FILE",
    });
  });

  it("maps a terminal failed task to the pollTask stage, preserves task evidence, and embeds classification", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-2",
        projectId: "project-2",
        uploadedFiles: ["app.js"],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-2",
        projectId: "project-2",
        status: "Failed",
        currentStep: "DeployingFunction",
        stepMessage: "Startup command failed",
        errorMessage: "command not found",
        detailLog: "sh: server: not found",
        snapshots: [
          {
            status: "Processing",
            currentStep: "BUILDING",
            stepMessage: "Building image",
          },
          {
            status: "Failed",
            currentStep: "DeployingFunction",
            stepMessage: "Startup command failed",
          },
        ],
      }),
      verifyAccessUrlImpl: async () => {
        throw new Error("should not verify failed task");
      },
      classifyFailureImpl: async (options) => ({
        success: true,
        retryable: true,
        category: "RUNTIME_DEPENDENCY_MISSING",
        suggestedFix: `fix from ${options.detailLog}`,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("pollTask");
    expect(result.taskId).toBe("task-2");
    expect(result.errorMessage).toBe("command not found");
    expect(result.detailLog).toBe("sh: server: not found");
    expect(result.snapshots).toHaveLength(2);
    expect(result.classification).toMatchObject({
      retryable: true,
      category: "RUNTIME_DEPENDENCY_MISSING",
      suggestedFix: "fix from sh: server: not found",
    });
  });

  it("treats accepted verification status as success without classifying body content", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-3",
        projectId: "project-3",
        uploadedFiles: ["app.js"],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-3",
        projectId: "project-3",
        status: "Success",
        currentStep: "Succeeded",
        stepMessage: "Deployment completed",
        accessUrl: "https://demo.example.com",
        snapshots: [],
      }),
      verifyAccessUrlImpl: async () => ({
        success: true,
        verified: false,
        status: 302,
        body: "Cannot find module 'express'",
        usedDiagnosticRequest: true,
        summary: "Deployment access URL returned an unhealthy response.",
      }),
      classifyFailureImpl: async () => {
        throw new Error(
          "accepted access URL status body should not be classified",
        );
      },
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe("completed");
    expect(result.accessUrl).toBe("https://demo.example.com");
    expect(result.verificationStatus).toBe(302);
    expect(result.usedDiagnosticRequest).toBe(true);
    expect(result.finalReport).toContain("Deployment Completed Successfully");
    expect(result.finalReport).not.toContain("Deployment Failed");
  });

  it.each([404, 500])(
    "keeps HTTP %i verification status as a deploy verification failure",
    async (status) => {
      const result = await runArbitraryExecuteRemoteDeploy({
        cwd: "/tmp/demo",
        agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
        serviceRoot: ".",
        uploadSizeLimit: 104857600,
        timeoutSeconds: 300,
        packageProjectImpl: async () => ({
          success: true,
          packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
        }),
        controllerDeployImpl: async () => ({
          success: true,
          taskId: "task-3",
          projectId: "project-3",
          uploadedFiles: ["app.js"],
        }),
        pollTaskImpl: async () => ({
          success: true,
          taskId: "task-3",
          projectId: "project-3",
          status: "Success",
          currentStep: "Succeeded",
          stepMessage: "Deployment completed",
          accessUrl: "https://demo.example.com",
          snapshots: [],
        }),
        verifyAccessUrlImpl: async () => ({
          success: true,
          verified: false,
          status,
          body: "",
          usedDiagnosticRequest: false,
          summary: `Deployment access URL returned HTTP ${status}.`,
        }),
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe("verifyAccessUrl");
      expect(result.verificationStatus).toBe(status);
      expect(result.finalReport).toContain("Deployment Failed");
    },
  );

  it("preserves controller recordDeployment failures as a distinct terminal stage", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: false,
        stage: "recordDeployment",
        message: "failed to persist local state",
        summary: "failed to persist local state",
      }),
      classifyFailureImpl: async () => ({
        success: true,
        retryable: true,
        category: "SHOULD_NOT_APPEAR",
        suggestedFix: "should not be used",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("recordDeployment");
    expect(result.message).toBe("failed to persist local state");
    expect(result.classification).toMatchObject({
      success: true,
      retryable: false,
      category: "REMOTE_HELPER_TERMINAL_FAILURE",
    });
    expect(result.classification.suggestedFix).toContain(
      "Relay the returned finalReport",
    );
    expect(result.finalReport).toContain("Deployment Failed");
  });

  it("marks initUpload helper failures as terminal non-retryable failures", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: false,
        stage: "initUpload",
        message: "fetch failed",
        summary: "fetch failed",
        apiRecords: [
          {
            url: "https://api.example.com/client/tcb/initUpload",
            method: "POST",
            requestBody: { files: ["server.js"] },
            responseStatus: null,
            responseBody: null,
            errorMessage: "fetch failed",
          },
        ],
      }),
      pollTaskImpl: async () => {
        throw new Error("should not poll after initUpload failure");
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("initUpload");
    expect(result.classification).toMatchObject({
      success: true,
      retryable: false,
      category: "REMOTE_HELPER_TERMINAL_FAILURE",
    });
    expect(result.apiRecords).toHaveLength(1);
    expect(result.apiRecord).toMatchObject({
      url: "https://api.example.com/client/tcb/initUpload",
      requestBody: { files: ["server.js"] },
      responseBody: null,
    });
    expect(result.finalReport).toContain("Deployment Failed");
  });

  it("preserves embedded retryable helper classifications", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: false,
        stage: "initUpload",
        message: "temporary upload service throttling",
        summary: "temporary upload service throttling",
        classification: {
          success: true,
          retryable: true,
          category: "REMOTE_UPLOAD_TRANSIENT",
          suggestedFix: "retry remote deploy without manual diagnostics",
        },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("initUpload");
    expect(result.classification).toMatchObject({
      retryable: true,
      category: "REMOTE_UPLOAD_TRANSIENT",
    });
    expect(result.finalReport).toBeUndefined();
  });

  it("marks poll helper transport failures as terminal non-retryable failures", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-4",
        projectId: "project-4",
        uploadedFiles: ["app.js"],
      }),
      pollTaskImpl: async () => ({
        success: false,
        message: "task polling request failed",
        summary: "task polling request failed",
      }),
      verifyAccessUrlImpl: async () => {
        throw new Error("should not verify after poll helper failure");
      },
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("pollTask");
    expect(result.classification).toMatchObject({
      success: true,
      retryable: false,
      category: "REMOTE_HELPER_TERMINAL_FAILURE",
    });
    expect(result.finalReport).toContain("Deployment Failed");
  });

  it("keeps backend success when access URL verification cannot complete", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-5",
        projectId: "project-5",
        uploadedFiles: ["app.js"],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-5",
        projectId: "project-5",
        status: "Success",
        currentStep: "Succeeded",
        stepMessage: "Deployment completed",
        accessUrl: "https://demo.example.com",
        snapshots: [],
      }),
      verifyAccessUrlImpl: async () => ({
        success: false,
        message: "access URL request failed",
        summary: "access URL request failed",
        requestAttempted: true,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe("completed");
    expect(result.status).toBe("Success");
    expect(result.verified).toBe(false);
    expect(result.verificationStatus).toBeNull();
    expect(result.verificationError).toBe("access URL request failed");
    expect(result.summary).toContain(
      "Remote deployment completed successfully",
    );
    expect(result.summary).toContain(
      "Access URL verification did not complete",
    );
    expect(result.finalReport).toContain("Deployment Completed Successfully");
    expect(result.finalReport).toContain("Verification inconclusive");
    expect(result.finalReport).not.toContain("Deployment Failed");
  });

  it("fails when a successful backend task has no access URL to verify", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/demo/.zai/deploy/arbitrary/run-1/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-5",
        projectId: "project-5",
        uploadedFiles: ["app.js"],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-5",
        projectId: "project-5",
        status: "Success",
        currentStep: "Succeeded",
        stepMessage: "Deployment completed",
        accessUrl: null,
        snapshots: [],
      }),
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("verifyAccessUrl");
    expect(result.message).toContain("Missing required verification input");
    expect(result.finalReport).toContain("Deployment Failed");
  });

  it("returns elapsedSeconds on success", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/run/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        uploadedFiles: ["app.js"],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        status: "Success",
        currentStep: "Succeeded",
        stepMessage: "Done",
        accessUrl: "https://example.com",
        snapshots: [],
      }),
      verifyAccessUrlImpl: async () => ({
        success: true,
        verified: true,
        status: 200,
        body: "ok",
        usedDiagnosticRequest: false,
        summary: "ok",
      }),
    });
    expect(typeof result.elapsedSeconds).toBe("number");
    expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof result.startedAt).toBe("number");
    expect(typeof result.finishedAt).toBe("number");
  });

  it("returns elapsedSeconds on pollTask terminal failure", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/run/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        uploadedFiles: [],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        status: "Failed",
        currentStep: "DeployingFunction",
        stepMessage: "Startup failed",
        errorMessage: "command not found",
        detailLog: "sh: not found",
        snapshots: [],
      }),
      classifyFailureImpl: async () => ({
        success: true,
        retryable: true,
        category: "RUNTIME_DEPENDENCY_MISSING",
        suggestedFix: "fix",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.stage).toBe("pollTask");
    expect(typeof result.elapsedSeconds).toBe("number");
    expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  it("returns elapsedSeconds on packageProject failure", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: false,
        message: "Dockerfile validation failed",
        summary: "Dockerfile validation failed",
      }),
      classifyFailureImpl: async () => ({
        success: true,
        retryable: true,
        category: "PACKAGE_MISSING_FILE",
        suggestedFix: "fix",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.stage).toBe("packageProject");
    expect(typeof result.elapsedSeconds).toBe("number");
    expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  it("emits finalReport on success", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/run/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        uploadedFiles: ["app.js"],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        status: "Success",
        currentStep: "Succeeded",
        stepMessage: "Done",
        accessUrl: "https://example.com",
        snapshots: [],
      }),
      verifyAccessUrlImpl: async () => ({
        success: true,
        verified: true,
        status: 200,
        body: "ok",
        usedDiagnosticRequest: false,
        summary: "ok",
      }),
    });
    expect(result.success).toBe(true);
    expect(result.finalReport).toContain("Deployment Completed Successfully");
    expect(result.finalReport).toContain("https://example.com");
  });

  it("emits finalReport on non-retryable failure", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/run/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        uploadedFiles: [],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        status: "Failed",
        currentStep: "DeployingFunction",
        stepMessage: "Startup failed",
        errorMessage: "command not found",
        detailLog: "sh: not found",
        snapshots: [],
      }),
      classifyFailureImpl: async () => ({
        success: true,
        retryable: false,
        category: "USER_CODE_ERROR",
        suggestedFix: "fix your code",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.finalReport).toContain("Deployment Failed");
    expect(result.finalReport).toContain("command not found");
  });

  it("reports SCF Creating failures with platform context and polling duration", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      nowFn: (() => {
        const times = [0, 140_000];
        return () => times.shift() ?? 140_000;
      })(),
      packageProjectImpl: async () => ({
        success: true,
        packageDir: "/tmp/run/deploy-package",
      }),
      controllerDeployImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        uploadedFiles: [],
      }),
      pollTaskImpl: async () => ({
        success: true,
        taskId: "task-1",
        projectId: "project-1",
        status: "Failed",
        currentStep: "Failed",
        stepMessage: "Deployment failed",
        errorMessage: "当前函数处于Creating状态，无法进行此操作，请稍后重试。",
        detailLog:
          "Failure: TencentCloudApiException: 当前函数处于Creating状态，无法进行此操作，请稍后重试。 [service=scf, action=UpdateFunctionCode, region=ap-shanghai, code=FailedOperation.UpdateFunctionCode, requestId=req-1]",
        snapshots: [],
        elapsedSeconds: 129,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.pollElapsedSeconds).toBe(129);
    expect(result.finalReport).toContain("SCF function is still Creating");
    expect(result.finalReport).toContain("FailedOperation.UpdateFunctionCode");
    expect(result.finalReport).toContain("req-1");
    expect(result.finalReport).toContain("Status Polling");
  });

  it("falls back to a debugLogs string when the formatter throws on a hard failure (ZAI_DEPLOY_DEBUG=1)", async () => {
    const claudeLogPaths = {
      projectLogDir: "/home/me/.claude/projects/-tmp-demo",
      jsonlFiles: ["/home/me/.claude/projects/-tmp-demo/r1.jsonl"],
    };
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      collectClaudeLogPathsImpl: () => claudeLogPaths,
      formatReportImpl: async () => {
        throw new Error("template parse error");
      },
      packageProjectImpl: async () => ({
        success: false,
        message: "Dockerfile validation failed",
        summary: "Dockerfile validation failed",
      }),
      classifyFailureImpl: async () => ({
        success: true,
        retryable: false,
        category: "PACKAGE_MISSING_FILE",
        suggestedFix: "fix",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.finalReport).toBeUndefined();
    expect(result.debugLogs).toBeDefined();
    expect(result.debugLogs).toContain("ZAI_DEPLOY_DEBUG=1");
    expect(result.debugLogs).toContain(
      "/home/me/.claude/projects/-tmp-demo/r1.jsonl",
    );
  });

  it("does not emit finalReport on retryable failure", async () => {
    const result = await runArbitraryExecuteRemoteDeploy({
      cwd: "/tmp/demo",
      agentWorkDir: "/tmp/demo/.zai/deploy/arbitrary/run-1",
      serviceRoot: ".",
      uploadSizeLimit: 104857600,
      timeoutSeconds: 300,
      packageProjectImpl: async () => ({
        success: false,
        message: "Dockerfile validation failed",
        summary: "Dockerfile validation failed",
      }),
      classifyFailureImpl: async () => ({
        success: true,
        retryable: true,
        category: "PACKAGE_MISSING_FILE",
        suggestedFix: "fix",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.finalReport).toBeUndefined();
  });
});
