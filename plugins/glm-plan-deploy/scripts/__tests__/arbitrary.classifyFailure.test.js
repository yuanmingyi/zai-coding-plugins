import { describe, expect, it } from "vitest";

import { runArbitraryClassifyFailure } from "../arbitrary/classifyFailure.js";

describe("arbitrary/classifyFailure", () => {
  it("classifies package manager mismatch as retryable", async () => {
    const result = await runArbitraryClassifyFailure({
      detailLog: "/bin/sh: apk: not found",
    });

    expect(result.success).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.category).toBe("BASE_IMAGE_PACKAGE_MANAGER_MISMATCH");
  });

  it("classifies missing package files as retryable", async () => {
    const result = await runArbitraryClassifyFailure({
      detailLog:
        "COPY failed: file not found in build context or excluded by .dockerignore",
    });

    expect(result.success).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.category).toBe("PACKAGE_MISSING_FILE");
  });

  it("classifies runtime startup failures from verification output", async () => {
    const result = await runArbitraryClassifyFailure({
      verificationBody: "Error: Cannot find module 'express'",
    });

    expect(result.success).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.category).toBe("RUNTIME_DEPENDENCY_MISSING");
  });

  it("classifies port binding failures as retryable", async () => {
    const result = await runArbitraryClassifyFailure({
      stepMessage:
        "Health check failed because the process exited before accepting connections on port 9000",
    });

    expect(result.success).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.category).toBe("PORT_CONFIGURATION");
  });

  it("classifies SCF Creating update failures with actionable platform context", async () => {
    const result = await runArbitraryClassifyFailure({
      errorMessage: "当前函数处于Creating状态，无法进行此操作，请稍后重试。",
      detailLog:
        "TencentCloudApiException: 当前函数处于Creating状态，无法进行此操作，请稍后重试。 [service=scf, action=UpdateFunctionCode, region=ap-shanghai, code=FailedOperation.UpdateFunctionCode, requestId=req-1]",
    });

    expect(result.success).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.category).toBe("REMOTE_FUNCTION_CREATING");
    expect(result.suggestedFix).toContain("function creation");
  });

  describe("MISSING_BUILD_TOOL", () => {
    const TOOLS = [
      { name: "pnpm", log: "/bin/sh: 1: pnpm: not found" },
      { name: "yarn", log: "sh: yarn: command not found" },
      { name: "corepack", log: "/bin/sh: 1: corepack: not found" },
      { name: "python3", log: "/bin/sh: python3: not found" },
      { name: "poetry", log: "bash: poetry: command not found" },
      { name: "pipenv", log: "/bin/sh: pipenv: not found" },
      { name: "cargo", log: "sh: 1: cargo: not found" },
      { name: "mvn", log: "/bin/sh: 1: mvn: not found" },
      { name: "gradle", log: "bash: gradle: command not found" },
    ];

    for (const { name, log } of TOOLS) {
      it(`flags missing ${name} as MISSING_BUILD_TOOL (not retryable, suggests image-side install)`, async () => {
        const result = await runArbitraryClassifyFailure({ detailLog: log });
        expect(result.success).toBe(true);
        expect(result.category).toBe("MISSING_BUILD_TOOL");
        expect(result.retryable).toBe(false);
        expect(result.suggestedFix).toContain(name);
        // Must steer the agent toward a renderer fix, NOT a hand-patched
        // Dockerfile (that would be silently overwritten by the renderer
        // on the next deploy anyway).
        expect(result.suggestedFix.toLowerCase()).toMatch(
          /renderer|dockerfile\.build|install/,
        );
      });
    }

    it("takes precedence over the generic RUNTIME_DEPENDENCY_MISSING `command not found` matcher", async () => {
      // The generic catch-all `command not found` regex would otherwise
      // classify this as a retryable runtime-dep failure — but a missing
      // BUILD tool is not the same as a missing runtime dep, and retrying
      // would just hit the same wall.
      const result = await runArbitraryClassifyFailure({
        detailLog:
          "RUN pnpm install --frozen-lockfile\n/bin/sh: pnpm: not found",
      });
      expect(result.category).toBe("MISSING_BUILD_TOOL");
      expect(result.retryable).toBe(false);
    });

    it("does not misfire on app-runtime 'module not found' messages", async () => {
      const result = await runArbitraryClassifyFailure({
        verificationBody: "Error: Cannot find module 'express'",
      });
      expect(result.category).not.toBe("MISSING_BUILD_TOOL");
    });
  });
});
