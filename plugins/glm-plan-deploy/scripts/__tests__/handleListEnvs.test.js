/**
 * TDD Tests for handleListEnvs command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 144-204).
 * It lists all CloudBase environments for the authenticated account.
 *
 * RED PHASE: These tests should FAIL initially because handleListEnvs doesn't exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the utils module
vi.mock("../utils.js", () => ({
  initCloudBase: vi.fn(),
  CREDENTIALS_ONLY_VARS: ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY"],
}));

// Import after mocks are set up
import { handleListEnvs } from "../handlers/listEnvs.js";
import { initCloudBase, CREDENTIALS_ONLY_VARS } from "../utils.js";

describe("handleListEnvs", () => {
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

    // Default: initCloudBase returns mock cloudbase
    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {
        TENCENTCLOUD_SECRETID: "test-id",
        TENCENTCLOUD_SECRETKEY: "test-key",
      },
    });
  });

  describe("successful API calls", () => {
    it("returns environment list on success", async () => {
      mockTcbApi.call.mockResolvedValue({
        EnvList: [
          {
            EnvId: "env-123",
            Alias: "production",
            Status: "NORMAL",
            Source: "miniprogram",
            CreateTime: "2024-01-01T00:00:00Z",
            UpdateTime: "2024-01-15T00:00:00Z",
            PackageId: "baas_personal",
          },
        ],
        Total: 1,
      });

      const result = await handleListEnvs();

      expect(result.success).toBe(true);
      expect(result.environments).toHaveLength(1);
      expect(result.environments[0].EnvId).toBe("env-123");
      expect(result.total).toBe(1);
    });

    it("returns multiple environments", async () => {
      mockTcbApi.call.mockResolvedValue({
        EnvList: [
          { EnvId: "env-1", Alias: "dev", Status: "NORMAL" },
          { EnvId: "env-2", Alias: "staging", Status: "NORMAL" },
          { EnvId: "env-3", Alias: "production", Status: "NORMAL" },
        ],
        Total: 3,
      });

      const result = await handleListEnvs();

      expect(result.success).toBe(true);
      expect(result.environments).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it("returns empty list when no environments exist", async () => {
      mockTcbApi.call.mockResolvedValue({
        EnvList: [],
        Total: 0,
      });

      const result = await handleListEnvs();

      expect(result.success).toBe(true);
      expect(result.environments).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("handles missing EnvList in response (defaults to empty array)", async () => {
      mockTcbApi.call.mockResolvedValue({
        Total: 0,
      });

      const result = await handleListEnvs();

      expect(result.success).toBe(true);
      expect(result.environments).toEqual([]);
    });

    it("handles missing Total in response (uses EnvList length)", async () => {
      mockTcbApi.call.mockResolvedValue({
        EnvList: [
          { EnvId: "env-1", Status: "NORMAL" },
          { EnvId: "env-2", Status: "NORMAL" },
        ],
      });

      const result = await handleListEnvs();

      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with credentials-only vars", async () => {
      mockTcbApi.call.mockResolvedValue({ EnvList: [], Total: 0 });

      await handleListEnvs();

      expect(initCloudBase).toHaveBeenCalledWith({
        requiredVars: CREDENTIALS_ONLY_VARS,
        defaultEnvId: "placeholder",
      });
    });

    it("calls commonService with correct TCB API config", async () => {
      mockTcbApi.call.mockResolvedValue({ EnvList: [], Total: 0 });

      await handleListEnvs();

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "tcb",
        "2018-06-08",
      );
    });

    it("calls DescribeEnvs action with empty params", async () => {
      mockTcbApi.call.mockResolvedValue({ EnvList: [], Total: 0 });

      await handleListEnvs();

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "DescribeEnvs",
        Param: {},
      });
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("API request failed"));

      const result = await handleListEnvs();

      expect(result.success).toBe(false);
      expect(result.error).toBe("API request failed");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: TENCENTCLOUD_SECRETID",
        );
      });

      const result = await handleListEnvs();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleListEnvs();

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles network timeout errors", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("ETIMEDOUT"));

      const result = await handleListEnvs();

      expect(result.success).toBe(false);
      expect(result.error).toBe("ETIMEDOUT");
    });

    it("handles authentication errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleListEnvs();

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });
  });

  describe("raw API response", () => {
    it("includes raw API response in result", async () => {
      const rawResponse = {
        EnvList: [{ EnvId: "env-1", Status: "NORMAL" }],
        Total: 1,
        RequestId: "req-12345",
      };
      mockTcbApi.call.mockResolvedValue(rawResponse);

      const result = await handleListEnvs();

      expect(result.rawResponse).toEqual(rawResponse);
    });
  });

  describe("environment status filtering", () => {
    it("returns environments with different statuses", async () => {
      mockTcbApi.call.mockResolvedValue({
        EnvList: [
          { EnvId: "env-1", Status: "NORMAL" },
          { EnvId: "env-2", Status: "UNAVAILABLE" },
          { EnvId: "env-3", Status: "INITIALIZING" },
        ],
        Total: 3,
      });

      const result = await handleListEnvs();

      expect(result.success).toBe(true);
      expect(result.environments).toHaveLength(3);

      const statuses = result.environments.map((e) => e.Status);
      expect(statuses).toContain("NORMAL");
      expect(statuses).toContain("UNAVAILABLE");
      expect(statuses).toContain("INITIALIZING");
    });
  });
});

describe("handleListEnvs with options", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({ EnvList: [], Total: 0 }),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTcbApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {},
    });
  });

  it("accepts custom envPath option", async () => {
    await handleListEnvs({ envPath: "/custom/path/.env" });

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleListEnvs({ silent: true });

    // When silent, no console.log should be called
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    mockTcbApi.call.mockResolvedValue({
      EnvList: [{ EnvId: "env-1", Status: "NORMAL" }],
      Total: 1,
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleListEnvs({ silent: false });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleListEnvs output formatting", () => {
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
      env: {},
    });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("logs fetching message", async () => {
    mockTcbApi.call.mockResolvedValue({ EnvList: [], Total: 0 });

    await handleListEnvs();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Fetching all environments"),
    );
  });

  it("logs environment count", async () => {
    mockTcbApi.call.mockResolvedValue({
      EnvList: [
        { EnvId: "env-1", Status: "NORMAL" },
        { EnvId: "env-2", Status: "NORMAL" },
      ],
      Total: 2,
    });

    await handleListEnvs();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("2 environment"),
    );
  });

  it('logs "no environments found" message when list is empty', async () => {
    mockTcbApi.call.mockResolvedValue({ EnvList: [], Total: 0 });

    await handleListEnvs();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("No environments found"),
    );
  });

  it("logs environment details including EnvId", async () => {
    mockTcbApi.call.mockResolvedValue({
      EnvList: [
        { EnvId: "my-special-env-123", Alias: "prod", Status: "NORMAL" },
      ],
      Total: 1,
    });

    await handleListEnvs();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("my-special-env-123");
  });

  it("logs environment Alias", async () => {
    mockTcbApi.call.mockResolvedValue({
      EnvList: [
        { EnvId: "env-1", Alias: "my-production-alias", Status: "NORMAL" },
      ],
      Total: 1,
    });

    await handleListEnvs();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("my-production-alias");
  });

  it("logs status with appropriate icon for NORMAL status", async () => {
    mockTcbApi.call.mockResolvedValue({
      EnvList: [{ EnvId: "env-1", Status: "NORMAL" }],
      Total: 1,
    });

    await handleListEnvs();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    // Should have a check mark or similar for NORMAL status
    expect(allLogCalls).toMatch(/NORMAL/);
  });
});
