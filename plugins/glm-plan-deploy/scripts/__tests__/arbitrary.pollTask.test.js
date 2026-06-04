import { describe, expect, it } from "vitest";

import { runArbitraryPollTask } from "../arbitrary/pollTask.js";

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe("arbitrary/pollTask", () => {
  it("polls until success and returns progress snapshots", async () => {
    let calls = 0;
    const result = await runArbitraryPollTask({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      taskId: "task-1",
      timeoutSeconds: 60,
      pollIntervalMs: 1,
      nowFn: (() => {
        let now = 0;
        return () => (now += 1000);
      })(),
      sleepFn: async () => {},
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return makeResponse({
            code: 200,
            data: {
              taskId: "task-1",
              status: "Processing",
              currentStep: "BUILDING",
              stepMessage: "Building image",
            },
          });
        }
        return makeResponse({
          code: 200,
          data: {
            taskId: "task-1",
            projectId: "project-1",
            status: "Success",
            currentStep: "DEPLOYED",
            stepMessage: "Deployment complete",
            accessUrl: "https://example.com",
            accessControl: {
              enabled: true,
              mode: "restricted",
              source: "server-config",
              enforcement: "runtime-nginx-x-envoy-external-address-v1",
              policyVersion: "acp_test",
              status: "applied",
              expectedDeniedStatus: 403,
            },
            finishTime: 2000,
          },
        });
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("Success");
    expect(result.accessUrl).toBe("https://example.com");
    expect(result.accessControl).toEqual({
      enabled: true,
      mode: "restricted",
      source: "server-config",
      enforcement: "runtime-nginx-x-envoy-external-address-v1",
      policyVersion: "acp_test",
      status: "applied",
      expectedDeniedStatus: 403,
    });
    expect(result.elapsedSeconds).toBe(2);
    expect(result.snapshots).toEqual([
      {
        status: "Processing",
        currentStep: "BUILDING",
        stepMessage: "Building image",
      },
      {
        status: "Success",
        currentStep: "DEPLOYED",
        stepMessage: "Deployment complete",
      },
    ]);
  });

  it("notifies only when the observed task status snapshot changes", async () => {
    let calls = 0;
    const events = [];
    const result = await runArbitraryPollTask({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      taskId: "task-1",
      timeoutSeconds: 60,
      pollIntervalMs: 1,
      nowFn: (() => {
        let now = 0;
        return () => (now += 1000);
      })(),
      sleepFn: async () => {},
      onStatusChange: async (event) => {
        events.push(event);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls <= 2) {
          return makeResponse({
            code: 200,
            data: {
              taskId: "task-1",
              status: "Processing",
              currentStep: "BUILDING",
              stepMessage: "Building image",
            },
          });
        }
        return makeResponse({
          code: 200,
          data: {
            taskId: "task-1",
            projectId: "project-1",
            status: "Success",
            currentStep: "DEPLOYED",
            stepMessage: "Deployment complete",
            accessUrl: "https://example.com",
          },
        });
      },
    });

    expect(result.success).toBe(true);
    expect(events).toEqual([
      {
        taskId: "task-1",
        projectId: null,
        status: "Processing",
        currentStep: "BUILDING",
        stepMessage: "Building image",
      },
      {
        taskId: "task-1",
        projectId: "project-1",
        status: "Success",
        currentStep: "DEPLOYED",
        stepMessage: "Deployment complete",
      },
    ]);
  });

  it("returns a terminal failed task without retrying forever", async () => {
    const result = await runArbitraryPollTask({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      taskId: "task-1",
      timeoutSeconds: 60,
      pollIntervalMs: 1,
      nowFn: (() => {
        let now = 0;
        return () => (now += 1000);
      })(),
      sleepFn: async () => {},
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            taskId: "task-1",
            status: "Failed",
            currentStep: "DEPLOYING",
            stepMessage: "Startup command failed",
            errorMessage: "command not found",
            detailLog: "sh: server: not found",
          },
        }),
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("Failed");
    expect(result.errorMessage).toBe("command not found");
    expect(result.elapsedSeconds).toBe(1);
  });

  it("fails on timeout and includes the last observed state", async () => {
    const result = await runArbitraryPollTask({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      taskId: "task-1",
      timeoutSeconds: 2,
      pollIntervalMs: 1,
      nowFn: (() => {
        const values = [0, 1000, 2000, 3000];
        return () => values.shift() ?? 3000;
      })(),
      sleepFn: async () => {},
      fetchImpl: async () =>
        makeResponse({
          code: 200,
          data: {
            taskId: "task-1",
            status: "Processing",
            currentStep: "BUILDING",
            stepMessage: "Still building",
          },
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Deployment task polling timed out");
    expect(result.elapsedSeconds).toBe(2);
    expect(result.lastObserved.status).toBe("Processing");
  });

  it("fails cleanly when the task no longer exists", async () => {
    const result = await runArbitraryPollTask({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      taskId: "task-missing",
      timeoutSeconds: 60,
      pollIntervalMs: 1,
      nowFn: () => 0,
      sleepFn: async () => {},
      fetchImpl: async () =>
        makeResponse({
          code: 3011,
          msg: "DEPLOYMENT_NOT_FOUND",
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("task no longer exists");
  });

  it("keeps polling through a transient connect-timeout instead of failing the deploy", async () => {
    // Production incident adt-030c86cd93174ea29f8af489298439d9: the very
    // first getTask hit `fetch failed` / UND_ERR_CONNECT_TIMEOUT, the poll
    // loop treated it as terminal, and the deploy was reported failed even
    // though it succeeded server-side. A transient pre-response connectivity
    // blip must be retried within the overall timeout budget, not fatal.
    let calls = 0;
    const result = await runArbitraryPollTask({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      taskId: "task-1",
      timeoutSeconds: 600,
      pollIntervalMs: 1,
      nowFn: (() => {
        let now = 0;
        return () => (now += 1000);
      })(),
      sleepFn: async () => {},
      fetchImpl: async () => {
        calls += 1;
        // requestJson wraps fetch in its own single network retry, so two
        // throws are consumed per poll iteration before it surfaces.
        if (calls <= 4) {
          const err = new TypeError("fetch failed");
          err.cause = Object.assign(new Error("Connect Timeout Error"), {
            code: "UND_ERR_CONNECT_TIMEOUT",
          });
          throw err;
        }
        return makeResponse({
          code: 200,
          data: {
            taskId: "task-1",
            projectId: "project-1",
            status: "Success",
            currentStep: "DEPLOYED",
            stepMessage: "Deployment complete",
            accessUrl: "https://example.com",
            finishTime: 5000,
          },
        });
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("Success");
    expect(result.accessUrl).toBe("https://example.com");
  });

  it("times out cleanly when connectivity never recovers within the budget", async () => {
    const result = await runArbitraryPollTask({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      taskId: "task-1",
      timeoutSeconds: 2,
      pollIntervalMs: 1,
      nowFn: (() => {
        let now = 0;
        return () => (now += 1000);
      })(),
      sleepFn: async () => {},
      fetchImpl: async () => {
        const err = new TypeError("fetch failed");
        err.cause = Object.assign(new Error("Connect Timeout Error"), {
          code: "UND_ERR_CONNECT_TIMEOUT",
        });
        throw err;
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("timed out");
  });

  it("returns API diagnostics when polling request fails", async () => {
    const result = await runArbitraryPollTask({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      taskId: "task-1",
      timeoutSeconds: 60,
      pollIntervalMs: 1,
      nowFn: () => 0,
      sleepFn: async () => {},
      fetchImpl: async () =>
        makeResponse({
          code: 500,
          msg: "poll failed",
        }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("poll failed");
    expect(result.apiRecords).toHaveLength(1);
    expect(result.apiRecord).toMatchObject({
      url: "https://api.example.com/client/tcb/getTask?taskId=task-1",
      method: "GET",
      requestBody: null,
      responseBody: {
        code: 500,
        msg: "poll failed",
      },
    });
  });
});
