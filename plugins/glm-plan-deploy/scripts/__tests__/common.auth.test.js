import { describe, expect, it } from "vitest";
import path from "path";

import {
  AUTH_TOKEN_MESSAGE,
  AuthConfigurationError,
  assertDeployToken,
  resolveDeployApiBase,
  resolveDeployApiToken,
  resolveDeployContext,
  stripAnthropicSuffix,
} from "../common/auth.js";

describe("common/auth", () => {
  it("strips the /anthropic suffix from anthropic URLs", () => {
    expect(stripAnthropicSuffix("https://example.com/anthropic")).toBe(
      "https://example.com",
    );
  });

  it("prefers ZAI_API_BASE_URL over anthropic base URL", () => {
    expect(
      resolveDeployApiBase({
        ZAI_API_BASE_URL: "https://deploy.example.com",
        ANTHROPIC_BASE_URL: "https://anthropic.example.com/anthropic",
      }),
    ).toBe("https://deploy.example.com");
  });

  it("derives the cc-deploy endpoint from ANTHROPIC_BASE_URL", () => {
    expect(
      resolveDeployApiBase({
        ANTHROPIC_BASE_URL: "https://anthropic.example.com/anthropic",
      }),
    ).toBe("https://anthropic.example.com/cc-deploy");
  });

  it("prefers ZAI_API_TOKEN over ANTHROPIC_AUTH_TOKEN", () => {
    expect(
      resolveDeployApiToken({
        ZAI_API_TOKEN: "zai-token",
        ANTHROPIC_AUTH_TOKEN: "anthropic-token",
      }),
    ).toBe("zai-token");
  });

  it("throws a stable auth configuration error when token is missing", () => {
    expect(() => assertDeployToken("")).toThrow(AuthConfigurationError);
    expect(() => assertDeployToken("")).toThrow(AUTH_TOKEN_MESSAGE);
  });

  it("returns the provided token when present", () => {
    expect(assertDeployToken("token")).toBe("token");
  });

  it("resolves settings paths relative to the provided cwd", () => {
    const result = resolveDeployContext({
      cwd: "/tmp/project",
      env: {
        ANTHROPIC_BASE_URL: "https://anthropic.example.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "token",
      },
    });

    expect(result.baseUrl).toBe("https://anthropic.example.com/cc-deploy");
    expect(result.token).toBe("token");
    expect(result.projectSettingsPath).toBe(
      path.resolve("/tmp/project", ".zai/deploy/tcb-settings.json"),
    );
  });
});
