/**
 * TDD Tests for handleDeleteMysql command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 331-403).
 * It deletes a MySQL database instance in CloudBase.
 *
 * RED PHASE: These tests should FAIL initially because handleDeleteMysql doesn't exist yet.
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
import { handleDeleteMysql } from "../handlers/deleteMysql.js";
import { initCloudBase, DEFAULT_REQUIRED_VARS } from "../utils.js";

describe("handleDeleteMysql", () => {
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

  describe("successful deletion", () => {
    it("returns success when MySQL instance is deleted with force flag", async () => {
      mockTcbApi.call.mockResolvedValue({ RequestId: "req-12345" });

      const result = await handleDeleteMysql(
        { ClusterId: "cluster-123" },
        { force: true },
      );

      expect(result.success).toBe(true);
    });

    it("calls DeleteCloudBaseRunServerDBCluster API with correct parameters", async () => {
      mockTcbApi.call.mockResolvedValue({ RequestId: "req-123" });

      await handleDeleteMysql(
        { ClusterId: "cluster-to-delete" },
        { force: true },
      );

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "DeleteCloudBaseRunServerDBCluster",
        Param: {
          EnvId: "test-env-123",
          ClusterId: "cluster-to-delete",
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
      mockTcbApi.call.mockResolvedValue({ RequestId: "req-123" });

      await handleDeleteMysql({ ClusterId: "cluster-123" }, { force: true });

      expect(mockTcbApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            EnvId: "my-custom-env",
          }),
        }),
      );
    });

    it("returns ClusterId in result", async () => {
      mockTcbApi.call.mockResolvedValue({ RequestId: "req-123" });

      const result = await handleDeleteMysql(
        { ClusterId: "deleted-cluster-id" },
        { force: true },
      );

      expect(result.success).toBe(true);
      expect(result.clusterId).toBe("deleted-cluster-id");
    });
  });

  describe("force flag validation", () => {
    it("returns error when force flag is not provided", async () => {
      const result = await handleDeleteMysql({ ClusterId: "cluster-123" });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/force|required|safety/i);
    });

    it("returns error when force flag is false", async () => {
      const result = await handleDeleteMysql(
        { ClusterId: "cluster-123" },
        { force: false },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/force|required|safety/i);
    });

    it("does not call API when force flag is missing", async () => {
      await handleDeleteMysql({ ClusterId: "cluster-123" });

      expect(mockTcbApi.call).not.toHaveBeenCalled();
    });
  });

  describe("ClusterId validation", () => {
    it("returns error when ClusterId is missing", async () => {
      const result = await handleDeleteMysql({}, { force: true });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ClusterId|required/i);
    });

    it("returns error when ClusterId is empty string", async () => {
      const result = await handleDeleteMysql(
        { ClusterId: "" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ClusterId|required/i);
    });

    it("returns error when ClusterId is whitespace only", async () => {
      const result = await handleDeleteMysql(
        { ClusterId: "   " },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ClusterId|required/i);
    });

    it("returns error when args is undefined", async () => {
      const result = await handleDeleteMysql(undefined, { force: true });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ClusterId|required/i);
    });

    it("does not call API when ClusterId is missing", async () => {
      await handleDeleteMysql({}, { force: true });

      expect(mockTcbApi.call).not.toHaveBeenCalled();
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with default required vars", async () => {
      mockTcbApi.call.mockResolvedValue({ RequestId: "req-123" });

      await handleDeleteMysql({ ClusterId: "cluster-123" }, { force: true });

      expect(initCloudBase).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredVars: DEFAULT_REQUIRED_VARS,
        }),
      );
    });

    it("calls commonService with correct TCB API config", async () => {
      mockTcbApi.call.mockResolvedValue({ RequestId: "req-123" });

      await handleDeleteMysql({ ClusterId: "cluster-123" }, { force: true });

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "tcb",
        "2018-06-08",
      );
    });

    it("does not call initCloudBase when validation fails", async () => {
      await handleDeleteMysql({ ClusterId: "cluster-123" }, { force: false });

      expect(initCloudBase).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("Failed to delete cluster"));

      const result = await handleDeleteMysql(
        { ClusterId: "cluster-123" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to delete cluster");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: CLOUDBASE_ENV_ID",
        );
      });

      const result = await handleDeleteMysql(
        { ClusterId: "cluster-123" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleDeleteMysql(
        { ClusterId: "cluster-123" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles authentication errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleDeleteMysql(
        { ClusterId: "cluster-123" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });

    it("handles ResourceNotFound errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("ResourceNotFound.ClusterNotFound"),
      );

      const result = await handleDeleteMysql(
        { ClusterId: "non-existent" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("ResourceNotFound.ClusterNotFound");
    });
  });

  describe("raw API response", () => {
    it("includes raw API response in result on success", async () => {
      const rawResponse = { RequestId: "req-67890" };
      mockTcbApi.call.mockResolvedValue(rawResponse);

      const result = await handleDeleteMysql(
        { ClusterId: "cluster-123" },
        { force: true },
      );

      expect(result.data).toEqual(rawResponse);
    });
  });
});

describe("handleDeleteMysql with options", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({ RequestId: "req-123" }),
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
    await handleDeleteMysql(
      { ClusterId: "cluster-123" },
      { force: true, envPath: "/custom/path/.env" },
    );

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleDeleteMysql(
      { ClusterId: "cluster-123" },
      { force: true, silent: true },
    );

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleDeleteMysql(
      { ClusterId: "cluster-123" },
      { force: true, silent: false },
    );

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleDeleteMysql output formatting", () => {
  let mockCloudBase;
  let mockTcbApi;
  let consoleLogSpy;
  let consoleErrorSpy;

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
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("logs deleting message with ClusterId", async () => {
    mockTcbApi.call.mockResolvedValue({ RequestId: "req-123" });

    await handleDeleteMysql(
      { ClusterId: "cluster-to-delete" },
      { force: true },
    );

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("cluster-to-delete");
  });

  it("logs success message after deletion", async () => {
    mockTcbApi.call.mockResolvedValue({ RequestId: "req-123" });

    await handleDeleteMysql({ ClusterId: "cluster-123" }, { force: true });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/success|deleted|initiated/i);
  });

  it("logs error message when force flag is missing", async () => {
    await handleDeleteMysql({ ClusterId: "cluster-123" });

    const allErrorCalls = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(allErrorCalls).toMatch(/force|required|safety/i);
  });

  it("logs error message when ClusterId is missing", async () => {
    await handleDeleteMysql({}, { force: true });

    const allErrorCalls = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(allErrorCalls).toMatch(/ClusterId|required/i);
  });
});
