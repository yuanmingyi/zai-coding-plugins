import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runArbitraryPackageProject } from "../arbitrary/packageProject.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-package-"));
}

function writeContextPathArtifacts(agentWorkDir) {
  fs.writeFileSync(
    path.join(agentWorkDir, "nginx.conf.template"),
    "server { listen ${PORT}; }\n",
  );
  fs.writeFileSync(
    path.join(agentWorkDir, "entrypoint.sh"),
    "#!/bin/sh\nexec true\n",
  );
  fs.writeFileSync(
    path.join(agentWorkDir, "nginx-access-control.sh"),
    "#!/bin/sh\nexec true\n",
  );
}

describe("arbitrary/packageProject", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("copies the service source with parity excludes and validates docker COPY paths", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const serviceRoot = path.join(tempDir, "apps/api");
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-1");
    fs.mkdirSync(path.join(serviceRoot, "public"), { recursive: true });
    fs.mkdirSync(path.join(serviceRoot, "tests"), { recursive: true });
    fs.mkdirSync(path.join(serviceRoot, "node_modules/lib"), {
      recursive: true,
    });
    fs.mkdirSync(agentWorkDir, { recursive: true });

    fs.writeFileSync(
      path.join(serviceRoot, "package.json"),
      '{"name":"api"}\n',
    );
    fs.writeFileSync(
      path.join(serviceRoot, "server.js"),
      "console.log('ready')\n",
    );
    fs.writeFileSync(path.join(serviceRoot, "public", "logo.txt"), "asset\n");
    fs.writeFileSync(path.join(serviceRoot, ".env"), "SECRET=value\n");
    fs.writeFileSync(
      path.join(serviceRoot, "tests", "server.test.js"),
      "test\n",
    );
    fs.writeFileSync(
      path.join(serviceRoot, "node_modules/lib", "index.js"),
      "module\n",
    );

    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      [
        "FROM node:20-slim",
        "WORKDIR /build",
        "COPY package.json /build/",
        "COPY public /build/public",
        "RUN npm ci",
        "CMD mkdir -p /output-mount && cp -R . /output-mount/",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "FROM node:20-slim\nCOPY . /app/\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "buildDockerImage.sh"),
      "#!/bin/sh\n",
    );
    writeContextPathArtifacts(agentWorkDir);

    const result = await runArbitraryPackageProject({
      cwd: tempDir,
      agentWorkDir,
      serviceRoot: "apps/api",
    });

    expect(result.success).toBe(true);
    expect(result.packageDir).toBe(path.join(agentWorkDir, "deploy-package"));

    expect(fs.existsSync(path.join(result.packageDir, "package.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(result.packageDir, "server.js"))).toBe(true);
    expect(
      fs.existsSync(path.join(result.packageDir, "public", "logo.txt")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(result.packageDir, "Dockerfile.build")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(result.packageDir, "buildDockerImage.sh")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(result.packageDir, "nginx.conf.template")),
    ).toBe(true);
    expect(fs.existsSync(path.join(result.packageDir, "entrypoint.sh"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(result.packageDir, "nginx-access-control.sh")),
    ).toBe(true);
    const entrypointMode = fs.statSync(
      path.join(result.packageDir, "entrypoint.sh"),
    ).mode;
    expect((entrypointMode & 0o111) !== 0).toBe(true);
    const accessControlMode = fs.statSync(
      path.join(result.packageDir, "nginx-access-control.sh"),
    ).mode;
    expect((accessControlMode & 0o111) !== 0).toBe(true);
    expect(fs.existsSync(path.join(result.packageDir, ".env"))).toBe(false);
    expect(fs.existsSync(path.join(result.packageDir, "tests"))).toBe(false);
    expect(fs.existsSync(path.join(result.packageDir, "node_modules"))).toBe(
      false,
    );
  });

  it("fails when Dockerfile.build references a missing package path", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-2");
    fs.mkdirSync(agentWorkDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "package.json"), '{"name":"demo"}\n');
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "FROM node:20-slim\nCOPY missing.txt /build/\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "FROM node:20-slim\nCOPY . /app/\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "buildDockerImage.sh"),
      "#!/bin/sh\n",
    );
    writeContextPathArtifacts(agentWorkDir);

    const result = await runArbitraryPackageProject({
      cwd: tempDir,
      agentWorkDir,
      serviceRoot: ".",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("missing.txt");
  });

  it("excludes agent-tool dotfile directories like .claude from the deploy package", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const serviceRoot = path.join(tempDir, "app");
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-claude");
    fs.mkdirSync(path.join(serviceRoot, ".claude"), { recursive: true });
    fs.mkdirSync(agentWorkDir, { recursive: true });

    fs.writeFileSync(path.join(serviceRoot, "app.py"), "print('ok')\n");
    fs.writeFileSync(
      path.join(serviceRoot, ".claude", "settings.local.json"),
      '{"permissions":[]}\n',
    );

    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "FROM python:3.12-slim\nCOPY app.py /build/\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "FROM python:3.12-slim\nCOPY . /app/\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "buildDockerImage.sh"),
      "#!/bin/sh\n",
    );
    writeContextPathArtifacts(agentWorkDir);

    const result = await runArbitraryPackageProject({
      cwd: tempDir,
      agentWorkDir,
      serviceRoot: "app",
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(result.packageDir, "app.py"))).toBe(true);
    expect(fs.existsSync(path.join(result.packageDir, ".claude"))).toBe(false);
  });

  it("ignores external-stage COPY sources during Dockerfile validation", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-3");
    fs.mkdirSync(agentWorkDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "composer.json"),
      '{"name":"demo-php"}\n',
    );
    fs.writeFileSync(path.join(tempDir, "index.php"), "<?php echo 'ok';\n");
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      [
        "FROM php:8.2-cli",
        "WORKDIR /build",
        "COPY --from=composer:2 /usr/bin/composer /usr/bin/composer",
        "COPY . /build/",
        "RUN composer install --no-dev --optimize-autoloader",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "FROM php:8.2-cli\nCOPY . /app/\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "buildDockerImage.sh"),
      "#!/bin/sh\n",
    );
    writeContextPathArtifacts(agentWorkDir);

    const result = await runArbitraryPackageProject({
      cwd: tempDir,
      agentWorkDir,
      serviceRoot: ".",
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(result.packageDir, "composer.json"))).toBe(
      true,
    );
  });

  it("does NOT let stale rendered-artifact files in the project root overwrite the fresh ones from agentWorkDir", async () => {
    // Regression for the case where a previous deploy attempt left
    // Dockerfile.run / Dockerfile.build / buildDockerImage.sh in the user's
    // project root. The walk-service-files step used to silently overwrite
    // the freshly-rendered scripted artifacts with these stale ones, which
    // shipped an image with no nginx + no CONTEXT_PATH support.
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-stale");
    fs.mkdirSync(agentWorkDir, { recursive: true });

    // User project root: legitimate user files PLUS stale scripted artifacts.
    fs.writeFileSync(path.join(tempDir, "package.json"), '{"name":"app"}\n');
    fs.writeFileSync(
      path.join(tempDir, "Dockerfile.run"),
      "STALE_HAND_WRITTEN_DOCKERFILE_RUN\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "Dockerfile.build"),
      "STALE_HAND_WRITTEN_DOCKERFILE_BUILD\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "buildDockerImage.sh"),
      "#!/bin/sh\n# STALE_BUILD_SCRIPT\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "nginx.conf.template"),
      "# STALE_NGINX_TEMPLATE\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "entrypoint.sh"),
      "#!/bin/sh\n# STALE_ENTRYPOINT\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "nginx-access-control.sh"),
      "#!/bin/sh\n# STALE_ACCESS_CONTROL\n",
    );

    // Freshly rendered artifacts in agentWorkDir (the source of truth).
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "FRESH_RENDERED_DOCKERFILE_RUN\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "FRESH_RENDERED_DOCKERFILE_BUILD\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "buildDockerImage.sh"),
      "#!/bin/sh\n# FRESH_BUILD_SCRIPT\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "nginx.conf.template"),
      "# FRESH_NGINX_TEMPLATE\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "entrypoint.sh"),
      "#!/bin/sh\n# FRESH_ENTRYPOINT\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "nginx-access-control.sh"),
      "#!/bin/sh\n# FRESH_ACCESS_CONTROL\n",
    );

    const result = await runArbitraryPackageProject({
      cwd: tempDir,
      agentWorkDir,
      serviceRoot: ".",
    });

    expect(result.success).toBe(true);
    for (const fileName of [
      "Dockerfile.run",
      "Dockerfile.build",
      "buildDockerImage.sh",
      "nginx.conf.template",
      "entrypoint.sh",
      "nginx-access-control.sh",
    ]) {
      const packaged = fs.readFileSync(
        path.join(result.packageDir, fileName),
        "utf8",
      );
      expect(packaged).not.toContain("STALE_");
      expect(packaged).toContain("FRESH_");
    }
    // The legitimate user file must still be present.
    expect(fs.existsSync(path.join(result.packageDir, "package.json"))).toBe(
      true,
    );
  });

  it("fails fast when the context-path artifacts are missing from agentWorkDir", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(
      tempDir,
      ".zai/deploy/arbitrary/run-missing",
    );
    fs.mkdirSync(agentWorkDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "package.json"), '{"name":"demo"}\n');
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "FROM node:20-slim\nCOPY . /build/\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "FROM node:20-slim\nCOPY . /app/\n",
    );
    fs.writeFileSync(
      path.join(agentWorkDir, "buildDockerImage.sh"),
      "#!/bin/sh\n",
    );
    // Intentionally do NOT write nginx.conf.template / entrypoint.sh /
    // nginx-access-control.sh.

    const result = await runArbitraryPackageProject({
      cwd: tempDir,
      agentWorkDir,
      serviceRoot: ".",
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(
      /Missing generated artifact:.*(nginx\.conf\.template|entrypoint\.sh|nginx-access-control\.sh)/,
    );
  });
});
