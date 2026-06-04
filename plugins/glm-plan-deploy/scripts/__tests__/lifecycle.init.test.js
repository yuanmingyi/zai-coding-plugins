import { describe, expect, it } from "vitest";

import { runInit } from "../lifecycle/init.js";

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe("lifecycle/init", () => {
  it("returns a success result when the init API succeeds", async () => {
    let requestedUrl = null;
    const result = await runInit({
      env: {
        ZAI_API_TOKEN: "token",
        ZAI_API_BASE_URL: "https://api.example.com",
      },
      fetchImpl: async (url) => {
        requestedUrl = url;
        return makeResponse({ code: 200, data: { ok: true } });
      },
    });

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Deployment environment initialized");
    expect(requestedUrl).toBe("https://api.example.com/client/tcb/init");
  });

  it("returns the auth guidance when the token is missing", async () => {
    const result = await runInit({
      env: {},
      fetchImpl: async () => makeResponse({ code: 200, data: {} }),
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Authentication token not configured");
  });
});
