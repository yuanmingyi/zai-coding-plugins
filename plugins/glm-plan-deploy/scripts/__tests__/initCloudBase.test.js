/**
 * TDD Tests for initCloudBase utility
 *
 * This utility consolidates the repeated initialization pattern found 15+ times
 * in deploy.js into a single, testable function.
 *
 * RED PHASE: These tests should FAIL initially because initCloudBase doesn't exist yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Mock the CloudBase SDK with a proper class
vi.mock("@cloudbase/manager-node", () => {
  const MockCloudBase = vi.fn(function (config) {
    this.secretId = config.secretId;
    this.secretKey = config.secretKey;
    this.envId = config.envId;
    this.commonService = vi.fn().mockReturnValue({
      call: vi.fn(),
    });
  });
  return { default: MockCloudBase };
});

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Import after mocks are set up
import { initCloudBase, loadEnv, validateEnvVars } from "../utils.js";

describe("loadEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error when .env file does not exist", () => {
    existsSync.mockReturnValue(false);

    expect(() => loadEnv()).toThrow(".env file not found");
  });

  it("parses .env file correctly", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID=test-secret-id
TENCENTCLOUD_SECRETKEY=test-secret-key
CLOUDBASE_ENV_ID=test-env-123
`);

    const env = loadEnv();

    expect(env.TENCENTCLOUD_SECRETID).toBe("test-secret-id");
    expect(env.TENCENTCLOUD_SECRETKEY).toBe("test-secret-key");
    expect(env.CLOUDBASE_ENV_ID).toBe("test-env-123");
  });

  it("ignores comment lines in .env file", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
# This is a comment
TENCENTCLOUD_SECRETID=test-id
# Another comment
TENCENTCLOUD_SECRETKEY=test-key
`);

    const env = loadEnv();

    expect(env.TENCENTCLOUD_SECRETID).toBe("test-id");
    expect(env.TENCENTCLOUD_SECRETKEY).toBe("test-key");
    expect(env["# This is a comment"]).toBeUndefined();
  });

  it("handles values with equals signs", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
SOME_KEY=value=with=equals
`);

    const env = loadEnv();

    expect(env.SOME_KEY).toBe("value=with=equals");
  });

  it("trims whitespace from keys and values", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
  TENCENTCLOUD_SECRETID  =  test-id-with-spaces
`);

    const env = loadEnv();

    expect(env.TENCENTCLOUD_SECRETID).toBe("test-id-with-spaces");
  });

  it("skips empty lines", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`

TENCENTCLOUD_SECRETID=test-id

TENCENTCLOUD_SECRETKEY=test-key

`);

    const env = loadEnv();

    expect(Object.keys(env)).toHaveLength(2);
  });

  it("skips lines without equals sign (key only, no value)", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID=test-id
KEY_WITHOUT_VALUE
TENCENTCLOUD_SECRETKEY=test-key
`);

    const env = loadEnv();

    expect(Object.keys(env)).toHaveLength(2);
    expect(env.KEY_WITHOUT_VALUE).toBeUndefined();
  });
});

describe("validateEnvVars", () => {
  it("throws error when required variables are missing", () => {
    const env = {
      TENCENTCLOUD_SECRETID: "test-id",
      // Missing TENCENTCLOUD_SECRETKEY and CLOUDBASE_ENV_ID
    };
    const required = [
      "TENCENTCLOUD_SECRETID",
      "TENCENTCLOUD_SECRETKEY",
      "CLOUDBASE_ENV_ID",
    ];

    expect(() => validateEnvVars(env, required)).toThrow(
      "Missing required environment variables",
    );
    expect(() => validateEnvVars(env, required)).toThrow(
      "TENCENTCLOUD_SECRETKEY",
    );
    expect(() => validateEnvVars(env, required)).toThrow("CLOUDBASE_ENV_ID");
  });

  it("does not throw when all required variables are present", () => {
    const env = {
      TENCENTCLOUD_SECRETID: "test-id",
      TENCENTCLOUD_SECRETKEY: "test-key",
      CLOUDBASE_ENV_ID: "test-env",
    };
    const required = [
      "TENCENTCLOUD_SECRETID",
      "TENCENTCLOUD_SECRETKEY",
      "CLOUDBASE_ENV_ID",
    ];

    expect(() => validateEnvVars(env, required)).not.toThrow();
  });

  it("treats empty string as missing", () => {
    const env = {
      TENCENTCLOUD_SECRETID: "test-id",
      TENCENTCLOUD_SECRETKEY: "",
      CLOUDBASE_ENV_ID: "test-env",
    };
    const required = [
      "TENCENTCLOUD_SECRETID",
      "TENCENTCLOUD_SECRETKEY",
      "CLOUDBASE_ENV_ID",
    ];

    expect(() => validateEnvVars(env, required)).toThrow(
      "TENCENTCLOUD_SECRETKEY",
    );
  });

  it("works with subset of variables (for commands that do not need CLOUDBASE_ENV_ID)", () => {
    const env = {
      TENCENTCLOUD_SECRETID: "test-id",
      TENCENTCLOUD_SECRETKEY: "test-key",
    };
    const required = ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY"];

    expect(() => validateEnvVars(env, required)).not.toThrow();
  });

  it("returns the validated env object for chaining", () => {
    const env = {
      TENCENTCLOUD_SECRETID: "test-id",
      TENCENTCLOUD_SECRETKEY: "test-key",
    };
    const required = ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY"];

    const result = validateEnvVars(env, required);
    expect(result).toBe(env);
  });
});

describe("initCloudBase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cloudbase instance and env object", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID=test-secret-id
TENCENTCLOUD_SECRETKEY=test-secret-key
CLOUDBASE_ENV_ID=test-env-123
`);

    const result = initCloudBase();

    expect(result).toHaveProperty("cloudbase");
    expect(result).toHaveProperty("env");
    expect(result.env.CLOUDBASE_ENV_ID).toBe("test-env-123");
  });

  it("initializes CloudBase SDK with correct credentials", async () => {
    const CloudBase = (await import("@cloudbase/manager-node")).default;

    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID=my-secret-id
TENCENTCLOUD_SECRETKEY=my-secret-key
CLOUDBASE_ENV_ID=my-env-id
`);

    initCloudBase();

    expect(CloudBase).toHaveBeenCalledWith({
      secretId: "my-secret-id",
      secretKey: "my-secret-key",
      envId: "my-env-id",
    });
  });

  it("validates required env vars by default (SECRETID, SECRETKEY, ENV_ID)", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID=test-id
# Missing SECRETKEY and ENV_ID
`);

    expect(() => initCloudBase()).toThrow(
      "Missing required environment variables",
    );
  });

  it("accepts custom required vars list", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID=test-id
TENCENTCLOUD_SECRETKEY=test-key
`);

    // Only require SECRETID and SECRETKEY (not ENV_ID)
    const result = initCloudBase({
      requiredVars: ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY"],
    });

    expect(result).toHaveProperty("cloudbase");
    expect(result).toHaveProperty("env");
  });

  it("uses placeholder envId when CLOUDBASE_ENV_ID is not required", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID=test-id
TENCENTCLOUD_SECRETKEY=test-key
`);

    const result = initCloudBase({
      requiredVars: ["TENCENTCLOUD_SECRETID", "TENCENTCLOUD_SECRETKEY"],
      defaultEnvId: "placeholder",
    });

    expect(result.cloudbase.envId).toBe("placeholder");
  });

  it("throws descriptive error when .env file is missing", () => {
    existsSync.mockReturnValue(false);

    expect(() => initCloudBase()).toThrow(".env file not found");
    expect(() => initCloudBase()).toThrow(".env.example");
  });
});

describe("initCloudBase edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles .env file with Windows line endings (CRLF)", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      "TENCENTCLOUD_SECRETID=test-id\r\n" +
        "TENCENTCLOUD_SECRETKEY=test-key\r\n" +
        "CLOUDBASE_ENV_ID=test-env\r\n",
    );

    const result = initCloudBase();

    expect(result.env.TENCENTCLOUD_SECRETID).toBe("test-id");
    expect(result.env.TENCENTCLOUD_SECRETKEY).toBe("test-key");
    expect(result.env.CLOUDBASE_ENV_ID).toBe("test-env");
  });

  it("handles quoted values in .env file", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID="test-id-quoted"
TENCENTCLOUD_SECRETKEY='test-key-quoted'
CLOUDBASE_ENV_ID=test-env
`);

    const result = initCloudBase();

    // Values should preserve quotes (standard .env behavior)
    // Or strip them - depends on our implementation choice
    expect(result.env.TENCENTCLOUD_SECRETID).toBeDefined();
    expect(result.env.TENCENTCLOUD_SECRETKEY).toBeDefined();
  });

  it("cloudbase instance has commonService method", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(`
TENCENTCLOUD_SECRETID=test-id
TENCENTCLOUD_SECRETKEY=test-key
CLOUDBASE_ENV_ID=test-env
`);

    const { cloudbase } = initCloudBase();

    expect(cloudbase.commonService).toBeDefined();
    expect(typeof cloudbase.commonService).toBe("function");
  });
});
