import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runArbitraryAnalyze } from "../arbitrary/analyze.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-analyze-"));
}

function firstDiscoveredHtml(rootDir) {
  const queue = [rootDir];
  while (queue.length) {
    const currentDir = queue.shift();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        return path.relative(rootDir, fullPath).replace(/\\/g, "/");
      }
    }
  }
  return null;
}

describe("arbitrary/analyze", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("detects a node project with build output and startup command", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-node",
        engines: { node: "20" },
        scripts: {
          build: "vite build",
          start: "node server.js",
        },
        dependencies: {
          vite: "^5.0.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "vite.config.js"),
      "export default { build: { outDir: 'build' } };\n",
    );
    fs.writeFileSync(path.join(tempDir, "server.js"), "console.log('ready')\n");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.language).toBe("Node.js");
    expect(result.detectedConfig.version).toBe("20");
    expect(result.detectedConfig.buildCommand).toBe("npm ci && npm run build");
    expect(result.detectedConfig.output).toBe("build");
    expect(result.detectedConfig.runtimeKind).toBe("process");
    expect(result.detectedConfig.startCommand).toBe("npm start");
    expect(result.summary).toContain("Detected Configuration");
  });

  it("detects a Prisma MySQL dependency intent without reading secrets", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-prisma-mysql",
        scripts: {
          start: "node server.js",
        },
        dependencies: {
          "@prisma/client": "^5.0.0",
          express: "^4.18.0",
        },
        devDependencies: {
          prisma: "^5.0.0",
        },
      }),
    );
    fs.mkdirSync(path.join(tempDir, "prisma"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "prisma", "schema.prisma"),
      [
        "datasource db {",
        '  provider = "mysql"',
        '  url      = env("DATABASE_URL")',
        "}",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(tempDir, "server.js"),
      "require('express')().listen(process.env.PORT || 3000)\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.database).toEqual({
      detected: true,
      type: "mysql",
      requiredEnv: ["DATABASE_URL"],
      orm: "prisma",
      migrationCommand: "npx prisma migrate deploy",
    });
  });

  it("detects a Python PostgreSQL dependency intent", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "requirements.txt"),
      ["Flask==3.0.0", "psycopg2-binary==2.9.9", "SQLAlchemy==2.0.0"].join(
        "\n",
      ),
    );
    fs.writeFileSync(
      path.join(tempDir, ".env.example"),
      "DATABASE_URL=postgresql://user:pass@host/db\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "app.py"),
      "from flask import Flask\napp = Flask(__name__)\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.database).toMatchObject({
      detected: true,
      type: "postgresql",
      requiredEnv: ["DATABASE_URL"],
      orm: "sqlalchemy",
    });
  });

  it("detects a Java MySQL dependency intent", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "pom.xml"),
      [
        "<project>",
        "  <dependencies>",
        "    <dependency><groupId>com.mysql</groupId><artifactId>mysql-connector-j</artifactId></dependency>",
        "    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>",
        "  </dependencies>",
        "</project>",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(tempDir, "src.java"), "class Demo {}\n");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.database).toMatchObject({
      detected: true,
      type: "mysql",
      requiredEnv: ["DATABASE_URL"],
      orm: "spring-data-jpa",
    });
  });

  it("keeps Vite frontend signals for static nginx runtime rendering", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-vite",
        scripts: {
          build: "vite build",
          start: "npx serve -s dist -l ${PORT}",
        },
        dependencies: {
          vue: "^3.5.0",
        },
        devDependencies: {
          vite: "^7.0.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      '<div id="app"></div>\n',
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      framework: "vite",
      runtimeKind: "static",
      buildCommand: "pnpm install --frozen-lockfile && pnpm build",
      output: "dist",
    });
  });

  it("detects pure Vite frontend projects without a start script as static", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-vite-static",
        scripts: {
          build: "vite build",
        },
        devDependencies: {
          vite: "^7.0.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      '<div id="app"></div>\n',
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      framework: "vite",
      runtimeKind: "static",
      output: "dist",
    });
    expect(result.detectedConfig.startCommand).toBe(null);
  });

  it("detects a raw static website folder as a static nginx runtime", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      '<link rel="stylesheet" href="/styles.css"><script src="/app.js"></script>\n',
    );
    fs.writeFileSync(path.join(tempDir, "styles.css"), "body{margin:0}\n");
    fs.writeFileSync(path.join(tempDir, "app.js"), "console.log('ready')\n");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.portIssue).toBe(null);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      version: "20",
      framework: "static",
      runtimeKind: "static",
      serviceRoot: ".",
      buildCommand: "true",
      output: ".",
      startCommand: "static-site",
    });
  });

  it("treats an explicit raw static html path as the runtime index file", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(path.join(tempDir, "landing.html"), "<html></html>\n");
    fs.writeFileSync(path.join(tempDir, "app.css"), "body{margin:0}\n");

    const result = await runArbitraryAnalyze({
      cwd: tempDir,
      path: "landing.html",
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      version: "20",
      framework: "static",
      runtimeKind: "static",
      serviceRoot: ".",
      buildCommand: "true",
      output: ".",
      startCommand: "static-site",
      staticIndexFile: "landing.html",
    });
  });

  it("uses an explicit directory path as the deploy service root", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const appDir = path.join(tempDir, "apps", "web");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "nested-vite",
        scripts: { build: "vite build" },
        devDependencies: { vite: "^7.0.0" },
      }),
    );
    fs.writeFileSync(path.join(appDir, "index.html"), '<div id="app"></div>');

    const result = await runArbitraryAnalyze({
      cwd: tempDir,
      path: "apps/web",
    });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      framework: "vite",
      runtimeKind: "static",
      serviceRoot: "apps/web",
      output: "dist",
    });
  });

  it("uses the first discovered html file as the raw static index fallback", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.mkdirSync(path.join(tempDir, "pages"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "landing.htm"), "<h1>Landing</h1>\n");
    fs.writeFileSync(
      path.join(tempDir, "pages", "about.html"),
      "<h1>About</h1>\n",
    );
    fs.writeFileSync(path.join(tempDir, "styles.css"), "body{margin:0}\n");
    const expectedIndexFile = firstDiscoveredHtml(tempDir);

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(expectedIndexFile).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      framework: "static",
      runtimeKind: "static",
      serviceRoot: ".",
      buildCommand: "true",
      output: ".",
      startCommand: "static-site",
      staticIndexFile: expectedIndexFile,
    });
  });

  it("does not block static Vite frontends on dev-server fixed ports", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-vite-dev-port",
        scripts: {
          build: "vite build",
        },
        devDependencies: {
          vite: "^7.0.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "vite.config.js"),
      "export default { server: { port: 5173 } };\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      '<div id="app"></div>\n',
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.portIssue).toBe(null);
    expect(result.detectedConfig.runtimeKind).toBe("static");
  });

  it("detects Gatsby build output as a static frontend runtime", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-gatsby",
        scripts: {
          build: "gatsby build",
        },
        dependencies: {
          gatsby: "^5.0.0",
        },
      }),
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      framework: "gatsby",
      runtimeKind: "static",
      output: "public",
      startCommand: null,
    });
  });

  it("detects Nuxt generate projects as static nginx runtime", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-nuxt-static",
        scripts: {
          build: "nuxt generate",
        },
        dependencies: {
          nuxt: "^4.2.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "nuxt.config.ts"),
      "export default defineNuxtConfig({})\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      framework: "nuxt",
      runtimeKind: "static",
      output: ".output/public",
      startCommand: null,
    });
  });

  it("keeps Nuxt server builds on the process runtime", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-nuxt-ssr",
        scripts: {
          build: "nuxt build",
          start: "node .output/server/index.mjs",
        },
        dependencies: {
          nuxt: "^4.2.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "nuxt.config.ts"),
      "export default defineNuxtConfig({})\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig).toMatchObject({
      language: "Node.js",
      framework: "nuxt",
      runtimeKind: "process",
      startCommand: "npm start",
    });
  });

  it("flags a fixed runtime port that does not honor PORT", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-node",
        main: "server.js",
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "server.js"),
      "const app = {};\napp.listen(3000)\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("PORT_CONFIGURATION_REQUIRED");
    expect(result.portIssue).toMatchObject({
      file: "server.js",
      line: 2,
      port: "3000",
    });
    expect(result.summary).toContain("Port Configuration Required");
    expect(result.summary).toContain("process.env.PORT || 3000");
  });

  it("ignores fixed-port matches inside test files", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-node",
        main: "server.js",
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "server.js"),
      "const port = process.env.PORT || 3000;\nconsole.log(port)\n",
    );
    fs.mkdirSync(path.join(tempDir, "__tests__"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "__tests__", "server.test.js"),
      "app.listen(3000)\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.portIssue).toBe(null);
  });

  it("asks for clarification when multiple services are detected at the same depth", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-node",
        main: "server.js",
      }),
    );
    fs.writeFileSync(path.join(tempDir, "server.js"), "console.log('ready')\n");
    fs.writeFileSync(path.join(tempDir, "go.mod"), "module demo\n\ngo 1.22\n");
    fs.writeFileSync(
      path.join(tempDir, "main.go"),
      "package main\nfunc main() {}\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("AMBIGUOUS_SERVICE");
    expect(result.summary).toContain(
      "Multiple runnable services were detected",
    );
  });

  it("asks the user when no supported runtime manifest is found", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(path.join(tempDir, "README.md"), "hello\n");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("UNKNOWN_RUNTIME");
    expect(result.summary).toContain(
      "Could not detect a supported language/runtime",
    );
  });

  it("asks the user when a build output cannot be inferred", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "demo-node",
        scripts: {
          build: "custom-build",
        },
        main: "server.js",
      }),
    );
    fs.writeFileSync(path.join(tempDir, "server.js"), "console.log('ready')\n");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(true);
    expect(result.reasonCode).toBe("OUTPUT_UNCLEAR");
    expect(result.summary).toContain("build output location is unclear");
  });

  it("detects a python requirements project", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(path.join(tempDir, "requirements.txt"), "flask==3.0.0\n");
    fs.writeFileSync(path.join(tempDir, "app.py"), "print('ready')\n");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.language).toBe("Python");
    expect(result.detectedConfig.version).toBe("3.11");
    expect(result.detectedConfig.buildCommand).toBe(
      "pip install --no-cache-dir -r requirements.txt",
    );
    expect(result.detectedConfig.startCommand).toBe("python app.py");
    expect(result.detectedConfig.output).toBe("Source files");
  });

  it("returns file context when package.json is malformed", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    const packageJsonPath = path.join(tempDir, "package.json");
    fs.writeFileSync(packageJsonPath, "{bad json");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(false);
    expect(result.message).toBe(`Invalid project file: ${packageJsonPath}`);
  });

  it("detects a nested php service without composer.json", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.mkdirSync(path.join(tempDir, "apps/site/public"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "apps/site/public/index.php"),
      "<?php echo 'ready';\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.language).toBe("PHP");
    expect(result.detectedConfig.serviceRoot).toBe("apps/site");
    expect(result.detectedConfig.buildCommand).toBe("php -l public/index.php");
  });

  it("discovers services rooted under tests directories", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.mkdirSync(path.join(tempDir, "tests/api"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "tests/api/package.json"),
      JSON.stringify({
        name: "api-service",
        main: "server.js",
      }),
    );
    fs.writeFileSync(
      path.join(tempDir, "tests/api/server.js"),
      "const port = process.env.PORT || 3000;\nconsole.log(port)\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.language).toBe("Node.js");
    expect(result.detectedConfig.serviceRoot).toBe("tests/api");
  });

  // Rack convention: when both files exist, `config.ru` is the canonical
  // entrypoint (it `require './app'`s the rest). The previous behavior
  // emitted AMBIGUOUS_ENTRYPOINT and blocked the consolidated flow on the
  // common Sinatra-with-config.ru layout (production hit: ruby-sinatra deploy
  // adt-f8f7644fb38c425280b0835ccdaa60bd) — the agent then had to supply
  // overrides, and a wrong one (`ruby app.rb` without `bundle exec`) shipped
  // and caused a 446 init timeout.
  it("prefers app.rb over config.ru for Ruby Rack apps and emits Sinatra-classic launch", async () => {
    // For Sinatra-with-app.rb layouts the historically-working command is
    // `bundle exec ruby app.rb`: Sinatra's classic runner picks the rack
    // server bundled in the Gemfile (puma here) via its native Ruby API
    // and binds to `set :bind` / `set :port` inside app.rb. Both prior
    // emissions (`rackup` and `bundle exec puma -b tcp://0.0.0.0:$PORT`)
    // reproducibly produced TCB SCF 446 with ~95s upstream timecost — the
    // user app exited before binding to $APP_PORT. The earlier production
    // hit adt-f8f7644fb38c425280b0835ccdaa60bd was an agent-supplied
    // override `ruby app.rb` *without* `bundle exec`; the form emitted
    // here always prefixes `bundle exec`.
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "Gemfile"),
      "source 'https://rubygems.org'\ngem 'sinatra'\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "app.rb"),
      "require 'sinatra'\nget '/' do; 'ok'; end\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "config.ru"),
      "require './app'\nrun Sinatra::Application\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.language).toBe("Ruby");
    expect(result.detectedConfig.startCommand).toBe("bundle exec ruby app.rb");
  });

  it("falls back to puma when only config.ru is present (no app.rb)", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "Gemfile"),
      "source 'https://rubygems.org'\ngem 'sinatra'\ngem 'puma'\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "config.ru"),
      "require 'sinatra/base'\nclass MyApp < Sinatra::Base; end\nrun MyApp\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.language).toBe("Ruby");
    expect(result.detectedConfig.startCommand).toBe(
      "bundle exec puma -b tcp://0.0.0.0:$PORT",
    );
  });

  it("reads Rust version from Cargo.toml's `rust-version` field", async () => {
    // Production hit: rust-actix Cargo.lock pulled actix-web@4.13.0 / actix-http@3.12.1
    // which require Rust 1.86+. The renderer defaulted to 1.85, so cargo build
    // fast-failed on CNB with no docker stdout to disambiguate. analyze should
    // honor the project's stated MSRV from Cargo.toml before falling back.
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "Cargo.toml"),
      '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\nrust-version = "1.89"\n\n[dependencies]\n',
    );
    fs.writeFileSync(path.join(tempDir, "Cargo.lock"), "");
    fs.mkdirSync(path.join(tempDir, "src"));
    fs.writeFileSync(path.join(tempDir, "src/main.rs"), "fn main() {}\n");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.detectedConfig.language).toBe("Rust");
    expect(result.detectedConfig.version).toBe("1.89");
  });

  it("falls back to a current Rust default when no version hints are present", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "Cargo.toml"),
      '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
    );
    fs.mkdirSync(path.join(tempDir, "src"));
    fs.writeFileSync(path.join(tempDir, "src/main.rs"), "fn main() {}\n");

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.detectedConfig.language).toBe("Rust");
    // The previous default (1.85) was too old for current actix-web Cargo.lock
    // files. Bump to a recent stable so non-pinned projects build out of the box.
    expect(result.detectedConfig.version).toBe("1.88");
  });

  it("still emits `bundle exec ruby app.rb` when only app.rb is present", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    fs.writeFileSync(
      path.join(tempDir, "Gemfile"),
      "source 'https://rubygems.org'\ngem 'sinatra'\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "app.rb"),
      "require 'sinatra'\nget '/' do; 'ok'; end\n",
    );

    const result = await runArbitraryAnalyze({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.needsUserInput).toBe(false);
    expect(result.detectedConfig.startCommand).toBe("bundle exec ruby app.rb");
  });
});
