import http from "node:http";
import { describe, expect, it } from "vitest";

import {
  isSuccessfulAccessStatus,
  runArbitraryVerifyAccessUrl,
} from "../arbitrary/verifyAccessUrl.js";

function makeResponse(status, body, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: text || (async () => body),
  };
}

describe("arbitrary/verifyAccessUrl", () => {
  it.each([200, 204, 301, 302, 401, 403, 418])(
    "passes when the access URL returns accepted HTTP %i",
    async (status) => {
      const result = await runArbitraryVerifyAccessUrl({
        accessUrl: "https://demo.example.com",
        fetchImpl: async () =>
          makeResponse(status, "response body should be ignored", async () => {
            throw new Error("body should not be read");
          }),
      });

      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.status).toBe(status);
      expect(result.body).toBe("");
      expect(result.summary).toContain(`HTTP ${status}`);
    },
  );

  it("requests only status from the access URL", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return makeResponse(200, "ok", async () => {
          throw new Error("body should not be read");
        });
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe("");
    expect(result.usedDiagnosticRequest).toBe(false);
    expect(result.summary).toContain("HTTP 200");
    expect(requests).toEqual([
      {
        url: "https://demo.example.com",
        init: {
          method: "GET",
          redirect: "manual",
          statusOnly: true,
        },
      },
    ]);
  });

  it("keeps fetch redirects manual so accepted 3xx statuses are verified directly", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return init.redirect === "manual"
          ? makeResponse(302, "")
          : makeResponse(404, "redirect target not found");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.status).toBe(302);
    expect(requests).toEqual([
      {
        url: "https://demo.example.com",
        init: {
          method: "GET",
          redirect: "manual",
          statusOnly: true,
        },
      },
    ]);
  });

  it("does not inspect unhealthy body text when status is HTTP 200", async () => {
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      fetchImpl: async () =>
        makeResponse(200, "Cannot find module 'express'", async () => {
          throw new Error("body should not be read");
        }),
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.summary).toContain("HTTP 200");
  });

  it("does not inspect html redirects or linked assets when status is HTTP 200", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return makeResponse(
          200,
          '<!doctype html><html><head><script>location.replace("/missing.html")</script><link rel="stylesheet" href="/missing.css"></head></html>',
          async () => {
            throw new Error("body should not be read");
          },
        );
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it.each([404, 500, 502])(
    "returns an unverified result when the access URL returns HTTP %i",
    async (status) => {
      const result = await runArbitraryVerifyAccessUrl({
        accessUrl: "https://demo.example.com",
        fetchImpl: async () => makeResponse(status, "failure body"),
      });

      expect(result.success).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.status).toBe(status);
      expect(result.summary).toContain(`HTTP ${status}`);
    },
  );

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

  it("treats the configured restricted access denied status as verified", async () => {
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com",
      accessControl: {
        enabled: true,
        mode: "restricted",
        expectedDeniedStatus: 403,
      },
      fetchImpl: async () => makeResponse(403, "forbidden"),
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.expectedAccessDenied).toBe(true);
    expect(result.status).toBe(403);
    expect(result.usedDiagnosticRequest).toBe(false);
    expect(result.summary).toContain("restricted");
  });

  it("does not buffer large default responses while checking status", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        `<!doctype html><html>${"x".repeat(3 * 1024 * 1024)}</html>`,
      );
    });
    await listen(server);
    try {
      const address = server.address();
      const result = await runArbitraryVerifyAccessUrl({
        accessUrl: `http://127.0.0.1:${address.port}/`,
      });

      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.status).toBe(200);
      expect(result.body).toBe("");
    } finally {
      await closeServer(server);
    }
  });

  it("fails before request when access URL is missing", async () => {
    const result = await runArbitraryVerifyAccessUrl({});

    expect(result.success).toBe(false);
    expect(result.requestAttempted).toBe(false);
    expect(result.message).toContain("Missing required verification input");
  });

  it("classifies successful access statuses without accepting 404 or 5xx", () => {
    expect(isSuccessfulAccessStatus(200)).toBe(true);
    expect(isSuccessfulAccessStatus(302)).toBe(true);
    expect(isSuccessfulAccessStatus(401)).toBe(true);
    expect(isSuccessfulAccessStatus(403)).toBe(true);
    expect(isSuccessfulAccessStatus(404)).toBe(false);
    expect(isSuccessfulAccessStatus(500)).toBe(false);
    expect(isSuccessfulAccessStatus(100)).toBe(false);
    expect(isSuccessfulAccessStatus(0)).toBe(false);
  });
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
