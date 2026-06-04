/**
 * TDD Tests for handleShowEnv command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 677-741).
 * It shows detailed information about the current CloudBase environment.
 *
 * RED PHASE: These tests should FAIL initially because handleShowEnv doesn't exist yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the utils module
vi.mock("../utils.js", () => ({
  initCloudBase: vi.fn(),
  DEFAULT_REQUIRED_VARS: [
    "TENCENTCLOUD_SECRETID",
    "TENCENTCLOUD_SECRETKEY",
    "CLOUDBASE_ENV_ID",
  ],
}));

// Import after mocks are set up
import { handleShowEnv } from "../handlers/showEnv.js";
import { initCloudBase, DEFAULT_REQUIRED_VARS } from "../utils.js";

describe("handleShowEnv", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock CloudBase instance with commonService
    mockTcbApi = {
      call: vi.fn(),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTcbApi),
    };

    // Default: initCloudBase returns mock cloudbase with env
    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {
        TENCENTCLOUD_SECRETID: "test-id",
        TENCENTCLOUD_SECRETKEY: "test-key",
        CLOUDBASE_ENV_ID: "test-env-123",
      },
    });
  });

  describe("successful API calls", () => {
    it("returns environment info on success", async () => {
      mockTcbApi.call.mockImplementation(async ({ Action }) => {
        if (Action === "DescribeEnvs") {
          return {
            EnvList: [
              {
                EnvId: "test-env-123",
                Alias: "production",
                Status: "NORMAL",
                Source: "miniprogram",
                CreateTime: "2024-01-01T00:00:00Z",
                UpdateTime: "2024-01-15T00:00:00Z",
                PackageId: "baas_personal",
              },
            ],
            Total: 1,
          };
        }
        if (Action === "DescribeAuthDomains") {
          return {
            Domains: [
              {
                Domain: "test-env-123.web.app",
                Status: "ENABLE",
              },
            ],
          };
        }
        return {};
      });

      const result = await handleShowEnv();

      expect(result.success).toBe(true);
      expect(result.envInfo).toBeDefined();
      expect(result.envInfo.EnvId).toBe("test-env-123");
      expect(result.envInfo.Status).toBe("NORMAL");
    });

    it("returns auth domains info", async () => {
      mockTcbApi.call.mockImplementation(async ({ Action }) => {
        if (Action === "DescribeEnvs") {
          return {
            EnvList: [{ EnvId: "test-env", Status: "NORMAL" }],
          };
        }
        if (Action === "DescribeAuthDomains") {
          return {
            Domains: [
              { Domain: "example.com", Status: "ENABLE" },
              { Domain: "test.example.com", Status: "DISABLE" },
            ],
          };
        }
        return {};
      });

      const result = await handleShowEnv();

      expect(result.success).toBe(true);
      expect(result.domains).toHaveLength(2);
      expect(result.domains[0].Domain).toBe("example.com");
      expect(result.domains[0].Status).toBe("ENABLE");
    });

    it("handles environment with no domains", async () => {
      mockTcbApi.call.mockImplementation(async ({ Action }) => {
        if (Action === "DescribeEnvs") {
          return {
            EnvList: [{ EnvId: "test-env", Status: "NORMAL" }],
          };
        }
        if (Action === "DescribeAuthDomains") {
          return { Domains: [] };
        }
        return {};
      });

      const result = await handleShowEnv();

      expect(result.success).toBe(true);
      expect(result.domains).toEqual([]);
    });

    it("handles missing Domains in auth response", async () => {
      mockTcbApi.call.mockImplementation(async ({ Action }) => {
        if (Action === "DescribeEnvs") {
          return {
            EnvList: [{ EnvId: "test-env", Status: "NORMAL" }],
          };
        }
        if (Action === "DescribeAuthDomains") {
          return {};
        }
        return {};
      });

      const result = await handleShowEnv();

      expect(result.success).toBe(true);
      expect(result.domains).toEqual([]);
    });

    it("handles empty EnvList response", async () => {
      mockTcbApi.call.mockImplementation(async ({ Action }) => {
        if (Action === "DescribeEnvs") {
          return { EnvList: [] };
        }
        if (Action === "DescribeAuthDomains") {
          return { Domains: [] };
        }
        return {};
      });

      const result = await handleShowEnv();

      expect(result.success).toBe(true);
      expect(result.envInfo).toBeNull();
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with default required vars", async () => {
      mockTcbApi.call.mockResolvedValue({ EnvList: [], Domains: [] });

      await handleShowEnv();

      expect(initCloudBase).toHaveBeenCalledWith({
        requiredVars: DEFAULT_REQUIRED_VARS,
      });
    });

    it("calls commonService with correct TCB API config", async () => {
      mockTcbApi.call.mockResolvedValue({ EnvList: [] });

      await handleShowEnv();

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "tcb",
        "2018-06-08",
      );
    });

    it("calls DescribeEnvs with correct EnvId", async () => {
      mockTcbApi.call.mockResolvedValue({ EnvList: [] });

      await handleShowEnv();

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "DescribeEnvs",
        Param: {
          EnvId: "test-env-123",
        },
      });
    });

    it("calls DescribeAuthDomains with correct EnvId", async () => {
      mockTcbApi.call.mockImplementation(async ({ Action }) => {
        if (Action === "DescribeEnvs") {
          return { EnvList: [{ EnvId: "test-env-123" }] };
        }
        return { Domains: [] };
      });

      await handleShowEnv();

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "DescribeAuthDomains",
        Param: {
          EnvId: "test-env-123",
        },
      });
    });
  });

  describe("error handling", () => {
    it("returns error result when DescribeEnvs fails", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("API request failed"));

      const result = await handleShowEnv();

      expect(result.success).toBe(false);
      expect(result.error).toBe("API request failed");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: CLOUDBASE_ENV_ID",
        );
      });

      const result = await handleShowEnv();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleShowEnv();

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("continues successfully when DescribeAuthDomains fails", async () => {
      mockTcbApi.call.mockImplementation(async ({ Action }) => {
        if (Action === "DescribeEnvs") {
          return { EnvList: [{ EnvId: "test-env", Status: "NORMAL" }] };
        }
        if (Action === "DescribeAuthDomains") {
          throw new Error("Auth domains API failed");
        }
        return {};
      });

      const result = await handleShowEnv();

      // Should still succeed, but with domain error
      expect(result.success).toBe(true);
      expect(result.envInfo).toBeDefined();
      expect(result.domainsError).toBe("Auth domains API failed");
    });

    it("handles authentication errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleShowEnv();

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });
  });

  describe("raw API responses", () => {
    it("includes raw API responses in result", async () => {
      const envResponse = {
        EnvList: [{ EnvId: "test-env", Status: "NORMAL" }],
        RequestId: "env-req-123",
      };
      const domainsResponse = {
        Domains: [{ Domain: "example.com", Status: "ENABLE" }],
        RequestId: "domain-req-456",
      };

      mockTcbApi.call.mockImplementation(async ({ Action }) => {
        if (Action === "DescribeEnvs") return envResponse;
        if (Action === "DescribeAuthDomains") return domainsResponse;
        return {};
      });

      const result = await handleShowEnv();

      expect(result.rawEnvResponse).toEqual(envResponse);
      expect(result.rawDomainsResponse).toEqual(domainsResponse);
    });
  });
});

describe("handleShowEnv with options", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({ EnvList: [], Domains: [] }),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTcbApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: { CLOUDBASE_ENV_ID: "test-env" },
    });
  });

  it("accepts custom envPath option", async () => {
    await handleShowEnv({ envPath: "/custom/path/.env" });

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowEnv({ silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    mockTcbApi.call.mockImplementation(async ({ Action }) => {
      if (Action === "DescribeEnvs") {
        return { EnvList: [{ EnvId: "test-env", Status: "NORMAL" }] };
      }
      return { Domains: [] };
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowEnv({ silent: false });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleShowEnv with envId argument", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({ EnvList: [], Domains: [] }),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTcbApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {
        CLOUDBASE_ENV_ID: "default-env-from-dotenv",
        TENCENTCLOUD_SECRETID: "test-id",
        TENCENTCLOUD_SECRETKEY: "test-key",
      },
    });
  });

  it("uses provided envId instead of default from .env", async () => {
    mockTcbApi.call.mockImplementation(async ({ Action }) => {
      if (Action === "DescribeEnvs") {
        return { EnvList: [{ EnvId: "custom-env-id", Status: "NORMAL" }] };
      }
      return { Domains: [] };
    });

    const result = await handleShowEnv({ envId: "custom-env-id" });

    expect(result.success).toBe(true);
    // Verify DescribeEnvs was called with the custom envId
    expect(mockTcbApi.call).toHaveBeenCalledWith({
      Action: "DescribeEnvs",
      Param: {
        EnvId: "custom-env-id",
      },
    });
  });

  it("uses provided envId for DescribeAuthDomains API", async () => {
    mockTcbApi.call.mockImplementation(async ({ Action }) => {
      if (Action === "DescribeEnvs") {
        return { EnvList: [{ EnvId: "custom-env-id", Status: "NORMAL" }] };
      }
      if (Action === "DescribeAuthDomains") {
        return {
          Domains: [{ Domain: "custom.example.com", Status: "ENABLE" }],
        };
      }
      return {};
    });

    await handleShowEnv({ envId: "custom-env-id" });

    expect(mockTcbApi.call).toHaveBeenCalledWith({
      Action: "DescribeAuthDomains",
      Param: {
        EnvId: "custom-env-id",
      },
    });
  });

  it("falls back to env.CLOUDBASE_ENV_ID when envId is not provided", async () => {
    mockTcbApi.call.mockResolvedValue({ EnvList: [], Domains: [] });

    await handleShowEnv();

    expect(mockTcbApi.call).toHaveBeenCalledWith({
      Action: "DescribeEnvs",
      Param: {
        EnvId: "default-env-from-dotenv",
      },
    });
  });

  it("returns envId in result when custom envId is provided", async () => {
    mockTcbApi.call.mockImplementation(async ({ Action }) => {
      if (Action === "DescribeEnvs") {
        return { EnvList: [{ EnvId: "my-custom-env", Status: "NORMAL" }] };
      }
      return { Domains: [] };
    });

    const result = await handleShowEnv({ envId: "my-custom-env" });

    expect(result.success).toBe(true);
    expect(result.envId).toBe("my-custom-env");
  });

  it("returns default envId in result when envId is not provided", async () => {
    mockTcbApi.call.mockResolvedValue({ EnvList: [], Domains: [] });

    const result = await handleShowEnv();

    expect(result.envId).toBe("default-env-from-dotenv");
  });

  it("logs the correct envId when using custom envId", async () => {
    mockTcbApi.call.mockImplementation(async ({ Action }) => {
      if (Action === "DescribeEnvs") {
        return { EnvList: [{ EnvId: "custom-env-id", Status: "NORMAL" }] };
      }
      return { Domains: [] };
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowEnv({ envId: "custom-env-id", silent: false });

    const allLogCalls = consoleSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("custom-env-id");

    consoleSpy.mockRestore();
  });

  it("works with envId and other options combined", async () => {
    mockTcbApi.call.mockImplementation(async ({ Action }) => {
      if (Action === "DescribeEnvs") {
        return { EnvList: [{ EnvId: "combined-test-env", Status: "NORMAL" }] };
      }
      return { Domains: [] };
    });

    const result = await handleShowEnv({
      envId: "combined-test-env",
      envPath: "/custom/path/.env",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(result.envId).toBe("combined-test-env");
    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });
});

describe("handleShowEnv output formatting", () => {
  let mockCloudBase;
  let mockTcbApi;
  let consoleLogSpy;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn(),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTcbApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: { CLOUDBASE_ENV_ID: "test-env-123" },
    });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("logs fetching message", async () => {
    mockTcbApi.call.mockResolvedValue({ EnvList: [] });

    await handleShowEnv();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Fetching environment info"),
    );
  });

  it("logs domain information when available", async () => {
    mockTcbApi.call.mockImplementation(async ({ Action }) => {
      if (Action === "DescribeEnvs") {
        return { EnvList: [{ EnvId: "test-env", Status: "NORMAL" }] };
      }
      if (Action === "DescribeAuthDomains") {
        return {
          Domains: [{ Domain: "my-app.web.app", Status: "ENABLE" }],
        };
      }
      return {};
    });

    await handleShowEnv();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("my-app.web.app");
  });

  it('logs "no domains configured" when list is empty', async () => {
    mockTcbApi.call.mockImplementation(async ({ Action }) => {
      if (Action === "DescribeEnvs") {
        return { EnvList: [{ EnvId: "test-env", Status: "NORMAL" }] };
      }
      return { Domains: [] };
    });

    await handleShowEnv();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/[Nn]o.*domains/i);
  });
});
