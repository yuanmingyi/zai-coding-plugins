/**
 * TDD Tests for handleCreateEnv command handler
 *
 * This handler is extracted from the main() function in deploy.js (lines 132-258).
 * It creates a new CloudBase environment using the CreateBillDeal API.
 *
 * RED PHASE: These tests should FAIL initially because handleCreateEnv doesn't exist yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the utils module
vi.mock("../utils.js", () => ({
  initCloudBase: vi.fn(),
  CREDENTIALS_ONLY_VARS: ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY"],
}));

// Import after mocks are set up
import { handleCreateEnv } from "../handlers/createEnv.js";
import { initCloudBase, CREDENTIALS_ONLY_VARS } from "../utils.js";

describe("handleCreateEnv", () => {
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

  describe("successful environment creation", () => {
    it("returns success when environment is created", async () => {
      mockTcbApi.call.mockResolvedValue({
        TranId: "tran-123",
        EnvId: "new-env-456",
      });

      const result = await handleCreateEnv({
        PackageId: "baas_personal",
      });

      expect(result.success).toBe(true);
      expect(result.tranId).toBe("tran-123");
      expect(result.envId).toBe("new-env-456");
    });

    it("calls CreateBillDeal API with correct parameters", async () => {
      mockTcbApi.call.mockResolvedValue({
        TranId: "tran-123",
        EnvId: "new-env-456",
      });

      await handleCreateEnv({
        PackageId: "baas_personal",
        Alias: "my-new-env",
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          PackageId: "baas_personal",
          Alias: "my-new-env",
          DealType: "purchase",
          ProductType: "tcb-baas",
          CreateAndPay: true,
          TimeSpan: 1,
          TimeUnit: "d",
          Source: "qcloud",
        }),
      });
    });

    it("includes default ResourceTypes when not specified", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          ResourceTypes: ["scf", "cos", "cdn", "flexdb"],
        }),
      });
    });

    it("includes fixed source=maas tag in EnvTags", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          EnvTags: expect.arrayContaining([{ Key: "source", Value: "maas" }]),
        }),
      });
    });

    it("merges user-provided tags with fixed source tag", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        EnvTags: [
          { Key: "project", Value: "demo" },
          { Key: "team", Value: "dev" },
        ],
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          EnvTags: [
            { Key: "source", Value: "maas" },
            { Key: "project", Value: "demo" },
            { Key: "team", Value: "dev" },
          ],
        }),
      });
    });

    it("filters out user source tag to prevent override", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        EnvTags: [
          { Key: "source", Value: "user-defined" },
          { Key: "project", Value: "demo" },
        ],
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          EnvTags: [
            { Key: "source", Value: "maas" },
            { Key: "project", Value: "demo" },
          ],
        }),
      });
    });
  });

  describe("optional parameters", () => {
    it("accepts custom EnvId", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        EnvId: "my-custom-env-id",
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          EnvId: "my-custom-env-id",
        }),
      });
    });

    it("accepts TimeSpan and TimeUnit", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        TimeSpan: 3,
        TimeUnit: "m",
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          TimeSpan: 3,
          TimeUnit: "m",
        }),
      });
    });

    it("accepts EnableExcess option", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        EnableExcess: true,
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          EnableExcess: true,
        }),
      });
    });

    it("accepts AutoVoucher option", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        AutoVoucher: true,
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          AutoVoucher: true,
        }),
      });
    });

    it("accepts custom ResourceTypes", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        ResourceTypes: ["scf", "cos"],
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          ResourceTypes: ["scf", "cos"],
        }),
      });
    });

    it("accepts Extension parameter", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        Extension: "some-extension-data",
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          Extension: "some-extension-data",
        }),
      });
    });

    it("accepts Source parameter", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({
        PackageId: "baas_personal",
        Source: "miniapp",
      });

      expect(mockTcbApi.call).toHaveBeenCalledWith({
        Action: "CreateBillDeal",
        Param: expect.objectContaining({
          Source: "miniapp",
        }),
      });
    });
  });

  describe("initialization", () => {
    it("calls initCloudBase with credentials-only vars", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({ PackageId: "baas_personal" });

      expect(initCloudBase).toHaveBeenCalledWith({
        requiredVars: CREDENTIALS_ONLY_VARS,
        defaultEnvId: "placeholder",
      });
    });

    it("calls commonService with correct TCB API config", async () => {
      mockTcbApi.call.mockResolvedValue({});

      await handleCreateEnv({ PackageId: "baas_personal" });

      expect(mockCloudBase.commonService).toHaveBeenCalledWith(
        "tcb",
        "2018-06-08",
      );
    });
  });

  describe("input validation", () => {
    it("returns error when PackageId is missing", async () => {
      const result = await handleCreateEnv({});

      expect(result.success).toBe(false);
      expect(result.error).toContain("PackageId");
    });

    it("returns error when args is null", async () => {
      const result = await handleCreateEnv(null);

      expect(result.success).toBe(false);
      expect(result.error).toContain("PackageId");
    });

    it("returns error when args is undefined", async () => {
      const result = await handleCreateEnv();

      expect(result.success).toBe(false);
      expect(result.error).toContain("PackageId");
    });
  });

  describe("error handling", () => {
    it("returns error result when API call fails", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("Insufficient balance"));

      const result = await handleCreateEnv({ PackageId: "baas_personal" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Insufficient balance");
    });

    it("returns error result when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: TENCENTCLOUD_SECRETID",
        );
      });

      const result = await handleCreateEnv({ PackageId: "baas_personal" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error result when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleCreateEnv({ PackageId: "baas_personal" });

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles quota exceeded errors", async () => {
      mockTcbApi.call.mockRejectedValue(new Error("QuotaExceeded.EnvLimit"));

      const result = await handleCreateEnv({ PackageId: "baas_personal" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("QuotaExceeded.EnvLimit");
    });
  });

  describe("raw API response", () => {
    it("includes raw API response in result", async () => {
      const rawResponse = {
        TranId: "tran-123",
        EnvId: "env-456",
        RequestId: "req-789",
      };
      mockTcbApi.call.mockResolvedValue(rawResponse);

      const result = await handleCreateEnv({ PackageId: "baas_personal" });

      expect(result.rawResponse).toEqual(rawResponse);
    });
  });
});

describe("handleCreateEnv with options", () => {
  let mockCloudBase;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTcbApi = {
      call: vi.fn().mockResolvedValue({ TranId: "tran-1", EnvId: "env-1" }),
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
    await handleCreateEnv(
      { PackageId: "baas_personal" },
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

    await handleCreateEnv({ PackageId: "baas_personal" }, { silent: true });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("logs output by default (silent: false)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCreateEnv({ PackageId: "baas_personal" }, { silent: false });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("handleCreateEnv output formatting", () => {
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

  it("logs creating message", async () => {
    mockTcbApi.call.mockResolvedValue({});

    await handleCreateEnv({ PackageId: "baas_personal" });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/creating|CreateBillDeal/i),
    );
  });

  it("logs PackageId in output", async () => {
    mockTcbApi.call.mockResolvedValue({});

    await handleCreateEnv({ PackageId: "baas_personal" });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("baas_personal");
  });

  it("logs success message with EnvId when available", async () => {
    mockTcbApi.call.mockResolvedValue({
      TranId: "tran-123",
      EnvId: "my-new-env-id",
    });

    await handleCreateEnv({ PackageId: "baas_personal" });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("my-new-env-id");
  });

  it("logs TranId when available", async () => {
    mockTcbApi.call.mockResolvedValue({
      TranId: "trans-abc-123",
    });

    await handleCreateEnv({ PackageId: "baas_personal" });

    const allLogCalls = consoleLogSpy.mock.calls.flat().join(" ");
    expect(allLogCalls).toContain("trans-abc-123");
  });
});
