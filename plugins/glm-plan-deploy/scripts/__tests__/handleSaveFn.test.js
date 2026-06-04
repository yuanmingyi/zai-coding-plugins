/**
 * TDD Tests for handleSaveFn command handler
 *
 * This handler is extracted from the main() function in deploy.js.
 * It deploys CloudBase functions (code-based or image-based).
 *
 * RED PHASE: These tests should FAIL initially because handleSaveFn doesn't exist yet.
 *
 * handleSaveFn is the most complex handler as it:
 * 1. Deploys cloud functions (code-based or image-based)
 * 2. Binds domains
 * 3. Creates DNS records
 * 4. Configures HTTP access
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external dependencies
vi.mock("@cloudbase/manager-node", () => ({
  default: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("archiver", () => ({
  default: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Mock config to use shorter polling intervals for tests
vi.mock("../config.js", () => ({
  API_CONFIG: {
    SCF: { service: "scf", version: "2018-04-16" },
    TCB: { service: "tcb", version: "2018-06-08" },
    DNSPOD: { service: "dnspod", version: "2021-03-23" },
  },
  POLLING_CONFIG: {
    MAX_RETRIES: 2,
    INTERVAL_MS: 10,
  },
  rootDir: "/mock/root",
}));

// Mock the utils module
vi.mock("../utils.js", () => ({
  initCloudBase: vi.fn(),
  loadEnv: vi.fn(),
  validateEnvVars: vi.fn(),
  DEFAULT_REQUIRED_VARS: [
    "TENCENTCLOUD_SECRETID",
    "TENCENTCLOUD_SECRETKEY",
    "CLOUDBASE_ENV_ID",
  ],
}));

// Import after mocks are set up
import { handleSaveFn } from "../handlers/saveFn.js";
import { initCloudBase, DEFAULT_REQUIRED_VARS } from "../utils.js";
import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  createWriteStream,
} from "fs";
import archiver from "archiver";

describe("handleSaveFn", () => {
  let mockCloudBase;
  let mockScfApi;
  let mockTcbApi;
  let mockDnsApi;
  let mockStorage;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock API clients
    mockScfApi = {
      call: vi.fn(),
    };
    mockTcbApi = {
      call: vi.fn(),
    };
    mockDnsApi = {
      call: vi.fn(),
    };

    // Setup mock storage
    mockStorage = {
      uploadFile: vi.fn().mockResolvedValue({}),
      deleteFile: vi.fn().mockResolvedValue({}),
    };

    // Setup mock CloudBase instance
    mockCloudBase = {
      commonService: vi.fn((service) => {
        if (service === "scf") return mockScfApi;
        if (service === "tcb") return mockTcbApi;
        if (service === "dnspod") return mockDnsApi;
        return mockScfApi;
      }),
      storage: mockStorage,
    };

    // Default: initCloudBase returns mock cloudbase with env
    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {
        TENCENTCLOUD_SECRETID: "test-id",
        TENCENTCLOUD_SECRETKEY: "test-key",
        CLOUDBASE_ENV_ID: "test-env-123",
        CLOUDBASE_DOMAIN: "api.example.com",
        CLOUDBASE_CERT_ID: "cert-123",
      },
    });

    // Default file system mocks
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ size: 1024 }); // 1KB file

    // Mock readFileSync to return a Buffer for ZIP files
    readFileSync.mockImplementation((path) => {
      if (path && path.includes && path.includes(".zip")) {
        return Buffer.from("mock-zip-content");
      }
      if (path && path.includes && path.includes("requirements.txt")) {
        return "";
      }
      return Buffer.from("mock-file-content");
    });

    // Track close callback for proper triggering
    let closeCallback = null;

    // Mock createWriteStream - must be set up before archiver
    const mockWriteStream = {
      on: vi.fn((event, callback) => {
        if (event === "close") {
          closeCallback = callback;
        }
        return mockWriteStream;
      }),
    };
    createWriteStream.mockReturnValue(mockWriteStream);

    // Mock archiver - trigger close when finalize is called
    const mockArchive = {
      on: vi.fn().mockReturnThis(),
      pipe: vi.fn().mockReturnThis(),
      directory: vi.fn().mockReturnThis(),
      finalize: vi.fn(() => {
        // Trigger close callback immediately
        if (closeCallback) {
          process.nextTick(closeCallback);
        }
        return mockArchive;
      }),
      pointer: vi.fn().mockReturnValue(1024),
    };
    archiver.mockReturnValue(mockArchive);

    // Default API responses
    mockTcbApi.call.mockImplementation(({ Action }) => {
      if (Action === "DescribeEnvs") {
        return Promise.resolve({
          EnvList: [
            {
              EnvId: "test-env-123",
              LogServices: [{ LogsetId: "log-123", TopicId: "topic-123" }],
              Storages: [{ Bucket: "bucket-123456", Region: "ap-guangzhou" }],
              DefaultDomain: "test-env-123.ap-guangzhou.app.tcloudbase.com",
            },
          ],
        });
      }
      if (Action === "BindCloudBaseAccessDomain") {
        return Promise.resolve({});
      }
      if (Action === "CreateCloudBaseGWAPI") {
        return Promise.resolve({});
      }
      if (Action === "DescribeCloudBaseGWAPI") {
        return Promise.resolve({
          APISet: [{ Name: "test-function", UnionStatus: 1 }],
        });
      }
      return Promise.resolve({});
    });

    mockDnsApi.call.mockImplementation(({ Action }) => {
      if (Action === "DescribeRecordFilterList") {
        return Promise.resolve({ RecordList: [] });
      }
      if (Action === "CreateRecord") {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    mockScfApi.call.mockImplementation(({ Action }) => {
      if (Action === "GetFunction") {
        return Promise.reject(new Error("Function not found"));
      }
      if (Action === "CreateFunction") {
        return Promise.resolve({});
      }
      if (Action === "ListFunctions") {
        return Promise.resolve({
          Functions: [{ FunctionName: "test-function", Status: "Active" }],
        });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Input Validation Tests
  // ============================================================================

  describe("input validation", () => {
    it("returns error when function name is missing", async () => {
      const result = await handleSaveFn(null, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name is empty string", async () => {
      const result = await handleSaveFn("", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name is whitespace only", async () => {
      const result = await handleSaveFn("   ", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("function name");
    });

    it("returns error when function name starts with --", async () => {
      const result = await handleSaveFn("--invalid", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid function name");
    });

    it("returns error when path is missing for code deployment", async () => {
      const result = await handleSaveFn("my-function", {
        runtime: "Nodejs18.15",
        // path is missing
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("path");
    });

    it("returns error when runtime is missing for code deployment", async () => {
      const result = await handleSaveFn("my-function", {
        path: "./projects/app",
        // runtime is missing
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("runtime");
    });

    it("trims function name before use", async () => {
      const result = await handleSaveFn("  my-function  ", {
        path: "./projects/app",
        runtime: "Nodejs18.15",
        port: 9000,
      });

      expect(result.functionName).toBe("my-function");
    });
  });

  // ============================================================================
  // Basic Code Deployment Tests
  // ============================================================================

  describe("basic code deployment", () => {
    const validConfig = {
      path: "./projects/express",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("returns success for valid code deployment", async () => {
      const result = await handleSaveFn("express-service", validConfig);

      expect(result.success).toBe(true);
      expect(result.functionName).toBe("express-service");
    });

    it("calls initCloudBase with default required vars", async () => {
      await handleSaveFn("test-fn", validConfig);

      expect(initCloudBase).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredVars: DEFAULT_REQUIRED_VARS,
        }),
      );
    });

    it("calls SCF CreateFunction API for new function", async () => {
      await handleSaveFn("new-function", validConfig);

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            FunctionName: "new-function",
            Runtime: "Nodejs18.15",
            Namespace: "test-env-123",
          }),
        }),
      );
    });

    it("calls SCF UpdateFunctionCode for existing function", async () => {
      // Make GetFunction succeed (function exists)
      mockScfApi.call.mockImplementation(({ Action }) => {
        if (Action === "GetFunction") {
          return Promise.resolve({ FunctionName: "existing-fn" });
        }
        if (Action === "UpdateFunctionCode") {
          return Promise.resolve({});
        }
        if (Action === "ListFunctions") {
          return Promise.resolve({
            Functions: [{ FunctionName: "existing-fn", Status: "Active" }],
          });
        }
        return Promise.resolve({});
      });

      await handleSaveFn("existing-fn", validConfig);

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "UpdateFunctionCode",
        }),
      );
    });

    it("includes PORT in environment variables", async () => {
      await handleSaveFn("test-fn", { ...validConfig, port: 3000 });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Environment: expect.objectContaining({
              Variables: expect.arrayContaining([
                { Key: "PORT", Value: "3000" },
              ]),
            }),
          }),
        }),
      );
    });

    it("includes custom environment variables", async () => {
      const configWithEnvVars = {
        ...validConfig,
        EnvironmentVariables: [
          { Key: "DB_HOST", Value: "localhost" },
          { Key: "DEBUG", Value: "true" },
        ],
      };

      await handleSaveFn("test-fn", configWithEnvVars);

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Environment: expect.objectContaining({
              Variables: expect.arrayContaining([
                { Key: "DB_HOST", Value: "localhost" },
                { Key: "DEBUG", Value: "true" },
              ]),
            }),
          }),
        }),
      );
    });

    it("uses default MemorySize of 256 if not specified", async () => {
      await handleSaveFn("test-fn", validConfig);

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            MemorySize: 256,
          }),
        }),
      );
    });

    it("uses custom MemorySize when specified", async () => {
      await handleSaveFn("test-fn", { ...validConfig, MemorySize: 512 });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            MemorySize: 512,
          }),
        }),
      );
    });

    it("uses default Timeout of 60 if not specified", async () => {
      await handleSaveFn("test-fn", validConfig);

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Timeout: 60,
          }),
        }),
      );
    });

    it("uses custom Timeout when specified", async () => {
      await handleSaveFn("test-fn", { ...validConfig, Timeout: 120 });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Timeout: 120,
          }),
        }),
      );
    });

    it("returns accessUrl in result", async () => {
      const result = await handleSaveFn("my-service", validConfig);

      expect(result.success).toBe(true);
      expect(result.accessUrl).toBeDefined();
      expect(result.accessUrl).toContain("/my-service");
    });
  });

  // ============================================================================
  // Image Deployment Tests (--image flag)
  // ============================================================================

  describe("image deployment (--image flag)", () => {
    const imageConfig = {
      path: "./projects/springboot",
      port: 9000,
    };

    beforeEach(() => {
      // Setup for image deployment
      initCloudBase.mockReturnValue({
        cloudbase: mockCloudBase,
        env: {
          TENCENTCLOUD_SECRETID: "test-id",
          TENCENTCLOUD_SECRETKEY: "test-key",
          CLOUDBASE_ENV_ID: "test-env-123",
          CLOUDBASE_DOMAIN: "api.example.com",
          CLOUDBASE_CERT_ID: "cert-123",
          TCR_DOMAIN: "ccr.ccs.tencentyun.com",
          TCR_USERNAME: "tcr-user",
          TCR_PASSWORD: "tcr-pass",
          TCR_NAMESPACE: "my-namespace",
          TCR_REGISTRY_ID: "tcr-123",
        },
      });
    });

    it("returns error when path is missing for image deployment", async () => {
      const result = await handleSaveFn("my-service", {}, { useImage: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain("path");
    });

    it("returns error when Dockerfile not found", async () => {
      existsSync.mockImplementation((path) => {
        if (path.includes("Dockerfile")) return false;
        return true;
      });

      const result = await handleSaveFn("my-service", imageConfig, {
        useImage: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Dockerfile");
    });

    it("returns error when TCR credentials are missing", async () => {
      initCloudBase.mockReturnValue({
        cloudbase: mockCloudBase,
        env: {
          TENCENTCLOUD_SECRETID: "test-id",
          TENCENTCLOUD_SECRETKEY: "test-key",
          CLOUDBASE_ENV_ID: "test-env-123",
          // TCR_DOMAIN, TCR_USERNAME, TCR_PASSWORD missing
        },
      });

      const result = await handleSaveFn("my-service", imageConfig, {
        useImage: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("TCR");
    });

    it("uses CustomImage runtime for image deployment", async () => {
      const result = await handleSaveFn("my-service", imageConfig, {
        useImage: true,
      });

      if (result.success) {
        expect(mockScfApi.call).toHaveBeenCalledWith(
          expect.objectContaining({
            Action: "CreateFunction",
            Param: expect.objectContaining({
              Runtime: "CustomImage",
            }),
          }),
        );
      }
    });

    it("includes ImageConfig in Code parameter", async () => {
      const result = await handleSaveFn("my-service", imageConfig, {
        useImage: true,
      });

      if (result.success) {
        expect(mockScfApi.call).toHaveBeenCalledWith(
          expect.objectContaining({
            Action: "CreateFunction",
            Param: expect.objectContaining({
              Code: expect.objectContaining({
                ImageConfig: expect.objectContaining({
                  ImageUri: expect.any(String),
                  ImagePort: 9000,
                }),
              }),
            }),
          }),
        );
      }
    });
  });

  // ============================================================================
  // Image URI Deployment Tests (--imageUri flag)
  // ============================================================================

  describe("imageUri deployment (--imageUri flag)", () => {
    const baseConfig = {
      port: 9000,
    };

    beforeEach(() => {
      initCloudBase.mockReturnValue({
        cloudbase: mockCloudBase,
        env: {
          TENCENTCLOUD_SECRETID: "test-id",
          TENCENTCLOUD_SECRETKEY: "test-key",
          CLOUDBASE_ENV_ID: "test-env-123",
          CLOUDBASE_DOMAIN: "api.example.com",
          CLOUDBASE_CERT_ID: "cert-123",
          TCR_REGISTRY_ID: "tcr-123",
        },
      });
    });

    it("returns error when imageUri is invalid", async () => {
      const result = await handleSaveFn("my-service", baseConfig, {
        imageUri: "invalid-uri",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid");
    });

    it("accepts valid imageUri format", async () => {
      const result = await handleSaveFn("my-service", baseConfig, {
        imageUri: "ccr.ccs.tencentyun.com/namespace/image:tag",
      });

      expect(result.success).toBe(true);
    });

    it("uses CustomImage runtime for imageUri deployment", async () => {
      await handleSaveFn("my-service", baseConfig, {
        imageUri: "ccr.ccs.tencentyun.com/namespace/image:tag",
      });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Runtime: "CustomImage",
          }),
        }),
      );
    });

    it("includes provided imageUri in ImageConfig", async () => {
      const imageUri = "ccr.ccs.tencentyun.com/namespace/image:tag";

      await handleSaveFn("my-service", baseConfig, { imageUri });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Code: expect.objectContaining({
              ImageConfig: expect.objectContaining({
                ImageUri: imageUri,
              }),
            }),
          }),
        }),
      );
    });

    it("uses enterprise ImageType when TCR_REGISTRY_ID is set", async () => {
      await handleSaveFn("my-service", baseConfig, {
        imageUri: "ccr.ccs.tencentyun.com/namespace/image:tag",
      });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Code: expect.objectContaining({
              ImageConfig: expect.objectContaining({
                ImageType: "enterprise",
                RegistryId: "tcr-123",
              }),
            }),
          }),
        }),
      );
    });

    it("uses personal ImageType when TCR_REGISTRY_ID is not set", async () => {
      initCloudBase.mockReturnValue({
        cloudbase: mockCloudBase,
        env: {
          TENCENTCLOUD_SECRETID: "test-id",
          TENCENTCLOUD_SECRETKEY: "test-key",
          CLOUDBASE_ENV_ID: "test-env-123",
          // No TCR_REGISTRY_ID
        },
      });

      await handleSaveFn("my-service", baseConfig, {
        imageUri: "ccr.ccs.tencentyun.com/namespace/image:tag",
      });

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Code: expect.objectContaining({
              ImageConfig: expect.objectContaining({
                ImageType: "personal",
              }),
            }),
          }),
        }),
      );
    });

    it("allows overriding ImageType via config", async () => {
      await handleSaveFn(
        "my-service",
        { ...baseConfig, ImageType: "public" },
        {
          imageUri: "docker.io/library/nginx:latest",
        },
      );

      expect(mockScfApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateFunction",
          Param: expect.objectContaining({
            Code: expect.objectContaining({
              ImageConfig: expect.objectContaining({
                ImageType: "public",
              }),
            }),
          }),
        }),
      );
    });

    it("returns error when --image and --imageUri are both specified", async () => {
      const result = await handleSaveFn(
        "my-service",
        { path: "./app", port: 9000 },
        {
          useImage: true,
          imageUri: "ccr.ccs.tencentyun.com/namespace/image:tag",
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("cannot be used together");
    });
  });

  // ============================================================================
  // Domain Binding Tests
  // ============================================================================

  describe("domain binding", () => {
    const validConfig = {
      path: "./projects/app",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("calls BindCloudBaseAccessDomain when domain is configured", async () => {
      await handleSaveFn("test-fn", validConfig);

      expect(mockTcbApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "BindCloudBaseAccessDomain",
          Param: expect.objectContaining({
            Domain: "api.example.com",
            CertId: "cert-123",
          }),
        }),
      );
    });

    it("skips domain binding when CLOUDBASE_DOMAIN is not configured", async () => {
      initCloudBase.mockReturnValue({
        cloudbase: mockCloudBase,
        env: {
          TENCENTCLOUD_SECRETID: "test-id",
          TENCENTCLOUD_SECRETKEY: "test-key",
          CLOUDBASE_ENV_ID: "test-env-123",
          // No CLOUDBASE_DOMAIN or CLOUDBASE_CERT_ID
        },
      });

      await handleSaveFn("test-fn", validConfig);

      expect(mockTcbApi.call).not.toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "BindCloudBaseAccessDomain",
        }),
      );
    });

    it("handles already-bound domain gracefully", async () => {
      mockTcbApi.call.mockImplementation(({ Action }) => {
        if (Action === "BindCloudBaseAccessDomain") {
          return Promise.reject(new Error("Domain already binded"));
        }
        if (Action === "DescribeEnvs") {
          return Promise.resolve({
            EnvList: [
              {
                EnvId: "test-env-123",
                DefaultDomain: "test.app.tcloudbase.com",
              },
            ],
          });
        }
        return Promise.resolve({});
      });

      const result = await handleSaveFn("test-fn", validConfig);

      // Should not fail due to already-bound domain
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // DNS Record Tests
  // ============================================================================

  describe("DNS record creation", () => {
    const validConfig = {
      path: "./projects/app",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("creates CNAME record for custom domain", async () => {
      await handleSaveFn("test-fn", validConfig);

      expect(mockDnsApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateRecord",
          Param: expect.objectContaining({
            RecordType: "CNAME",
          }),
        }),
      );
    });

    it("skips DNS creation when domain is not configured", async () => {
      initCloudBase.mockReturnValue({
        cloudbase: mockCloudBase,
        env: {
          TENCENTCLOUD_SECRETID: "test-id",
          TENCENTCLOUD_SECRETKEY: "test-key",
          CLOUDBASE_ENV_ID: "test-env-123",
        },
      });

      await handleSaveFn("test-fn", validConfig);

      expect(mockDnsApi.call).not.toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateRecord",
        }),
      );
    });

    it("handles existing DNS record gracefully", async () => {
      mockDnsApi.call.mockImplementation(({ Action }) => {
        if (Action === "CreateRecord") {
          return Promise.reject(new Error("Record already exists"));
        }
        return Promise.resolve({ RecordList: [] });
      });

      const result = await handleSaveFn("test-fn", validConfig);

      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // HTTP Service Configuration Tests
  // ============================================================================

  describe("HTTP service configuration", () => {
    const validConfig = {
      path: "./projects/app",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("calls CreateCloudBaseGWAPI to configure HTTP access", async () => {
      await handleSaveFn("my-service", validConfig);

      expect(mockTcbApi.call).toHaveBeenCalledWith(
        expect.objectContaining({
          Action: "CreateCloudBaseGWAPI",
          Param: expect.objectContaining({
            Path: "/my-service",
            Name: "my-service",
            Type: 6, // Cloud function type
          }),
        }),
      );
    });

    it("handles existing HTTP service gracefully", async () => {
      mockTcbApi.call.mockImplementation(({ Action }) => {
        if (Action === "CreateCloudBaseGWAPI") {
          return Promise.reject(new Error("API already created"));
        }
        if (Action === "DescribeEnvs") {
          return Promise.resolve({
            EnvList: [
              {
                EnvId: "test-env-123",
                DefaultDomain: "test.app.tcloudbase.com",
              },
            ],
          });
        }
        if (Action === "DescribeCloudBaseGWAPI") {
          return Promise.resolve({
            APISet: [{ Name: "my-service", UnionStatus: 1 }],
          });
        }
        return Promise.resolve({});
      });

      const result = await handleSaveFn("my-service", validConfig);

      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("error handling", () => {
    const validConfig = {
      path: "./projects/app",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("returns error when initCloudBase fails", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          "Missing required environment variables: CLOUDBASE_ENV_ID",
        );
      });

      const result = await handleSaveFn("test-fn", validConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required environment variables");
    });

    it("returns error when .env file is missing", async () => {
      initCloudBase.mockImplementation(() => {
        throw new Error(
          ".env file not found. Please copy .env.example to .env and configure it.",
        );
      });

      const result = await handleSaveFn("test-fn", validConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain(".env file not found");
    });

    it("handles authentication errors", async () => {
      mockScfApi.call.mockRejectedValue(
        new Error("AuthFailure.SecretIdNotFound"),
      );

      const result = await handleSaveFn("test-fn", validConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe("AuthFailure.SecretIdNotFound");
    });

    it("handles CreateFunction API errors", async () => {
      mockScfApi.call.mockImplementation(({ Action }) => {
        if (Action === "GetFunction") {
          return Promise.reject(new Error("Function not found"));
        }
        if (Action === "CreateFunction") {
          return Promise.reject(new Error("InvalidParameter"));
        }
        return Promise.resolve({});
      });

      const result = await handleSaveFn("test-fn", validConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe("InvalidParameter");
    });

    it("returns error when source path does not exist", async () => {
      existsSync.mockImplementation((path) => {
        if (path.includes("projects/app")) return false;
        return true;
      });

      const result = await handleSaveFn("test-fn", validConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  // ============================================================================
  // COS Upload Tests (for large files)
  // ============================================================================

  describe("COS upload for large files", () => {
    const validConfig = {
      path: "./projects/app",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("uses COS upload when file exceeds 50MB", async () => {
      statSync.mockReturnValue({ size: 60 * 1024 * 1024 }); // 60MB

      await handleSaveFn("test-fn", validConfig);

      expect(mockStorage.uploadFile).toHaveBeenCalled();
    });

    it("uses ZIP upload when file is under 50MB", async () => {
      statSync.mockReturnValue({ size: 10 * 1024 * 1024 }); // 10MB

      await handleSaveFn("test-fn", validConfig);

      expect(mockStorage.uploadFile).not.toHaveBeenCalled();
    });

    it("cleans up COS file after deployment", async () => {
      statSync.mockReturnValue({ size: 60 * 1024 * 1024 }); // 60MB

      await handleSaveFn("test-fn", validConfig);

      expect(mockStorage.deleteFile).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Options Tests
  // ============================================================================

  describe("options handling", () => {
    const validConfig = {
      path: "./projects/app",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("accepts custom envPath option", async () => {
      await handleSaveFn("test-fn", validConfig, {
        envPath: "/custom/path/.env",
      });

      expect(initCloudBase).toHaveBeenCalledWith(
        expect.objectContaining({
          envPath: "/custom/path/.env",
        }),
      );
    });

    it("accepts silent option to suppress console output", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await handleSaveFn("test-fn", validConfig, { silent: true });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("logs output by default (silent: false)", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await handleSaveFn("test-fn", validConfig, { silent: false });

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // Result Object Tests
  // ============================================================================

  describe("result object structure", () => {
    const validConfig = {
      path: "./projects/app",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("returns success with all expected fields on success", async () => {
      const result = await handleSaveFn("my-service", validConfig);

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          functionName: "my-service",
          accessUrl: expect.any(String),
        }),
      );
    });

    it("returns error with all expected fields on failure", async () => {
      const result = await handleSaveFn("", validConfig);

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        }),
      );
    });

    it("includes data field with deployment details on success", async () => {
      const result = await handleSaveFn("my-service", validConfig);

      expect(result.data).toBeDefined();
    });
  });

  // ============================================================================
  // Python Dependencies Check Tests
  // ============================================================================

  describe("Python dependencies check", () => {
    it("checks for Python dependencies when runtime is Python", async () => {
      const pythonConfig = {
        path: "./projects/python-app",
        runtime: "Python3.9",
        port: 9000,
      };

      existsSync.mockImplementation((path) => {
        if (path.includes("requirements.txt")) return true;
        return true;
      });

      readFileSync.mockImplementation((path) => {
        if (path.includes("requirements.txt"))
          return "flask==2.0.0\nrequests==2.28.0";
        return "";
      });

      // No installed deps
      existsSync.mockImplementation((path) => {
        if (
          path.includes("flask") ||
          path.includes("requests") ||
          path.includes("__pycache__")
        ) {
          return false;
        }
        return true;
      });

      const result = await handleSaveFn("python-fn", pythonConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Python dependencies");
    });

    it("skips Python check for Node.js runtime", async () => {
      const nodeConfig = {
        path: "./projects/node-app",
        runtime: "Nodejs18.15",
        port: 9000,
      };

      const result = await handleSaveFn("node-fn", nodeConfig);

      // Should not fail due to Python dependencies check
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // Function Status Polling Tests
  // ============================================================================

  describe("function status polling", () => {
    const validConfig = {
      path: "./projects/app",
      runtime: "Nodejs18.15",
      port: 9000,
    };

    it("polls function status until Active", async () => {
      let pollCount = 0;
      mockScfApi.call.mockImplementation(({ Action }) => {
        if (Action === "GetFunction") {
          return Promise.reject(new Error("Not found"));
        }
        if (Action === "CreateFunction") {
          return Promise.resolve({});
        }
        if (Action === "ListFunctions") {
          pollCount++;
          if (pollCount < 2) {
            return Promise.resolve({
              Functions: [{ FunctionName: "test-fn", Status: "Creating" }],
            });
          }
          return Promise.resolve({
            Functions: [{ FunctionName: "test-fn", Status: "Active" }],
          });
        }
        return Promise.resolve({});
      });

      const result = await handleSaveFn("test-fn", validConfig);

      expect(result.success).toBe(true);
      expect(pollCount).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("handleSaveFn with Docker image URI validation", () => {
  let mockCloudBase;
  let mockScfApi;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScfApi = { call: vi.fn() };
    mockTcbApi = { call: vi.fn() };

    mockCloudBase = {
      commonService: vi.fn((service) => {
        if (service === "scf") return mockScfApi;
        if (service === "tcb") return mockTcbApi;
        return mockScfApi;
      }),
      storage: { uploadFile: vi.fn(), deleteFile: vi.fn() },
    };

    initCloudBase.mockReturnValue({
      cloudbase: mockCloudBase,
      env: {
        TENCENTCLOUD_SECRETID: "test-id",
        TENCENTCLOUD_SECRETKEY: "test-key",
        CLOUDBASE_ENV_ID: "test-env-123",
        TCR_REGISTRY_ID: "tcr-123",
      },
    });

    mockTcbApi.call.mockResolvedValue({
      EnvList: [
        { EnvId: "test-env-123", DefaultDomain: "test.tcloudbase.com" },
      ],
    });

    mockScfApi.call.mockImplementation(({ Action }) => {
      if (Action === "GetFunction")
        return Promise.reject(new Error("Not found"));
      if (Action === "ListFunctions") {
        return Promise.resolve({
          Functions: [{ FunctionName: "test", Status: "Active" }],
        });
      }
      return Promise.resolve({});
    });
  });

  const validUris = [
    "ccr.ccs.tencentyun.com/namespace/image:tag",
    "registry.example.com/myapp:v1.0.0",
    "myregistry.com/org/image@sha256:abc123",
    "docker.io/library/nginx:latest",
    "gcr.io/project/image:tag",
  ];

  const invalidUris = [
    "",
    "not-a-valid-uri",
    "://invalid",
    "http://wrong-protocol.com/image",
  ];

  validUris.forEach((uri) => {
    it(`accepts valid Docker image URI: ${uri}`, async () => {
      const result = await handleSaveFn(
        "test-service",
        { port: 9000 },
        { imageUri: uri },
      );

      // Should not fail on URI validation - either success or error not about invalid URI
      if (result.error) {
        expect(result.error).not.toContain("Invalid");
      } else {
        expect(result.success).toBe(true);
      }
    });
  });

  invalidUris.forEach((uri) => {
    it(`rejects invalid Docker image URI: ${uri || "(empty)"}`, async () => {
      const result = await handleSaveFn(
        "test-service",
        { port: 9000 },
        { imageUri: uri },
      );

      expect(result.success).toBe(false);
    });
  });
});

describe("handleSaveFn with EnvId option", () => {
  let mockCloudBase;
  let mockScfApi;
  let mockTcbApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScfApi = {
      call: vi.fn().mockImplementation(async ({ Action }) => {
        if (Action === "GetFunction") throw new Error("Function not found");
        if (Action === "CreateFunction") return {};
        if (Action === "ListFunctions")
          return { Functions: [{ FunctionName: "test", Status: "Active" }] };
        return {};
      }),
    };
    mockTcbApi = {
      call: vi
        .fn()
        .mockResolvedValue({ EnvList: [{ EnvId: "custom-env" }], Domains: [] }),
    };
    mockCloudBase = {
      commonService: vi.fn().mockImplementation((service) => {
        if (service === "scf") return mockScfApi;
        if (service === "tcb") return mockTcbApi;
        return mockScfApi;
      }),
      storage: {
        uploadFile: vi.fn().mockResolvedValue({}),
        deleteFile: vi.fn().mockResolvedValue({}),
      },
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

  it("uses provided EnvId instead of default from .env for CreateFunction", async () => {
    const result = await handleSaveFn(
      "my-function",
      {
        path: "/tmp/test",
        runtime: "Nodejs18.15",
        port: 9000,
      },
      {
        EnvId: "custom-env-id",
        silent: true,
      },
    );

    // Check that CreateFunction was called with custom namespace
    const createCall = mockScfApi.call.mock.calls.find(
      (c) => c[0].Action === "CreateFunction",
    );
    expect(createCall).toBeDefined();
    expect(createCall[0].Param.Namespace).toBe("custom-env-id");
  });

  it("returns envId in result when custom EnvId is provided", async () => {
    const result = await handleSaveFn(
      "my-function",
      {
        path: "/tmp/test",
        runtime: "Nodejs18.15",
        port: 9000,
      },
      {
        EnvId: "custom-env",
        silent: true,
      },
    );

    expect(result.envId).toBe("custom-env");
  });
});
