import { describe, expect, it } from "vitest";

import { runArbitraryVerifyAccessUrl } from "../arbitrary/verifyAccessUrl.js";

function makeResponse(status, body, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: text || (async () => body),
  };
}

describe("arbitrary/verifyAccessUrl", () => {
  it("passes a healthy response without diagnostic retry", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return makeResponse(200, "ok");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.usedDiagnosticRequest).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it("retries an access URL network connection failure once", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (requests.length === 1) {
          const error = new TypeError("fetch failed");
          error.cause = { code: "ECONNRESET" };
          throw error;
        }
        return makeResponse(200, "ok");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.usedDiagnosticRequest).toBe(false);
    expect(requests).toHaveLength(2);
  });

  it("retries an access URL body-read network failure once", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (requests.length === 1) {
          return makeResponse(200, "", async () => {
            const error = new TypeError("terminated");
            error.cause = { code: "UND_ERR_SOCKET" };
            throw error;
          });
        }
        return makeResponse(200, "ok");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.usedDiagnosticRequest).toBe(false);
    expect(requests).toHaveLength(2);
  });

  it("falls back to the diagnostic GET body when the initial request fails", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (requests.length === 1) {
          return makeResponse(502, "bad gateway");
        }
        return makeResponse(200, "Cannot find module 'express'");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.usedDiagnosticRequest).toBe(true);
    expect(result.body).toContain("Cannot find module");
    expect(requests[1].init.method).toBe("GET");
    expect(requests[1].init.body).toBe("{}");
  });

  it("treats the configured restricted access denied status as verified", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      accessControl: {
        enabled: true,
        mode: "restricted",
        expectedDeniedStatus: 403,
      },
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return makeResponse(403, "forbidden");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.expectedAccessDenied).toBe(true);
    expect(result.status).toBe(403);
    expect(result.usedDiagnosticRequest).toBe(false);
    expect(result.summary).toContain("restricted");
    expect(requests).toHaveLength(1);
  });
});
