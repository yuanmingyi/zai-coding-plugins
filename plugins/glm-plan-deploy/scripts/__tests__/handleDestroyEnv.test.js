/**
 * TDD Tests for handleDestroyEnv command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 260-345).
 * It destroys a CloudBase environment using the DestroyEnv API.
 *
 * RED PHASE: These tests should FAIL initially because handleDestroyEnv doesn't exist yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the utils module
vi.mock("../utils.js", () => ({
  initCloudBase: vi.fn(),
  CREDENTIALS_ONLY_VARS: ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY"],
}));

// Import after mocks are set up
import { handleDestroyEnv } from "../handlers/destroyEnv.js";
import { initCloudBase, CREDENTIALS_ONLY_VARS } from "../utils.js";

describe("handleDestroyEnv", () => {
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
        CLOUDBASE_ENV_ID: "existing-env",
      },
    });
  });

  describe("successful environment destruction", () => {
    it("returns success when environment is destroyed with force flag", async () => {
      mockTcbApi.call.mockResolvedValue({});

      const result = await handleDestroyEnv(
        { EnvId: "env-to-destroy" },
        { force: true },
      );

      expect(result.success).toBe(true);
      expect(result.envId).toBe("env-to-destroy");
    });

    it("calls DestroyEnv API with correct parameters", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleDestroyEnv({ EnvId: "env-123" }, { force: true });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "DestroyEnv",
        Param: {
          EnvId: "env-123",
          IsForce: false,
        },
      });
    });

    it("passes IsForce=true when specified in args", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleDestroyEnv(
        { EnvId: "env-123", IsForce: true },
        { force: true },
      );

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "DestroyEnv",
        Param: {
          EnvId: "env-123",
          IsForce: true,
        },
      });
    });
  });

  describe("force flag requirement", () => {
    it("returns error when force flag is not provided", async () => {
      const result = await handleDestroyEnv({ EnvId: "env-123" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("--force");
    });

    it("returns error when force flag is false", async () => {
      const result = await handleDestroyEnv(
        { EnvId: "env-123" },
        { force: false },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("--force");
    });

    it("does not call API when force flag is missing", async () => {
      await handleDestroyEnv({ EnvId: "env-123" });

      expect(mockTcbApi.call).not.toHaveBeenCalled();
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with credentials-only vars", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleDestroyEnv({ EnvId: "env-123" }, { force: true });

      expect(initCloudBase).toHaveBeenCalledWith({
        requiredVars: CREDENTIALS_ONLY_VARS,
        defaultEnvId: "placeholder",
      });
    });

    it("calls commonService with correct TCB API config", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleDestroyEnv({ EnvId: "env-123" }, { force: true });

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "tcb",
        "2018-06-08",
      );
    });
  });

  describe("input validation", () => {
    it("returns error when EnvId is missing", async () => {
      const result = await handleDestroyEnv({}, { force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain("EnvId");
    });

    it("returns error when args is null", async () => {
      const result = await handleDestroyEnv(null, { force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain("EnvId");
    });

    it("returns error when args is undefined", async () => {
      const result = await handleDestroyEnv(undefined, { force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain("EnvId");
    });

    it("returns error when EnvId is empty string", async () => {
      const result = await handleDestroyEnv({ EnvId: "" }, { force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain("EnvId");
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("Environment has resources"));

      const result = await handleDestroyEnv(
        { EnvId: "env-123" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Environment has resources");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: TENCENTCLOUD_SECRETID",
        );
      });

      const result = await handleDestroyEnv(
        { EnvId: "env-123" },
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

      const result = await handleDestroyEnv(
        { EnvId: "env-123" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles ResourceNotFound errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("ResourceNotFound.EnvNotExists"),
      );

      const result = await handleDestroyEnv(
        { EnvId: "non-existent-env" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("ResourceNotFound.EnvNotExists");
    });

    it("handles resource dependency errors", async () => {
      mockTcbApi.call.mockRejectedValue(
        new Error("FailedOperation.ResourceHasExist"),
      );

      const result = await handleDestroyEnv(
        { EnvId: "env-with-resources" },
        { force: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("FailedOperation.ResourceHasExist");
    });
  });

  describe("raw API response", () => {
    it("includes raw API response in result on success", async () => {
      const rawResponse = { RequestId: "req-12345" };
      mockTcbApi.call.mockResolvedValue(rawResponse);

      const result = await handleDestroyEnv(
        { EnvId: "env-123" },
        { force: true },
      );

      expect(result.rawResponse).toEqual(rawResponse);
    });
  });
});

describe("handleDestroyEnv with options", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({}),
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
    await handleDestroyEnv(
      { EnvId: "env-123" },
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

    await handleDestroyEnv({ EnvId: "env-123" }, { force: true, silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleDestroyEnv(
      { EnvId: "env-123" },
      { force: true, silent: false },
    );

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleDestroyEnv with envId as first argument (new API)", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({}),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTcbApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {
        TENCENTCLOUD_SECRETID: "test-id",
        TENCENTCLOUD_SECRETKEY: "test-key",
      },
    });
  });

  it("accepts envId as first string argument", async () => {
    const result = await handleDestroyEnv("env-to-destroy", { force: true });

    expect(result.success).toBe(true);
    expect(result.envId).toBe("env-to-destroy");
  });

  it("calls DestroyEnv API with envId from string argument", async () => {
    await handleDestroyEnv("my-env-123", { force: true });

    expect(mockTcbApi.call).toHaveBeenCalledWith({
      Action: "DestroyEnv",
      Param: {
        EnvId: "my-env-123",
        IsForce: false,
      },
    });
  });

  it("accepts isForce option in options object", async () => {
    await handleDestroyEnv("env-123", { force: true, isForce: true });

    expect(mockTcbApi.call).toHaveBeenCalledWith({
      Action: "DestroyEnv",
      Param: {
        EnvId: "env-123",
        IsForce: true,
      },
    });
  });

  it("returns error when envId string is empty", async () => {
    const result = await handleDestroyEnv("", { force: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain("EnvId");
  });

  it("returns error when envId is whitespace only", async () => {
    const result = await handleDestroyEnv("   ", { force: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain("EnvId");
  });

  it("trims whitespace from envId string", async () => {
    await handleDestroyEnv("  env-with-spaces  ", { force: true });

    expect(mockTcbApi.call).toHaveBeenCalledWith({
      Action: "DestroyEnv",
      Param: {
        EnvId: "env-with-spaces",
        IsForce: false,
      },
    });
  });

  it("still requires force flag when using string envId", async () => {
    const result = await handleDestroyEnv("env-123");

    expect(result.success).toBe(false);
    expect(result.error).toContain("--force");
  });

  it("works with envPath option and string envId", async () => {
    await handleDestroyEnv("env-123", {
      force: true,
      envPath: "/custom/.env",
    });

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/.env",
      }),
    );
  });

  it("works with silent option and string envId", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleDestroyEnv("env-123", { force: true, silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("handleDestroyEnv output formatting", () => {
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
      env: {},
    });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("logs destroying message with EnvId", async () => {
    mockTcbApi.call.mockResolvedValue({});

    await handleDestroyEnv({ EnvId: "my-env-to-destroy" }, { force: true });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("my-env-to-destroy");
  });

  it("logs success message after destruction", async () => {
    mockTcbApi.call.mockResolvedValue({});

    await handleDestroyEnv({ EnvId: "env-123" }, { force: true });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/success|destroyed|initiated/i);
  });

  it("logs IsForce status when true", async () => {
    mockTcbApi.call.mockResolvedValue({});

    await handleDestroyEnv(
      { EnvId: "env-123", IsForce: true },
      { force: true },
    );

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/force|IsForce/i);
  });

  it("logs warning about force flag when missing", async () => {
    await handleDestroyEnv({ EnvId: "env-123" });

    const allErrorCalls = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(allErrorCalls).toContain("--force");
  });
});
