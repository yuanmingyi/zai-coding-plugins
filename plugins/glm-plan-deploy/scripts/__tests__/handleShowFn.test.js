/**
 * TDD Tests for handleShowFn command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 325-352).
 * It shows function details using the SCF GetFunction API.
 *
 * RED PHASE: These tests should FAIL initially because handleShowFn doesn't exist yet.
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
import { handleShowFn } from "../handlers/showFn.js";
import { initCloudBase, DEFAULT_REQUIRED_VARS } from "../utils.js";

describe("handleShowFn", () => {
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

  describe("successful function details retrieval", () => {
    it("returns success when function details are fetched", async () => {
      const mockFunctionData = {
        FunctionName: "my-function",
        Runtime: "Nodejs18.15",
        Handler: "index.main",
        MemorySize: 256,
        Timeout: 60,
        Status: "Active",
      };
      mockScfApi.call.mockResolvedValue(mockFunctionData);

      const result = await handleShowFn("my-function");

      expect(result.success).toBe(true);
      expect(result.functionName).toBe("my-function");
      expect(result.data).toEqual(mockFunctionData);
    });

    it("calls GetFunction API with correct parameters", async () => {
      mockScfApi.call.mockResolvedValue({ FunctionName: "test-function" });

      await handleShowFn("test-function");

      expect(mockScfApi.call).toHaveBeenCalledWith({
        Action: "GetFunction",
        Param: {
          FunctionName: "test-function",
          Namespace: "test-env-123",
          ShowCode: "FALSE",
          Qualifier: "$LATEST",
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
      mockScfApi.call.mockResolvedValue({});

      await handleShowFn("some-function");

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
    it("passes ShowCode option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleShowFn("test-function", { ShowCode: "TRUE" });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            ShowCode: "TRUE",
          }),
        }),
      );
    });

    it("passes Qualifier option to API when provided", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleShowFn("test-function", { Qualifier: "$PUBLISHED" });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Qualifier: "$PUBLISHED",
          }),
        }),
      );
    });

    it("uses default ShowCode=FALSE when not provided", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleShowFn("test-function");

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            ShowCode: "FALSE",
          }),
        }),
      );
    });

    it("uses default Qualifier=$LATEST when not provided", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleShowFn("test-function");

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Qualifier: "$LATEST",
          }),
        }),
      );
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with default required vars", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleShowFn("test-fn");

      expect(initCloudBase).toHaveBeenCalledWith({
        requiredVars: DEFAULT_REQUIRED_VARS,
      });
    });

    it("calls commonService with correct SCF API config", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleShowFn("test-fn");

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "scf",
        "2018-04-16",
      );
    });
  });

  describe("input validation", () => {
    it("returns error when function name is missing", async () => {
      const result = await handleShowFn();

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name is empty string", async () => {
      const result = await handleShowFn("");

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name is whitespace only", async () => {
      const result = await handleShowFn("   ");

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name starts with --", async () => {
      const result = await handleShowFn("--args");

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockScfApi.call.mockRejectedValue(new Error("Function not found"));

      const result = await handleShowFn("non-existent-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Function not found");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: CLOUDBASE_ENV_ID",
        );
      });

      const result = await handleShowFn("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleShowFn("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles authentication errors", async () => {
      mockScfApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleShowFn("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });

    it("handles ResourceNotFound errors", async () => {
      mockScfApi.call.mockRejectedValue(new Error("ResourceNotFound.Function"));

      const result = await handleShowFn("missing-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("ResourceNotFound.Function");
    });
  });

  describe("data field in result", () => {
    it("includes function data in result on success", async () => {
      const functionData = {
        FunctionName: "test-fn",
        Runtime: "Nodejs18.15",
        Handler: "index.main",
        MemorySize: 512,
        Timeout: 30,
        Status: "Active",
        Description: "Test function",
      };
      mockScfApi.call.mockResolvedValue(functionData);

      const result = await handleShowFn("test-fn");

      expect(result.data).toEqual(functionData);
    });

    it("returns complete function configuration data", async () => {
      const fullFunctionData = {
        FunctionName: "test-fn",
        Runtime: "Python3.9",
        Handler: "main.handler",
        MemorySize: 256,
        Timeout: 60,
        Status: "Active",
        Description: "A test function",
        Environment: {
          Variables: [{ Key: "PORT", Value: "9000" }],
        },
        VpcConfig: {
          VpcId: "vpc-123",
          SubnetId: "subnet-456",
        },
      };
      mockScfApi.call.mockResolvedValue(fullFunctionData);

      const result = await handleShowFn("test-fn");

      expect(result.data.Runtime).toBe("Python3.9");
      expect(result.data.Environment).toBeDefined();
      expect(result.data.VpcConfig).toBeDefined();
    });
  });
});

describe("handleShowFn with options", () => {
  let mockCloudBase;
  let mockScfApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScfApi = {
      call: vi.fn().mockResolvedValue({}),
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
    await handleShowFn("test-fn", { envPath: "/custom/path/.env" });

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowFn("test-fn", { silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleShowFn("test-fn", { silent: false });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleShowFn output formatting", () => {
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
    mockScfApi.call.mockResolvedValue({});

    await handleShowFn("my-awesome-function");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("my-awesome-function"),
    );
  });

  it("logs function details as JSON", async () => {
    const functionData = { FunctionName: "test-function", Status: "Active" };
    mockScfApi.call.mockResolvedValue(functionData);

    await handleShowFn("test-function");

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("test-function");
  });
});

describe("handleShowFn edge cases", () => {
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
    mockScfApi.call.mockResolvedValue({});

    await handleShowFn("  test-function  ");

    expect(mockScfApi.call).toHaveBeenCalledWith(
      expect.objectContaining({
        Param: expect.objectContaining({
          FunctionName: "test-function",
        }),
      }),
    );
  });

  it("handles function names with special characters", async () => {
    mockScfApi.call.mockResolvedValue({});

    await handleShowFn("my-function_v2.0");

    expect(mockScfApi.call).toHaveBeenCalledWith(
      expect.objectContaining({
        Param: expect.objectContaining({
          FunctionName: "my-function_v2.0",
        }),
      }),
    );
  });

  it("returns functionName as null when validation fails", async () => {
    const result = await handleShowFn("");

    expect(result.functionName).toBeNull();
  });
});

describe("handleShowFn with EnvId option", () => {
  let mockCloudBase;
  let mockScfApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScfApi = {
      call: vi.fn().mockResolvedValue({ FunctionName: "test-fn" }),
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
    await handleShowFn("my-function", { EnvId: "custom-env-id", silent: true });

    expect(mockScfApi.call).toHaveBeenCalledWith({
      Action: "GetFunction",
      Param: expect.objectContaining({
        FunctionName: "my-function",
        Namespace: "custom-env-id",
      }),
    });
  });

  it("falls back to env.CLOUDBASE_ENV_ID when EnvId is not provided", async () => {
    await handleShowFn("my-function", { silent: true });

    expect(mockScfApi.call).toHaveBeenCalledWith({
      Action: "GetFunction",
      Param: expect.objectContaining({
        FunctionName: "my-function",
        Namespace: "default-env-from-dotenv",
      }),
    });
  });

  it("returns envId in result when custom EnvId is provided", async () => {
    const result = await handleShowFn("my-function", {
      EnvId: "custom-env",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(result.envId).toBe("custom-env");
  });

  it("works with EnvId and ShowCode options combined", async () => {
    await handleShowFn("my-function", {
      EnvId: "custom-env",
      ShowCode: "TRUE",
      silent: true,
    });

    expect(mockScfApi.call).toHaveBeenCalledWith({
      Action: "GetFunction",
      Param: expect.objectContaining({
        Namespace: "custom-env",
        ShowCode: "TRUE",
      }),
    });
  });
});
