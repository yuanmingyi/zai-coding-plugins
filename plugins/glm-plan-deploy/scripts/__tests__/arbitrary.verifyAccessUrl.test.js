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

  it("fails verification when same-page static assets resolve to missing root paths", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/app",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (url === "https://demo.example.com/app") {
          return makeResponse(
            200,
            '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><script src="game.js"></script></body></html>',
          );
        }
        return makeResponse(404, "not found");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.summary).toContain("linked script asset failed");
    expect(requests.map((request) => request.url)).toEqual([
      "https://demo.example.com/app",
      "https://demo.example.com/game.js",
    ]);
  });

  it("uses html base href when verifying static assets", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/app",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (url === "https://demo.example.com/app") {
          return makeResponse(
            200,
            '<!doctype html><html><head><base href="/app/"><link href="style.css" rel="stylesheet"></head><body><script src="game.js"></script></body></html>',
          );
        }
        if (url === "https://demo.example.com/app/style.css") {
          return makeResponse(200, "body { color: black; }");
        }
        if (url === "https://demo.example.com/app/game.js") {
          return makeResponse(200, "console.log('ok');");
        }
        return makeResponse(404, "not found");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.assetChecks).toMatchObject([
      {
        type: "script",
        url: "https://demo.example.com/app/game.js",
        status: 200,
      },
      {
        type: "stylesheet",
        url: "https://demo.example.com/app/style.css",
        status: 200,
      },
    ]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://demo.example.com/app",
      "https://demo.example.com/app/game.js",
      "https://demo.example.com/app/style.css",
    ]);
  });

  it("fails verification when a linked script is relayed to index html", async () => {
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/app/",
      fetchImpl: async (url) => {
        if (url === "https://demo.example.com/app/") {
          return makeResponse(
            200,
            '<!doctype html><html><head></head><body><script src="game.js"></script></body></html>',
          );
        }
        return makeResponse(200, "<!doctype html><html>fallback</html>");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.summary).toContain("linked script asset failed");
    expect(result.summary).toContain(
      "returned an HTML document instead of the asset body",
    );
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
