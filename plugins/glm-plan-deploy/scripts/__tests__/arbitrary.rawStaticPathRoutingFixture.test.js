import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it } from "vitest";

import { runArbitraryAnalyze } from "../arbitrary/analyze.js";
import { runArbitraryPackageProject } from "../arbitrary/packageProject.js";
import { runRenderArbitraryDockerfiles } from "../arbitrary/renderDockerfiles.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(
  TEST_DIR,
  "../../tests/raw-static-path-routing",
);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-raw-static-paths-"));
}

function listPackageFiles(packageDir) {
  const files = [];
  const queue = [packageDir];
  while (queue.length) {
    const currentDir = queue.shift();
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(path.relative(packageDir, fullPath).replace(/\\/g, "/"));
      }
    }
  }
  return files.sort();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceSubFilter(value, search, replacement) {
  return value.replace(
    new RegExp(escapeRegex(search), "gi"),
    () => replacement,
  );
}

function simulateStaticRuntimeRewrite(content, contextPath) {
  return [
    [' href="/', ` href="${contextPath}/`],
    [" href='/", ` href='${contextPath}/`],
    [' src="/', ` src="${contextPath}/`],
    [" src='/", ` src='${contextPath}/`],
    [' srcset="/', ` srcset="${contextPath}/`],
    [" srcset='/", ` srcset='${contextPath}/`],
    [' poster="/', ` poster="${contextPath}/`],
    [" poster='/", ` poster='${contextPath}/`],
    [' data-src="/', ` data-src="${contextPath}/`],
    [" data-src='/", ` data-src='${contextPath}/`],
    [' action="/', ` action="${contextPath}/`],
    [" action='/", ` action='${contextPath}/`],
    [' formaction="/', ` formaction="${contextPath}/`],
    [" formaction='/", ` formaction='${contextPath}/`],
    [' manifest="/', ` manifest="${contextPath}/`],
    [" manifest='/", ` manifest='${contextPath}/`],
    ['url("/', `url("${contextPath}/`],
    ["url('/", `url('${contextPath}/`],
    ["url(/", `url(${contextPath}/`],
  ].reduce(
    (rewritten, [search, replacement]) =>
      replaceSubFilter(rewritten, search, replacement),
    content,
  );
}

function resolvePath(value, basePath) {
  return new URL(value, `https://example.test${basePath}`).pathname;
}

function simulateStaticNginxLookup({ requestPath, contextPath, files }) {
  let staticPath = requestPath;
  if (contextPath && requestPath.startsWith(`${contextPath}/`)) {
    staticPath = requestPath.slice(contextPath.length);
  }
  return files.has(staticPath.slice(1)) ? staticPath : "/index.html";
}

describe("raw static path routing fixture", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("is detected, packaged, and routed without asset/page index fallback", async () => {
    const analysis = await runArbitraryAnalyze({ cwd: FIXTURE_DIR });

    expect(analysis.success).toBe(true);
    expect(analysis.detectedConfig).toMatchObject({
      language: "Node.js",
      framework: "static",
      runtimeKind: "static",
      buildCommand: "true",
      output: ".",
      startCommand: "static-site",
    });

    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-static");
    const rendered = await runRenderArbitraryDockerfiles({
      cwd: FIXTURE_DIR,
      agentWorkDir,
      detectedConfig: analysis.detectedConfig,
    });
    expect(rendered.success).toBe(true);

    const packaged = await runArbitraryPackageProject({
      cwd: FIXTURE_DIR,
      agentWorkDir,
      serviceRoot: ".",
    });
    expect(packaged.success).toBe(true);

    const packageFiles = new Set(listPackageFiles(packaged.packageDir));
    for (const file of [
      "index.html",
      "assets/relative.css",
      "assets/absolute.css",
      "pages/relative.html",
      "pages/absolute.html",
      "scripts/redirects.js",
      "nginx-static-context-path.envsh",
    ]) {
      expect(packageFiles.has(file)).toBe(true);
    }

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const nginxTemplate = fs.readFileSync(
      path.join(agentWorkDir, "nginx.conf.template"),
      "utf8",
    );
    expect(dockerfileBuild).toContain("<base\\nhref=");
    expect(dockerfileBuild).toContain(
      "rewriteStaticContextPathJavaScriptRedirects",
    );
    expect(nginxTemplate).toContain("set $zai_static_uri $uri;");
    expect(nginxTemplate).toContain(
      "try_files $zai_static_uri $zai_static_uri/ /index.html;",
    );
    expect(nginxTemplate).not.toContain("location.assign");

    const contextPath = "/raw-static-demo";
    const basePath = `${contextPath}/`;
    const buildWorkDir = path.join(tempDir, "build-work");
    fs.cpSync(FIXTURE_DIR, buildWorkDir, { recursive: true });
    const adjustmentCommand = dockerfileBuild
      .split("\n")
      .find((line) => line.startsWith("RUN node -e "));
    expect(adjustmentCommand).toBeTruthy();
    execSync(adjustmentCommand.replace(/^RUN /, ""), {
      cwd: buildWorkDir,
      env: { ...process.env, CONTEXT_PATH: contextPath },
      shell: "/bin/sh",
      stdio: "pipe",
    });
    const indexHtml = fs.readFileSync(
      path.join(buildWorkDir, "index.html"),
      "utf8",
    );
    const rewrittenHtml = simulateStaticRuntimeRewrite(indexHtml, contextPath);

    expect(rewrittenHtml).toContain('<base\nhref="/raw-static-demo/">');
    expect(rewrittenHtml).toContain('href="assets/relative.css"');
    expect(rewrittenHtml).toContain(
      'href="/raw-static-demo/assets/absolute.css"',
    );
    expect(rewrittenHtml).toContain('href="pages/relative.html"');
    expect(rewrittenHtml).toContain(
      'href="/raw-static-demo/pages/absolute.html"',
    );
    expect(rewrittenHtml).toContain('src="scripts/redirects.js"');
    expect(rewrittenHtml).not.toContain("/raw-static-demo/raw-static-demo/");

    const redirectJs = fs.readFileSync(
      path.join(buildWorkDir, "scripts/redirects.js"),
      "utf8",
    );
    const rewrittenRedirectJs = redirectJs;
    expect(rewrittenRedirectJs).toContain(
      'window.location.href = "pages/relative.html";',
    );
    expect(rewrittenRedirectJs).toContain(
      'window.location.assign("/raw-static-demo/pages/absolute.html");',
    );

    const requestPaths = [
      resolvePath("assets/relative.css", basePath),
      resolvePath("/raw-static-demo/assets/absolute.css", basePath),
      resolvePath("pages/relative.html", basePath),
      resolvePath("/raw-static-demo/pages/absolute.html", basePath),
      resolvePath("scripts/redirects.js", basePath),
      resolvePath("pages/relative.html", basePath),
      resolvePath("/raw-static-demo/pages/absolute.html", basePath),
    ];

    for (const requestPath of requestPaths) {
      expect(
        simulateStaticNginxLookup({
          requestPath,
          contextPath,
          files: packageFiles,
        }),
      ).not.toBe("/index.html");
    }
  });
});
