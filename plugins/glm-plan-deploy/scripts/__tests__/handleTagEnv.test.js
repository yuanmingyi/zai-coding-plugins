/**
 * TDD Tests for handleTagEnv command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 347-441).
 * It adds resource tags to a CloudBase environment using the TagResources API.
 *
 * RED PHASE: These tests should FAIL initially because handleTagEnv doesn't exist yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the utils module
vi.mock("../utils.js", () => ({
  initCloudBase: vi.fn(),
  CREDENTIALS_ONLY_VARS: ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY"],
}));

// Import after mocks are set up
import { handleTagEnv } from "../handlers/tagEnv.js";
import { initCloudBase, CREDENTIALS_ONLY_VARS } from "../utils.js";

describe("handleTagEnv", () => {
  let mockCloudBase;
  let mockTagApi;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock CloudBase instance with commonService
    mockTagApi = {
      call: vi.fn(),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTagApi),
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

  describe("successful environment tagging", () => {
    it("returns success when tags are applied", async () => {
      mockTagApi.call.mockResolvedValue({});

      const result = await handleTagEnv({
        EnvId: "my-env",
        Tags: [{ Key: "project", Value: "demo" }],
      });

      expect(result.success).toBe(true);
      expect(result.envId).toBe("my-env");
    });

    it("calls TagResources API with correct parameters", async () => {
      mockTagApi.call.mockResolvedValue({});

      await handleTagEnv({
        EnvId: "env-123",
        Tags: [
          { Key: "project", Value: "demo" },
          { Key: "team", Value: "dev" },
        ],
      });

      expect(mockTagApi.call).toHaveBeenCalledWith({
        Action: "TagResources",
        Param: {
          Resource: "qcs::tcb:::env/env-123",
          Tags: [
            { TagKey: "project", TagValue: "demo" },
            { TagKey: "team", TagValue: "dev" },
          ],
        },
      });
    });

    it("constructs correct resource six-segment format", async () => {
      mockTagApi.call.mockResolvedValue({});

      await handleTagEnv({
        EnvId: "my-special-env",
        Tags: [{ Key: "env", Value: "prod" }],
      });

      expect(mockTagApi.call).toHaveBeenCalledWith({
        Action: "TagResources",
        Param: expect.objectContaining({
          Resource: "qcs::tcb:::env/my-special-env",
        }),
      });
    });

    it("transforms tag format from Key/Value to TagKey/TagValue", async () => {
      mockTagApi.call.mockResolvedValue({});

      await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "myKey", Value: "myValue" }],
      });

      expect(mockTagApi.call).toHaveBeenCalledWith({
        Action: "TagResources",
        Param: expect.objectContaining({
          Tags: [{ TagKey: "myKey", TagValue: "myValue" }],
        }),
      });
    });

    it("handles multiple tags", async () => {
      mockTagApi.call.mockResolvedValue({});

      await handleTagEnv({
        EnvId: "env-123",
        Tags: [
          { Key: "tag1", Value: "value1" },
          { Key: "tag2", Value: "value2" },
          { Key: "tag3", Value: "value3" },
        ],
      });

      expect(mockTagApi.call).toHaveBeenCalledWith({
        Action: "TagResources",
        Param: expect.objectContaining({
          Tags: [
            { TagKey: "tag1", TagValue: "value1" },
            { TagKey: "tag2", TagValue: "value2" },
            { TagKey: "tag3", TagValue: "value3" },
          ],
        }),
      });
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with credentials-only vars", async () => {
      mockTagApi.call.mockResolvedValue({});

      await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(initCloudBase).toHaveBeenCalledWith({
        requiredVars: CREDENTIALS_ONLY_VARS,
        defaultEnvId: "placeholder",
      });
    });

    it("calls commonService with correct TAG API config", async () => {
      mockTagApi.call.mockResolvedValue({});

      await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "tag",
        "2018-08-13",
      );
    });
  });

  describe("input validation", () => {
    it("returns error when EnvId is missing", async () => {
      const result = await handleTagEnv({
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("EnvId");
    });

    it("returns error when Tags is missing", async () => {
      const result = await handleTagEnv({
        EnvId: "env-123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tags");
    });

    it("returns error when Tags is empty array", async () => {
      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tags");
    });

    it("returns error when Tags is not an array", async () => {
      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: "not-an-array",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tags");
    });

    it("returns error when args is null", async () => {
      const result = await handleTagEnv(null);

      expect(result.success).toBe(false);
      expect(result.error).toContain("EnvId");
    });

    it("returns error when args is undefined", async () => {
      const result = await handleTagEnv();

      expect(result.success).toBe(false);
      expect(result.error).toContain("EnvId");
    });

    it("returns error when tag is missing Key property", async () => {
      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Value: "v" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Key");
    });

    it("returns error when tag is missing Value property", async () => {
      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Value");
    });

    it("returns error when tag Key is not a string", async () => {
      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: 123, Value: "v" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Key");
    });

    it("returns error when tag Value is not a string", async () => {
      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k", Value: 123 }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Value");
    });

    it("validates all tags in the array", async () => {
      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [
          { Key: "valid", Value: "tag" },
          { Key: "invalid" }, // Missing Value
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Value");
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockTagApi.call.mockRejectedValue(new Error("Resource not found"));

      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Resource not found");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: TENCENTCLOUD_SECRETID",
        );
      });

      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles tag quota exceeded errors", async () => {
      mockTagApi.call.mockRejectedValue(
        new Error("QuotaExceeded.TagNumPerResource"),
      );

      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("QuotaExceeded.TagNumPerResource");
    });

    it("handles invalid resource errors", async () => {
      mockTagApi.call.mockRejectedValue(
        new Error("InvalidParameterValue.ResourceNotExist"),
      );

      const result = await handleTagEnv({
        EnvId: "non-existent-env",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("InvalidParameterValue.ResourceNotExist");
    });
  });

  describe("raw API response", () => {
    it("includes raw API response in result on success", async () => {
      const rawResponse = { RequestId: "req-12345" };
      mockTagApi.call.mockResolvedValue(rawResponse);

      const result = await handleTagEnv({
        EnvId: "env-123",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(result.rawResponse).toEqual(rawResponse);
    });
  });

  describe("resource field in result", () => {
    it("includes constructed resource string in result", async () => {
      mockTagApi.call.mockResolvedValue({});

      const result = await handleTagEnv({
        EnvId: "my-env-id",
        Tags: [{ Key: "k", Value: "v" }],
      });

      expect(result.resource).toBe("qcs::tcb:::env/my-env-id");
    });
  });
});

describe("handleTagEnv with options", () => {
  let mockCloudBase;
  let mockTagApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTagApi = {
      call: vi.fn().mockResolvedValue({}),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTagApi),
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {},
    });
  });

  it("accepts custom envPath option", async () => {
    await handleTagEnv(
      { EnvId: "env-123", Tags: [{ Key: "k", Value: "v" }] },
      { envPath: "/custom/path/.env" },
    );

    expect(initCloudBase).toHaveBeenCalledWith(
      expect.objectContaining({
        envPath: "/custom/path/.env",
      }),
    );
  });

  it("accepts silent option to suppress console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleTagEnv(
      { EnvId: "env-123", Tags: [{ Key: "k", Value: "v" }] },
      { silent: true },
    );

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleTagEnv(
      { EnvId: "env-123", Tags: [{ Key: "k", Value: "v" }] },
      { silent: false },
    );

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleTagEnv output formatting", () => {
  let mockCloudBase;
  let mockTagApi;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTagApi = {
      call: vi.fn(),
    };
    mockCloudBase = {
      commonService: vi.fn().mockReturnValue(mockTagApi),
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

  it("logs tagging message with EnvId", async () => {
    mockTagApi.call.mockResolvedValue({});

    await handleTagEnv({
      EnvId: "my-env-to-tag",
      Tags: [{ Key: "k", Value: "v" }],
    });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("my-env-to-tag");
  });

  it("logs tag key=value pairs", async () => {
    mockTagApi.call.mockResolvedValue({});

    await handleTagEnv({
      EnvId: "env-123",
      Tags: [
        { Key: "project", Value: "demo" },
        { Key: "team", Value: "dev" },
      ],
    });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("project=demo");
    expect(allLogCalls).toContain("team=dev");
  });

  it("logs success message after tagging", async () => {
    mockTagApi.call.mockResolvedValue({});

    await handleTagEnv({
      EnvId: "env-123",
      Tags: [{ Key: "k", Value: "v" }],
    });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toMatch(/success|tagged/i);
  });

  it("logs resource string in output", async () => {
    mockTagApi.call.mockResolvedValue({});

    await handleTagEnv({
      EnvId: "env-123",
      Tags: [{ Key: "k", Value: "v" }],
    });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("qcs::tcb:::env/env-123");
  });
});
