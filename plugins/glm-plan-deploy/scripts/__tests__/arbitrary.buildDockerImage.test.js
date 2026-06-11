import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESOURCE_DIR = path.resolve(TEST_DIR, "..", "..", "resource");
const RESOURCE_SCRIPT_PATH = path.join(RESOURCE_DIR, "buildDockerImage.sh");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-build-image-"));
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

describe("resource/buildDockerImage.sh", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("uses a lowercase Docker image name when APP_NAME contains uppercase characters", () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const sourceDir = path.join(tempDir, "source");
    const fakeBinDir = path.join(tempDir, "bin");
    const dockerLog = path.join(tempDir, "docker.log");
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(fakeBinDir);

    fs.copyFileSync(
      RESOURCE_SCRIPT_PATH,
      path.join(sourceDir, "buildDockerImage.sh"),
    );
    fs.writeFileSync(
      path.join(sourceDir, "Dockerfile.build"),
      "FROM scratch\nCMD mkdir -p /output-mount\n",
    );
    fs.writeFileSync(path.join(sourceDir, "Dockerfile.run"), "FROM scratch\n");
    for (const sidecar of [
      "nginx.conf.template",
      "entrypoint.sh",
      "nginx-access-control.sh",
      "nginx-static-context-path.envsh",
    ]) {
      fs.writeFileSync(path.join(sourceDir, sidecar), "# sidecar\n");
    }

    writeExecutable(
      path.join(fakeBinDir, "docker"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  run)
    for arg in "$@"; do
      case "$arg" in
        *:/output-mount)
          out_dir="\${arg%:/output-mount}"
          mkdir -p "$out_dir"
          printf '<html><head></head><body></body></html>' > "$out_dir/index.html"
          ;;
      esac
    done
    ;;
esac
exit 0
`,
    );

    const output = execFileSync("bash", ["./buildDockerImage.sh"], {
      cwd: sourceDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH || ""}`,
        DOCKER_LOG: dockerLog,
        APP_NAME: "demo-C2EJnc",
        CONTEXT_PATH: "/demo-C2EJnc",
        TAG: "Adt-Upper",
        TCR_DOMAIN: "ccr.example.com",
        TCR_NAMESPACE: "maas-glm-plan-deploy",
        DEPLOY_BUILD_ID: "fixed-build",
        CC_DEPLOY_BUILD_ARCH: "amd64",
      },
      encoding: "utf8",
    });

    const dockerCommands = fs.readFileSync(dockerLog, "utf8");
    expect(output).toContain("CONTEXT_PATH=[/demo-C2EJnc]");
    expect(output).toContain("DOCKER_IMAGE_NAME=[demo-c2ejnc]");
    expect(dockerCommands).toContain("-t demo-c2ejnc-build");
    expect(dockerCommands).toContain("-t demo-c2ejnc ");
    expect(dockerCommands).toContain(
      "ccr.example.com/maas-glm-plan-deploy/demo-c2ejnc:Adt-Upper",
    );
    expect(dockerCommands).toContain(
      "ccr.example.com/maas-glm-plan-deploy/demo-c2ejnc:cc-deploy-fixed-build",
    );
    expect(dockerCommands).not.toContain("demo-C2EJnc-build");
    expect(dockerCommands).not.toContain(
      "ccr.example.com/maas-glm-plan-deploy/demo-C2EJnc:Adt-Upper",
    );
  });
});
