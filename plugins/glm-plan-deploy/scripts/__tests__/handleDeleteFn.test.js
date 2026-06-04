/**
 * TDD Tests for handleDeleteFn command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 102-144).
 * It deletes a CloudBase function by name.
 *
 * RED PHASE: These tests should FAIL initially because handleDeleteFn doesn't exist yet.
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
import { handleDeleteFn } from "../handlers/deleteFn.js";
import { initCloudBase, DEFAULT_REQUIRED_VARS } from "../utils.js";

describe("handleDeleteFn", () => {
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

  describe("successful deletion", () => {
    it("returns success when function is deleted", async () => {
      mockScfApi.call.mockResolvedValue({});

      const result = await handleDeleteFn("my-function");

      expect(result.success).toBe(true);
      expect(result.functionName).toBe("my-function");
    });

    it("calls DeleteFunction API with correct parameters", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleDeleteFn("test-function");

      expect(mockScfApi.call).toHaveBeenCalledWith({
        Action: "DeleteFunction",
        Param: {
          FunctionName: "test-function",
          Namespace: "test-env-123",
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

      await handleDeleteFn("some-function");

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Param: expect.objectContaining({
            Namespace: "my-custom-env",
          }),
        }),
      );
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with default required vars", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleDeleteFn("test-fn");

      expect(initCloudBase).toHaveBeenCalledWith({
        requiredVars: DEFAULT_REQUIRED_VARS,
      });
    });

    it("calls commonService with correct SCF API config", async () => {
      mockScfApi.call.mockResolvedValue({});

      await handleDeleteFn("test-fn");

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "scf",
        "2018-04-16",
      );
    });
  });

  describe("input validation", () => {
    it("returns error when function name is missing", async () => {
      const result = await handleDeleteFn();

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name is empty string", async () => {
      const result = await handleDeleteFn("");

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name is whitespace only", async () => {
      const result = await handleDeleteFn("   ");

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockScfApi.call.mockRejectedValue(new Error("Function not found"));

      const result = await handleDeleteFn("non-existent-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Function not found");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: CLOUDBASE_ENV_ID",
        );
      });

      const result = await handleDeleteFn("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleDeleteFn("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles authentication errors", async () => {
      mockScfApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleDeleteFn("test-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });

    it("handles ResourceNotFound errors", async () => {
      mockScfApi.call.mockRejectedValue(new Error("ResourceNotFound.Function"));

      const result = await handleDeleteFn("missing-fn");

      expect(result.success).toBe(false);
      expect(result.error).toBe("ResourceNotFound.Function");
    });
  });

  describe("raw API response", () => {
    it("includes raw API response in result on success", async () => {
      const rawResponse = { RequestId: "req-12345" };
      mockScfApi.call.mockResolvedValue(rawResponse);

      const result = await handleDeleteFn("test-fn");

      expect(result.rawResponse).toEqual(rawResponse);
    });
  });
});

describe("handleDeleteFn with options", () => {
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
    await handleDeleteFn("test-fn", { envPath: "/custom/path/.env" });

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleDeleteFn("test-fn", { silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleDeleteFn("test-fn", { silent: false });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleDeleteFn output formatting", () => {
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

  it("logs deleting message with function name", async () => {
    mockScfApi.call.mockResolvedValue({});

    await handleDeleteFn("my-awesome-function");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("my-awesome-function"),
    );
  });

  it("logs success message after deletion", async () => {
    mockScfApi.call.mockResolvedValue({});

    await handleDeleteFn("test-function");

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/deleted|success/i);
  });
});

describe("handleDeleteFn with EnvId option", () => {
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
      env: {
        TENCENTCLOUD_SECRETID: "test-id",
        TENCENTCLOUD_SECRETKEY: "test-key",
        CLOUDBASE_ENV_ID: "default-env-from-dotenv",
      },
    });
  });

  it("uses provided EnvId instead of default from .env", async () => {
    await handleDeleteFn("my-function", { EnvId: "custom-env-id" });

    expect(mockScfApi.call).toHaveBeenCalledWith({
      Action: "DeleteFunction",
      Param: {
        FunctionName: "my-function",
        Namespace: "custom-env-id",
      },
    });
  });

  it("falls back to env.CLOUDBASE_ENV_ID when EnvId is not provided", async () => {
    await handleDeleteFn("my-function");

    expect(mockScfApi.call).toHaveBeenCalledWith({
      Action: "DeleteFunction",
      Param: {
        FunctionName: "my-function",
        Namespace: "default-env-from-dotenv",
      },
    });
  });

  it("returns envId in result when custom EnvId is provided", async () => {
    const result = await handleDeleteFn("my-function", { EnvId: "custom-env" });

    expect(result.success).toBe(true);
    expect(result.envId).toBe("custom-env");
  });

  it("works with EnvId and other options combined", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await handleDeleteFn("my-function", {
      EnvId: "custom-env",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(result.envId).toBe("custom-env");
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
