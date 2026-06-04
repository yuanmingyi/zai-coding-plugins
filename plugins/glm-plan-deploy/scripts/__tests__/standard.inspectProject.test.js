import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectProject } from "../standard/inspectProject.js";

describe("standard/inspectProject", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("detects static HTML projects without package.json", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-inspect-project-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(path.join(tempDir, "index.html"), "<html></html>");

    const result = await inspectProject(tempDir, {
      skipSupportedVersionLookup: true,
    });

    expect(result.success).toBe(true);
    expect(result.projectType).toBe("static-html");
  });

  it("detects node build command, node version, and outdir", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-inspect-project-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.0.0",
        engines: {
          node: "20",
        },
        scripts: {
          build: "vite build",
        },
        dependencies: {
          vite: "^7.0.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'",
    );
    fs.writeFileSync(
      path.join(tempDir, "vite.config.ts"),
      "export default { build: { outDir: 'dist-app' } }",
    );

    const result = await inspectProject(tempDir, {
      supportedVersions: ["18.18.0", "20.18.0", "22.17.1"],
    });

    expect(result.success).toBe(true);
    expect(result.projectType).toBe("nodejs");
    expect(result.nodeVersion).toBe("20.18.0");
    expect(result.outdir).toBe("dist-app");
    expect(result.buildCommand).toBe(
      "pnpm install --frozen-lockfile && pnpm build",
    );
  });

  it("prefers framework-specific dependencies over Vite", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-inspect-project-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        scripts: {
          build: "vite build",
        },
        devDependencies: {
          "@sveltejs/kit": "^2.0.0",
          vite: "^7.0.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "svelte.config.js"),
      "export default {}",
    );

    const result = await inspectProject(tempDir, {
      skipSupportedVersionLookup: true,
    });

    expect(result.success).toBe(true);
    expect(result.framework).toBe("sveltekit");
    expect(result.outdir).toBe("build");
  });
});
