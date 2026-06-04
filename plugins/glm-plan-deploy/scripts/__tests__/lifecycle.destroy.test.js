import { describe, expect, it } from "vitest";

import { runDestroy } from "../lifecycle/destroy.js";

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe("lifecycle/destroy", () => {
  it("returns a success result when the destroy API succeeds", async () => {
    let requestedUrl = null;
    const result = await runDestroy({
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
    expect(result.summary).toContain("Deployment environment destroyed");
    expect(requestedUrl).toBe("https://api.example.com/client/tcb/uninit");
  });
});
