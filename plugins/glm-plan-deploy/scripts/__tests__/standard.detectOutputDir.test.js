import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { detectOutputDir } from "../standard/detectOutputDir.js";

describe("standard/detectOutputDir", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("detects Vite outDir from vite config", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-output-dir-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "vite.config.ts"),
      "export default { build: { outDir: 'web-dist' } }",
    );

    expect(detectOutputDir(tempDir)).toBe("web-dist");
  });

  it("defaults Vite projects without config files to dist", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-output-dir-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        devDependencies: {
          vite: "^7.0.0",
        },
      }),
    );

    expect(detectOutputDir(tempDir)).toBe("dist");
  });

  it("keeps SvelteKit output detection when Vite is also a dependency", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-output-dir-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
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

    expect(detectOutputDir(tempDir)).toBe("build");
  });

  it("defaults Gatsby projects to public", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-output-dir-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: {
          gatsby: "^5.0.0",
        },
      }),
    );

    expect(detectOutputDir(tempDir)).toBe("public");
  });

  it("defaults Next.js projects to .next", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-output-dir-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "next.config.js"),
      "module.exports = {}",
    );

    expect(detectOutputDir(tempDir)).toBe(".next");
  });

  it("adds /browser for Angular output paths", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "glm-plan-output-dir-"),
    );
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "angular.json"),
      JSON.stringify({
        projects: {
          demo: {
            architect: {
              build: {
                options: {
                  outputPath: "dist/demo",
                },
              },
            },
          },
        },
      }),
    );

    expect(detectOutputDir(tempDir)).toBe("dist/demo/browser");
  });
});
