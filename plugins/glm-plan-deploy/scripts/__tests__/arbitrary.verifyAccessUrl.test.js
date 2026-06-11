import { describe, expect, it } from "vitest";
import http from "node:http";

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
    expect(requests[0].init.maxBodyBytes).toBe(65536);
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

  it("fails verification when the access page redirects to a missing same-origin html page", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        if (url === "https://demo.example.com/") {
          return makeResponse(
            200,
            '<!doctype html><html><head><script>location.replace(new URL("daily_report.html", location.href).href)</script></head><body>Redirecting</body></html>',
          );
        }
        if (url === "https://demo.example.com/daily_report.html") {
          return makeResponse(
            404,
            "<html><head><title>404 Not Found</title></head><body>not found</body></html>",
          );
        }
        return makeResponse(500, "unexpected");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.summary).toContain("HTML redirect target failed");
    expect(result.summary).toContain(
      "https://demo.example.com/daily_report.html returned HTTP 404",
    );
    expect(requests.map((request) => request.url)).toEqual([
      "https://demo.example.com/",
      "https://demo.example.com/daily_report.html",
    ]);
  });

  it("fails verification when same-origin html redirects loop", async () => {
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/",
      fetchImpl: async (url) => {
        if (url === "https://demo.example.com/") {
          return makeResponse(
            200,
            '<!doctype html><html><head><script>location.replace("/loop.html")</script></head></html>',
          );
        }
        if (url === "https://demo.example.com/loop.html") {
          return makeResponse(
            200,
            '<!doctype html><html><head><script>location.replace("/loop.html")</script></head></html>',
          );
        }
        return makeResponse(500, "unexpected");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.summary).toContain("HTML redirect loop");
  });

  it("treats partial content as healthy when verifying html redirect targets", async () => {
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/",
      fetchImpl: async (url) => {
        if (url === "https://demo.example.com/") {
          return makeResponse(
            200,
            '<!doctype html><html><head><script>location.replace("/target.html")</script></head></html>',
          );
        }
        if (url === "https://demo.example.com/target.html") {
          return makeResponse(206, "<!doctype html><html>ok</html>");
        }
        return makeResponse(500, "unexpected");
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("caps default verification response reads even when the server ignores range requests", async () => {
    const server = http.createServer((request, response) => {
      expect(request.headers.range).toBe("bytes=0-65535");
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
      expect(result.body.length).toBeLessThanOrEqual(65536);
    } finally {
      await closeServer(server);
    }
  });

  it("does not follow delayed meta refresh as an immediate redirect shell", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return makeResponse(
          200,
          '<!doctype html><html><head><meta http-equiv="refresh" content="600; url=/logout"></head><body>Dashboard</body></html>',
        );
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      "https://demo.example.com/",
    ]);
  });

  it("does not follow conditional inline script redirects as redirect shells", async () => {
    const requests = [];
    const result = await runArbitraryVerifyAccessUrl({
      accessUrl: "https://demo.example.com/",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return makeResponse(
          200,
          '<!doctype html><html><head><script>if (false) location.replace("/missing.html");</script></head><body>Dashboard</body></html>',
        );
      },
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      "https://demo.example.com/",
    ]);
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
