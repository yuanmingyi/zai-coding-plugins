/**
 * TDD Tests for handleShowLog command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 296-323).
 * It shows function logs using the SCF GetFunctionLogs API.
 *
 * RED PHASE: These tests should FAIL initially because handleShowLog doesn't exist yet.
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
import { handleShowLog } from "../handlers/showLog.js";
import { initCloudBase, DEFAULT_REQUIRED_VARS } from "../utils.js";

describe("handleShowLog", () => {
  let mockCloudBase;
  let mockScfApi;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock CloudBase instance with commonService
    mockScfApi = {
      call: vi.fn(),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockScfApi),
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

  describe("successful log retrieval", () => {
    it("returns success when logs are fetched", async () => {
      const mockLogData = {
        TotalCount: 2,
        Data: [
          {
            RequestId: "req-001",
            StartTime: "2024-01-28T10:00:00Z",
            Duration: 150,
            MemUsage: 52428800,
            BillDuration: 200,
            RetCode: 0,
            RetMsg: "OK",
            Log: "Function executed successfully",
          },
          {
            RequestId: "req-002",
            StartTime: "2024-01-28T09:00:00Z",
            Duration: 100,
            MemUsage: 41943040,
            BillDuration: 100,
            RetCode: 0,
            RetMsg: "OK",
            Log: "Another execution",
          },
        ],
      };
      mockScfApi.call.mockResolvedValue(mockLogData);

      const result = await handleShowLog("my-function");

      expect(result.success).toBe(true);
      expect(result.functionName).toBe("my-function");
      expect(result.data).toEqual(mockLogData);
    });

    it("calls GetFunctionLogs API with correct parameters", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function");

      expect(mockScfApi.call).toHaveBeenCalledWith({
        Action: "GetFunctionLogs",
        Param: {
          FunctionName: "test-function",
          Namespace: "test-env-123",
          Limit: 100,
          Offset: 0,
          Order: "desc",
        },
      });
    });

    it("uses CLOUDBASE_ENV_ID as namespace", async () => {
      initCloudBase.mockReturnValue({
        cloudbase: mockCloudBase,
        env: {
          CLOUDBASE_ENV_ID: "my-custom-env",
        },
      });
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("some-function");

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Namespace: "my-custom-env",
          }),
        }),
      );
    });
  });

  describe("options handling", () => {
    it("passes Limit option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function", { Limit: 50 });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Limit: 50,
          }),
        }),
      );
    });

    it("passes Offset option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function", { Offset: 100 });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Offset: 100,
          }),
        }),
      );
    });

    it("passes Order option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function", { Order: "asc" });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Order: "asc",
          }),
        }),
      );
    });

    it("passes OrderBy option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function", { OrderBy: "duration" });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            OrderBy: "duration",
          }),
        }),
      );
    });

    it("passes Qualifier option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function", { Qualifier: "$PUBLISHED" });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Qualifier: "$PUBLISHED",
          }),
        }),
      );
    });

    it("passes FunctionRequestId option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function", { FunctionRequestId: "req-12345" });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            FunctionRequestId: "req-12345",
          }),
        }),
      );
    });

    it("passes StartTime option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function", {
        StartTime: "2024-01-01T00:00:00Z",
      });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            StartTime: "2024-01-01T00:00:00Z",
          }),
        }),
      );
    });

    it("passes EndTime option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function", { EndTime: "2024-01-31T23:59:59Z" });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            EndTime: "2024-01-31T23:59:59Z",
          }),
        }),
      );
    });

    it("uses default Limit=100 when not provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function");

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Limit: 100,
          }),
        }),
      );
    });

    it("uses default Offset=0 when not provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function");

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Offset: 0,
          }),
        }),
      );
    });

    it("uses default Order=desc when not provided", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-function");

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Order: "desc",
          }),
        }),
      );
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with default required vars", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-fn");

      expect(initCloudBase).toHaveBeenCalledWith({
        requiredVars: DEFAULT_REQUIRED_VARS,
      });
    });

    it("calls commonService with correct SCF API config", async () => {
      mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

      await handleShowLog("test-fn");

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "scf",
        "2018-04-16",
      );
    });
  });

  describe("input validation", () => {
    it("returns error when function name is missing", async () => {
      const result = await handleShowLog();

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name is empty string", async () => {
      const result = await handleShowLog("");

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name is whitespace only", async () => {
      const result = await handleShowLog("   ");

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name starts with --", async () => {
      const result = await handleShowLog("--args");

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockScfApi.call.mockRejectedValue(new Error("Function not found"));

      const result = await handleShowLog("non-existent-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Function not found");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: CLOUDBASE_ENV_ID",
        );
      });

      const result = await handleShowLog("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleShowLog("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles authentication errors", async () => {
      mockScfApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleShowLog("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });

    it("handles ResourceNotFound errors", async () => {
      mockScfApi.call.mockRejectedValue(new Error("ResourceNotFound.Function"));

      const result = await handleShowLog("missing-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("ResourceNotFound.Function");
    });
  });

  describe("data field in result", () => {
    it("includes log data in result on success", async () => {
      const logData = {
        TotalCount: 1,
        Data: [
          {
            RequestId: "req-001",
            StartTime: "2024-01-28T10:00:00Z",
            Duration: 150,
            MemUsage: 52428800,
            BillDuration: 200,
            RetCode: 0,
            RetMsg: "OK",
            Log: "Function executed",
          },
        ],
      };
      mockScfApi.call.mockResolvedValue(logData);

      const result = await handleShowLog("test-fn");

      expect(result.data).toEqual(logData);
    });

    it("handles empty log data", async () => {
      const emptyLogData = { TotalCount: 0, Data: [] };
      mockScfApi.call.mockResolvedValue(emptyLogData);

      const result = await handleShowLog("test-fn");

      expect(result.success).toBe(true);
      expect(result.data.Data).toHaveLength(0);
      expect(result.data.TotalCount).toBe(0);
    });

    it("includes TotalCount in result data", async () => {
      const logData = {
        TotalCount: 500,
        Data: [{ RequestId: "req-001" }],
      };
      mockScfApi.call.mockResolvedValue(logData);

      const result = await handleShowLog("test-fn");

      expect(result.data.TotalCount).toBe(500);
    });
  });
});

describe("handleShowLog with options", () => {
  let mockCloudBase;
  let mockScfApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScfApi = {
      call: vi.fn().mockResolvedValue({ TotalCount: 0, Data: [] }),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockScfApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: { CLOUDBASE_ENV_ID: "test-env" },
    });
  });

  it("accepts custom envPath option", async () => {
    await handleShowLog("test-fn", { envPath: "/custom/path/.env" });

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowLog("test-fn", { silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowLog("test-fn", { silent: false });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleShowLog output formatting", () => {
  let mockCloudBase;
  let mockScfApi;
  let consoleLogSpy;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScfApi = {
      call: vi.fn(),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockScfApi),
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

  it("logs fetching message with function name", async () => {
    mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

    await handleShowLog("my-awesome-function");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("my-awesome-function"),
    );
  });

  it("logs message when no logs found", async () => {
    mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

    await handleShowLog("test-function");

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/no log|0/i);
  });

  it("logs count when logs are found", async () => {
    mockScfApi.call.mockResolvedValue({
      TotalCount: 5,
      Data: [
        {
          RequestId: "req-1",
          StartTime: "2024-01-28T10:00:00Z",
          Duration: 100,
          MemUsage: 52428800,
          BillDuration: 100,
          RetCode: 0,
          RetMsg: "OK",
        },
      ],
    });

    await handleShowLog("test-function");

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/5|1/);
  });

  it("formats log entries with request details", async () => {
    mockScfApi.call.mockResolvedValue({
      TotalCount: 1,
      Data: [
        {
          RequestId: "req-12345",
          StartTime: "2024-01-28T10:00:00Z",
          Duration: 150,
          MemUsage: 52428800,
          BillDuration: 200,
          RetCode: 0,
          RetMsg: "OK",
          Log: "Test log output",
        },
      ],
    });

    await handleShowLog("test-function");

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("req-12345");
  });
});

describe("handleShowLog edge cases", () => {
  let mockCloudBase;
  let mockScfApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScfApi = {
      call: vi.fn(),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockScfApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: { CLOUDBASE_ENV_ID: "test-env" },
    });
  });

  it("trims whitespace from function name", async () => {
    mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

    await handleShowLog("  test-function  ");

    expect(mockScfApi.call).toHaveBeenCalledWith(
      expect.objectContaining({
        Param: expect.objectContaining({
          FunctionName: "test-function",
        }),
      }),
    );
  });

  it("handles function names with special characters", async () => {
    mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

    await handleShowLog("my-function_v2.0");

    expect(mockScfApi.call).toHaveBeenCalledWith(
      expect.objectContaining({
        Param: expect.objectContaining({
          FunctionName: "my-function_v2.0",
        }),
      }),
    );
  });

  it("returns functionName as null when validation fails", async () => {
    const result = await handleShowLog("");

    expect(result.functionName).toBeNull();
  });

  it("handles logs with missing optional fields", async () => {
    mockScfApi.call.mockResolvedValue({
      TotalCount: 1,
      Data: [
        {
          RequestId: "req-001",
          StartTime: "2024-01-28T10:00:00Z",
          Duration: 100,
          MemUsage: 52428800,
          BillDuration: 100,
          RetCode: 0,
          RetMsg: "OK",
          // Log field is missing
        },
      ],
    });

    const result = await handleShowLog("test-fn", { silent: true });

    expect(result.success).toBe(true);
    expect(result.data.Data[0].Log).toBeUndefined();
  });

  it("does not include optional params when not provided", async () => {
    mockScfApi.call.mockResolvedValue({ TotalCount: 0, Data: [] });

    await handleShowLog("test-function");

    const callArgs = mockScfApi.call.mock.calls[0][0];
    expect(callArgs.Param.OrderBy).toBeUndefined();
    expect(callArgs.Param.Qualifier).toBeUndefined();
    expect(callArgs.Param.FunctionRequestId).toBeUndefined();
    expect(callArgs.Param.StartTime).toBeUndefined();
    expect(callArgs.Param.EndTime).toBeUndefined();
  });
});

describe("handleShowLog with EnvId option", () => {
  let mockCloudBase;
  let mockScfApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScfApi = {
      call: vi.fn().mockResolvedValue({ Data: [], TotalCount: 0 }),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockScfApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {
        TENCENTCLOUD_SECRETID: "test-id",
        TENCENTCLOUD_SECRETKEY: "test-key",
        CLOUDBASE_ENV_ID: "default-env-from-dotenv",
      },
    });
  });

  it("uses provided EnvId instead of default from .env", async () => {
    await handleShowLog("my-function", {
      EnvId: "custom-env-id",
      silent: true,
    });

    expect(mockScfApi.call).toHaveBeenCalledWith({
      Action: "GetFunctionLogs",
      Param: expect.objectContaining({
        FunctionName: "my-function",
        Namespace: "custom-env-id",
      }),
    });
  });

  it("falls back to env.CLOUDBASE_ENV_ID when EnvId is not provided", async () => {
    await handleShowLog("my-function", { silent: true });

    expect(mockScfApi.call).toHaveBeenCalledWith({
      Action: "GetFunctionLogs",
      Param: expect.objectContaining({
        FunctionName: "my-function",
        Namespace: "default-env-from-dotenv",
      }),
    });
  });

  it("returns envId in result when custom EnvId is provided", async () => {
    const result = await handleShowLog("my-function", {
      EnvId: "custom-env",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(result.envId).toBe("custom-env");
  });

  it("works with EnvId and Limit options combined", async () => {
    await handleShowLog("my-function", {
      EnvId: "custom-env",
      Limit: 50,
      silent: true,
    });

    expect(mockScfApi.call).toHaveBeenCalledWith({
      Action: "GetFunctionLogs",
      Param: expect.objectContaining({
        Namespace: "custom-env",
        Limit: 50,
      }),
    });
  });
});
