import { describe, expect, it } from "vitest";

import {
  DeployApiError,
  isDeploymentNotFoundError,
  isInvalidProjectIdError,
  isProjectNotFoundError,
  requestJson,
  retryNetworkConnection,
} from "../common/http.js";

function makeResponse({ ok = true, status = 200, body, text }) {
  return {
    ok,
    status,
    text: text || (async () => body),
  };
}

describe("common/http", () => {
  it("returns the data payload when the deploy API succeeds", async () => {
    const result = await requestJson({
      url: "https://deploy.example.com/test",
      token: "token",
      fetchImpl: async () =>
        makeResponse({
          body: JSON.stringify({
            code: 200,
            data: { ok: true },
          }),
        }),
    });

    expect(result.data).toEqual({ ok: true });
    expect(result.apiRecord).toMatchObject({
      method: "GET",
      url: "https://deploy.example.com/test",
      requestBody: null,
      responseStatus: 200,
      responseBody: {
        code: 200,
        data: { ok: true },
      },
    });
  });

  it("throws when the HTTP response is not ok", async () => {
    let attempts = 0;
    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        token: "token",
        fetchImpl: async () => {
          attempts += 1;
          return makeResponse({
            ok: false,
            status: 500,
            body: JSON.stringify({ code: 500, msg: "server error" }),
          });
        },
      }),
    ).rejects.toBeInstanceOf(DeployApiError);
    expect(attempts).toBe(1);
  });

  it("attaches request and response bodies to HTTP response failures", async () => {
    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        method: "POST",
        token: "token",
        body: { files: ["server.js"] },
        fetchImpl: async () =>
          makeResponse({
            ok: false,
            status: 502,
            body: JSON.stringify({ code: 502, msg: "gateway unavailable" }),
          }),
      }),
    ).rejects.toMatchObject({
      method: "POST",
      url: "https://deploy.example.com/test",
      requestBody: { files: ["server.js"] },
      responseStatus: 502,
      responseBody: { code: 502, msg: "gateway unavailable" },
    });
  });

  it("retries a network connection failure once", async () => {
    let attempts = 0;
    const result = await requestJson({
      url: "https://deploy.example.com/test",
      token: "token",
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new TypeError("fetch failed");
          error.cause = { code: "ECONNRESET" };
          throw error;
        }
        return makeResponse({
          body: JSON.stringify({
            code: 200,
            data: { ok: true },
          }),
        });
      },
    });

    expect(result.data).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it("attaches request body and cause to final fetch failures", async () => {
    let attempts = 0;
    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        method: "POST",
        token: "token",
        body: { files: ["server.js"] },
        fetchImpl: async () => {
          attempts += 1;
          const error = new TypeError("fetch failed");
          error.cause = { code: "ECONNRESET" };
          throw error;
        },
      }),
    ).rejects.toMatchObject({
      message: "fetch failed",
      method: "POST",
      url: "https://deploy.example.com/test",
      requestBody: { files: ["server.js"] },
      responseStatus: null,
      responseBody: null,
      causeCode: "ECONNRESET",
    });
    expect(attempts).toBe(2);
  });

  it("does not expose authorization headers in API diagnostics", async () => {
    const result = await requestJson({
      url: "https://deploy.example.com/test",
      token: "secret-token",
      fetchImpl: async () =>
        makeResponse({
          body: JSON.stringify({
            code: 200,
            data: { ok: true },
          }),
        }),
    });

    expect(JSON.stringify(result.apiRecord)).not.toContain("secret-token");
    expect(result.apiRecord.requestHeaders).toBeUndefined();
  });

  it("redacts sensitive diagnostic fields and truncates large response strings", async () => {
    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        method: "POST",
        token: "token",
        body: {
          files: ["server.js"],
          token: "request-secret",
        },
        fetchImpl: async () =>
          makeResponse({
            ok: false,
            status: 500,
            body: JSON.stringify({
              code: 500,
              msg: "server error",
              data: {
                files: [
                  {
                    relativePath: "server.js",
                    presignedUploadUrl:
                      "https://upload.example.com/object?x-cos-signature=secret-signature",
                  },
                ],
                detail: "x".repeat(5000),
              },
            }),
          }),
      }),
    ).rejects.toMatchObject({
      requestBody: {
        files: ["server.js"],
        token: "[REDACTED]",
      },
      responseBody: {
        data: {
          files: [
            {
              presignedUploadUrl: "[REDACTED]",
            },
          ],
        },
      },
    });

    try {
      await requestJson({
        url: "https://deploy.example.com/test",
        method: "POST",
        token: "token",
        body: { token: "request-secret" },
        fetchImpl: async () =>
          makeResponse({
            body: JSON.stringify({
              code: 500,
              msg: "server error token=api-message-secret",
              data: {
                files: [
                  {
                    presignedUploadUrl:
                      "https://upload.example.com/object?x-cos-signature=secret-signature",
                  },
                ],
                detail: "x".repeat(5000),
              },
            }),
          }),
      });
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain("request-secret");
      expect(serialized).not.toContain("secret-signature");
      expect(serialized).not.toContain("api-message-secret");
      expect(serialized).toContain("[REDACTED]");
      expect(error.responseBody.data.detail).toContain("[truncated");
      expect(error.body.data.files[0].presignedUploadUrl).toBe("[REDACTED]");
      expect(error.apiMessage).toContain("[REDACTED]");
    }
  });

  it("caps diagnostic object width", async () => {
    const data = {};
    for (let i = 0; i < 150; i += 1) {
      data[`key${i}`] = i;
    }

    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        token: "token",
        fetchImpl: async () =>
          makeResponse({
            ok: false,
            status: 500,
            body: JSON.stringify({ code: 500, msg: "server error", data }),
          }),
      }),
    ).rejects.toMatchObject({
      responseBody: {
        data: {
          truncatedKeys: 50,
        },
      },
    });
  });

  it("retries a network connection failure while reading the response body once", async () => {
    let attempts = 0;
    const result = await requestJson({
      url: "https://deploy.example.com/test",
      token: "token",
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return makeResponse({
            body: "",
            text: async () => {
              const error = new TypeError("terminated");
              error.cause = { code: "UND_ERR_SOCKET" };
              throw error;
            },
          });
        }
        return makeResponse({
          body: JSON.stringify({
            code: 200,
            data: { ok: true },
          }),
        });
      },
    });

    expect(result.data).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it("does not retry invalid JSON response bodies", async () => {
    let attempts = 0;
    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        token: "token",
        fetchImpl: async () => {
          attempts += 1;
          return makeResponse({
            body: "not-json",
          });
        },
      }),
    ).rejects.toMatchObject({
      message: "Invalid JSON response from deploy API",
    });
    expect(attempts).toBe(1);
  });

  it("does not retry non-network fetch errors", async () => {
    let attempts = 0;
    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        token: "token",
        fetchImpl: async () => {
          attempts += 1;
          throw new Error("unexpected test failure");
        },
      }),
    ).rejects.toThrow("unexpected test failure");
    expect(attempts).toBe(1);
  });

  it("retries generic network operations once", async () => {
    let attempts = 0;
    const result = await retryNetworkConnection(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("curl: (6) Could not resolve host: demo.example.com");
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("throws when the API envelope code is not 200", async () => {
    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        token: "token",
        fetchImpl: async () =>
          makeResponse({
            body: JSON.stringify({ code: 1220, msg: "Invalid projectId" }),
          }),
      }),
    ).rejects.toMatchObject({
      apiCode: 1220,
      apiMessage: "Invalid projectId",
    });
  });

  it("recognizes invalid projectId errors", () => {
    const error = new DeployApiError("bad project", {
      apiCode: 1220,
      apiMessage: "Invalid projectId",
    });
    expect(isInvalidProjectIdError(error)).toBe(true);
  });

  it("recognizes project-not-found errors", () => {
    const error = new DeployApiError("missing project", {
      apiCode: 3012,
      apiMessage: "PROJECT_NOT_FOUND",
    });
    expect(isProjectNotFoundError(error)).toBe(true);
  });

  it("recognizes deployment-not-found errors", () => {
    const error = new DeployApiError("missing deployment", {
      apiCode: 3011,
      apiMessage: "DEPLOYMENT_NOT_FOUND",
    });
    expect(isDeploymentNotFoundError(error)).toBe(true);
  });

  it("throws when the response body is not valid JSON", async () => {
    await expect(
      requestJson({
        url: "https://deploy.example.com/test",
        token: "token",
        fetchImpl: async () =>
          makeResponse({
            body: "not-json",
          }),
      }),
    ).rejects.toMatchObject({
      message: "Invalid JSON response from deploy API",
    });
  });
});
