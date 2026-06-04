/**
 * TDD Tests for handleShowMysql command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 264-329).
 * It shows MySQL database instance details in CloudBase.
 *
 * RED PHASE: These tests should FAIL initially because handleShowMysql doesn't exist yet.
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
import { handleShowMysql } from "../handlers/showMysql.js";
import { initCloudBase, DEFAULT_REQUIRED_VARS } from "../utils.js";

describe("handleShowMysql", () => {
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

  describe("successful query", () => {
    it("returns success when MySQL instances are found", async () => {
      mockTcbApi.call.mockResolvedValue({
        ClusterList: [
          { ClusterId: "cluster-1", Alias: "db1", Status: "running" },
        ],
      });

      const result = await handleShowMysql();

      expect(result.success).toBe(true);
      expect(result.data.ClusterList).toHaveLength(1);
    });

    it("calls DescribeCloudBaseRunServerDBCluster API with correct parameters", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterList: [] });

      await handleShowMysql();

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "DescribeCloudBaseRunServerDBCluster",
        Param: {
          EnvId: "test-env-123",
        },
      });
    });

    it("uses CLOUDBASE_ENV_ID as EnvId", async () => {
      initCloudBase.mockReturnValue({
        cloudbase: mockCloudBase,
        env: {
          CLOUDBASE_ENV_ID: "my-custom-env",
        },
      });
      mockTcbApi.call.mockResolvedValue({ ClusterList: [] });

      await handleShowMysql();

      expect(mockTcbApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            EnvId: "my-custom-env",
          }),
        }),
      );
    });

    it("returns empty ClusterList when no instances exist", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterList: [] });

      const result = await handleShowMysql();

      expect(result.success).toBe(true);
      expect(result.data.ClusterList).toHaveLength(0);
    });

    it("returns multiple instances when they exist", async () => {
      mockTcbApi.call.mockResolvedValue({
        ClusterList: [
          { ClusterId: "cluster-1", Alias: "db1", Status: "running" },
          { ClusterId: "cluster-2", Alias: "db2", Status: "running" },
          { ClusterId: "cluster-3", Alias: "db3", Status: "stopped" },
        ],
      });

      const result = await handleShowMysql();

      expect(result.success).toBe(true);
      expect(result.data.ClusterList).toHaveLength(3);
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with default required vars", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterList: [] });

      await handleShowMysql();

      expect(initCloudBase).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredVars: DEFAULT_REQUIRED_VARS,
        }),
      );
    });

    it("calls commonService with correct TCB API config", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterList: [] });

      await handleShowMysql();

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "tcb",
        "2018-06-08",
      );
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("Failed to get MySQL info"));

      const result = await handleShowMysql();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to get MySQL info");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: CLOUDBASE_ENV_ID",
        );
      });

      const result = await handleShowMysql();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleShowMysql();

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles authentication errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleShowMysql();

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });
  });

  describe("raw API response", () => {
    it("includes raw API response in result on success", async () => {
      const rawResponse = {
        ClusterList: [
          { ClusterId: "cluster-1", Alias: "db1", Status: "running" },
        ],
        RequestId: "req-67890",
      };
      mockTcbApi.call.mockResolvedValue(rawResponse);

      const result = await handleShowMysql();

      expect(result.data).toEqual(rawResponse);
    });

    it("includes instance count in result", async () => {
      mockTcbApi.call.mockResolvedValue({
        ClusterList: [{ ClusterId: "cluster-1" }, { ClusterId: "cluster-2" }],
      });

      const result = await handleShowMysql();

      expect(result.data.ClusterList.length).toBe(2);
    });
  });
});

describe("handleShowMysql with options", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({ ClusterList: [] }),
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
    await handleShowMysql({ envPath: "/custom/path/.env" });

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowMysql({ silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowMysql({ silent: false });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleShowMysql output formatting", () => {
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
      env: { CLOUDBASE_ENV_ID: "test-env" },
    });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("logs fetching message", async () => {
    mockTcbApi.call.mockResolvedValue({ ClusterList: [] });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/fetching|mysql/i);
  });

  it("logs instance count when instances exist", async () => {
    mockTcbApi.call.mockResolvedValue({
      ClusterList: [
        { ClusterId: "cluster-1", Alias: "db1", Status: "running" },
        { ClusterId: "cluster-2", Alias: "db2", Status: "running" },
      ],
    });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/2.*instance/i);
  });

  it("logs no instances message when empty", async () => {
    mockTcbApi.call.mockResolvedValue({ ClusterList: [] });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/no.*instance|not.*found/i);
  });

  it("logs cluster details for each instance", async () => {
    mockTcbApi.call.mockResolvedValue({
      ClusterList: [
        { ClusterId: "cluster-abc-123", Alias: "my-db", Status: "running" },
      ],
    });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("cluster-abc-123");
  });

  it("logs instance status", async () => {
    mockTcbApi.call.mockResolvedValue({
      ClusterList: [{ ClusterId: "cluster-1", Status: "running" }],
    });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("running");
  });

  it("logs instance alias when available", async () => {
    mockTcbApi.call.mockResolvedValue({
      ClusterList: [
        { ClusterId: "cluster-1", Alias: "production-db", Status: "running" },
      ],
    });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("production-db");
  });

  it("logs ServerlessStatus when available", async () => {
    mockTcbApi.call.mockResolvedValue({
      ClusterList: [
        {
          ClusterId: "cluster-1",
          Status: "running",
          ServerlessStatus: "resume",
        },
      ],
    });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("ServerlessStatus");
    expect(allLogCalls).toContain("resume");
  });

  it("logs CreateTime when available", async () => {
    mockTcbApi.call.mockResolvedValue({
      ClusterList: [
        {
          ClusterId: "cluster-1",
          Status: "running",
          CreateTime: "2024-01-15T10:30:00Z",
        },
      ],
    });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("CreateTime");
    expect(allLogCalls).toContain("2024-01-15T10:30:00Z");
  });

  it("logs PayMode when available", async () => {
    mockTcbApi.call.mockResolvedValue({
      ClusterList: [
        { ClusterId: "cluster-1", Status: "running", PayMode: "postpaid" },
      ],
    });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("PayMode");
    expect(allLogCalls).toContain("postpaid");
  });

  it("logs all optional fields when all are present", async () => {
    mockTcbApi.call.mockResolvedValue({
      ClusterList: [
        {
          ClusterId: "cluster-full",
          Alias: "full-db",
          Status: "running",
          DbMode: "SERVERLESS",
          ServerlessStatus: "resume",
          CreateTime: "2024-01-15T10:30:00Z",
          PayMode: "postpaid",
        },
      ],
    });

    await handleShowMysql();

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("cluster-full");
    expect(allLogCalls).toContain("full-db");
    expect(allLogCalls).toContain("running");
    expect(allLogCalls).toContain("SERVERLESS");
    expect(allLogCalls).toContain("resume");
    expect(allLogCalls).toContain("2024-01-15T10:30:00Z");
    expect(allLogCalls).toContain("postpaid");
  });
});
