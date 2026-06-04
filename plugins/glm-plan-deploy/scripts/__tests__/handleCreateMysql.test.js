/**
 * TDD Tests for handleCreateMysql command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 198-262).
 * It creates a MySQL database instance in CloudBase.
 *
 * RED PHASE: These tests should FAIL initially because handleCreateMysql doesn't exist yet.
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
import { handleCreateMysql } from "../handlers/createMysql.js";
import { initCloudBase, DEFAULT_REQUIRED_VARS } from "../utils.js";

describe("handleCreateMysql", () => {
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

  describe("successful creation", () => {
    it("returns success when MySQL instance is created", async () => {
      mockTcbApi.call.mockResolvedValue({
        ClusterId: "cluster-12345",
        RequestId: "req-67890",
      });

      const result = await handleCreateMysql({ Alias: "my-database" });

      expect(result.success).toBe(true);
      expect(result.data.ClusterId).toBe("cluster-12345");
    });

    it("calls CreateCloudBaseRunServerDBCluster API with correct parameters", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

      await handleCreateMysql({ Alias: "test-db" });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateCloudBaseRunServerDBCluster",
        Param: {
          EnvId: "test-env-123",
          DbMode: "SERVERLESS",
          Alias: "test-db",
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
      mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

      await handleCreateMysql({});

      expect(mockTcbApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            EnvId: "my-custom-env",
          }),
        }),
      );
    });

    it("merges additional config parameters", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

      await handleCreateMysql({
        Alias: "my-db",
        Password: "secret123",
        CustomParam: "value",
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateCloudBaseRunServerDBCluster",
        Param: {
          EnvId: "test-env-123",
          DbMode: "SERVERLESS",
          Alias: "my-db",
          Password: "secret123",
          CustomParam: "value",
        },
      });
    });

    it("works with empty config (uses defaults)", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

      const result = await handleCreateMysql({});

      expect(result.success).toBe(true);
      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateCloudBaseRunServerDBCluster",
        Param: {
          EnvId: "test-env-123",
          DbMode: "SERVERLESS",
        },
      });
    });

    it("works when called without arguments", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

      const result = await handleCreateMysql();

      expect(result.success).toBe(true);
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with default required vars", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

      await handleCreateMysql({});

      expect(initCloudBase).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredVars: DEFAULT_REQUIRED_VARS,
        }),
      );
    });

    it("calls commonService with correct TCB API config", async () => {
      mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

      await handleCreateMysql({});

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "tcb",
        "2018-06-08",
      );
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("Database creation failed"));

      const result = await handleCreateMysql({ Alias: "test-db" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Database creation failed");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: CLOUDBASE_ENV_ID",
        );
      });

      const result = await handleCreateMysql({ Alias: "test-db" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleCreateMysql({});

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles authentication errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleCreateMysql({});

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });

    it("handles quota exceeded errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("LimitExceeded.DatabaseQuota"),
      );

      const result = await handleCreateMysql({});

      expect(result.success).toBe(false);
      expect(result.error).toBe("LimitExceeded.DatabaseQuota");
    });
  });

  describe("raw API response", () => {
    it("includes raw API response in result on success", async () => {
      const rawResponse = {
        ClusterId: "cluster-12345",
        RequestId: "req-67890",
      };
      mockTcbApi.call.mockResolvedValue(rawResponse);

      const result = await handleCreateMysql({});

      expect(result.data).toEqual(rawResponse);
    });

    it("includes ClusterId in result data", async () => {
      mockTcbApi.call.mockResolvedValue({
        ClusterId: "my-cluster-id",
        RequestId: "req-123",
      });

      const result = await handleCreateMysql({});

      expect(result.data.ClusterId).toBe("my-cluster-id");
    });
  });
});

describe("handleCreateMysql with options", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({ ClusterId: "cluster-123" }),
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
    await handleCreateMysql({}, { envPath: "/custom/path/.env" });

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCreateMysql({}, { silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCreateMysql({}, { silent: false });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleCreateMysql output formatting", () => {
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

  it("logs creating message", async () => {
    mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

    await handleCreateMysql({ Alias: "my-database" });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/creating|mysql/i);
  });

  it("logs Alias when provided", async () => {
    mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

    await handleCreateMysql({ Alias: "my-special-db" });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("my-special-db");
  });

  it("logs success message after creation", async () => {
    mockTcbApi.call.mockResolvedValue({ ClusterId: "cluster-123" });

    await handleCreateMysql({});

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/success|created/i);
  });

  it("logs ClusterId on success", async () => {
    mockTcbApi.call.mockResolvedValue({ ClusterId: "my-cluster-id-123" });

    await handleCreateMysql({});

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("my-cluster-id-123");
  });
});
