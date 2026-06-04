import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(
  TEST_DIR,
  "..",
  "..",
  "resource",
  "contextPath",
  "nginx-access-control.sh",
);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-nginx-acl-"));
}

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function runScript(env) {
  return execFileSync("sh", [SCRIPT_PATH], {
    env: {
      PATH: process.env.PATH,
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("nginx access-control runtime script", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("decodes server-provided base64 nginx directives", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const realIpDirectives = [
      "set_real_ip_from 127.0.0.1;",
      "real_ip_header X-Envoy-External-Address;",
      "",
    ].join("\n");
    const accessDirectives = ["allow 211.102.241.96/29;", "deny all;", ""].join(
      "\n",
    );

    runScript({
      ZAI_ACCESS_CONTROL_ENABLED: "true",
      ZAI_NGINX_ACCESS_CONTROL_DIR: tempDir,
      ZAI_NGINX_REAL_IP_DIRECTIVES_B64: encode(realIpDirectives),
      ZAI_NGINX_ACCESS_DIRECTIVES_B64: encode(accessDirectives),
    });

    expect(
      fs.readFileSync(path.join(tempDir, "nginx-real-ip.conf"), "utf8"),
    ).toBe(realIpDirectives);
    expect(
      fs.readFileSync(path.join(tempDir, "nginx-access-control.conf"), "utf8"),
    ).toBe(accessDirectives);
  });

  it("creates empty include files when access control is disabled", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    runScript({
      ZAI_NGINX_ACCESS_CONTROL_DIR: tempDir,
    });

    expect(
      fs.readFileSync(path.join(tempDir, "nginx-real-ip.conf"), "utf8"),
    ).toBe("");
    expect(
      fs.readFileSync(path.join(tempDir, "nginx-access-control.conf"), "utf8"),
    ).toBe("");
  });

  it("fails closed when enabled but required directive env is missing", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    let error;
    try {
      runScript({
        ZAI_ACCESS_CONTROL_ENABLED: "true",
        ZAI_NGINX_ACCESS_CONTROL_DIR: tempDir,
        ZAI_NGINX_REAL_IP_DIRECTIVES_B64: encode(
          "real_ip_header X-Envoy-External-Address;\n",
        ),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(String(error.stderr)).toContain(
      "ZAI_NGINX_ACCESS_DIRECTIVES_B64 is required",
    );
  });
});
