import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it } from "vitest";

import { runRenderArbitraryDockerfiles } from "../arbitrary/renderDockerfiles.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESOURCE_SCRIPT_PATH = path.resolve(
  TEST_DIR,
  "..",
  "..",
  "resource",
  "buildDockerImage.sh",
);
const RESOURCE_NGINX_TEMPLATE_PATH = path.resolve(
  TEST_DIR,
  "..",
  "..",
  "resource",
  "contextPath",
  "nginx.conf.template",
);
const RESOURCE_ENTRYPOINT_PATH = path.resolve(
  TEST_DIR,
  "..",
  "..",
  "resource",
  "contextPath",
  "entrypoint.sh",
);
const RESOURCE_ACCESS_CONTROL_PATH = path.resolve(
  TEST_DIR,
  "..",
  "..",
  "resource",
  "contextPath",
  "nginx-access-control.sh",
);
const RESOURCE_STATIC_CONTEXT_ENV_PATH = path.resolve(
  TEST_DIR,
  "..",
  "..",
  "resource",
  "contextPath",
  "nginx-static-context-path.envsh",
);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glm-plan-render-"));
}

describe("arbitrary/renderDockerfiles", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("renders node dockerfiles and copies the immutable build script", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-1");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Node.js",
        version: "20",
        serviceRoot: ".",
        buildCommand: "npm ci && npm run build",
        output: "dist",
        startCommand: "npm start",
      },
    });

    expect(result.success).toBe(true);
    expect(result.agentWorkDir).toBe(agentWorkDir);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );
    const copiedScript = fs.readFileSync(
      path.join(agentWorkDir, "buildDockerImage.sh"),
      "utf8",
    );
    const sourceScript = fs.readFileSync(RESOURCE_SCRIPT_PATH, "utf8");
    const copiedStaticContextEnv = fs.readFileSync(
      path.join(agentWorkDir, "nginx-static-context-path.envsh"),
      "utf8",
    );
    const sourceStaticContextEnv = fs.readFileSync(
      RESOURCE_STATIC_CONTEXT_ENV_PATH,
      "utf8",
    );

    expect(dockerfileBuild).toContain("FROM node:20-slim");
    expect(dockerfileBuild).toContain("RUN npm ci && npm run build");
    expect(dockerfileBuild).toContain("cp -R . /output-mount/");
    expect(dockerfileRun).toContain("ENV PORT=9000");
    expect(dockerfileRun).toContain("ENV APP_PORT=9100");
    expect(dockerfileRun).toContain('ENV CONTEXT_PATH=""');
    expect(dockerfileRun).toContain('ENV USER_START_COMMAND="npm start"');
    expect(dockerfileRun).toContain(
      "apt-get install -y --no-install-recommends nginx gettext-base netcat-openbsd",
    );
    expect(dockerfileRun).toContain("COPY . /app/");
    expect(dockerfileRun).toContain(
      "COPY nginx.conf.template /etc/nginx/templates/default.conf.template",
    );
    expect(dockerfileRun).toContain(
      "COPY nginx-access-control.sh /nginx-access-control.sh",
    );
    expect(dockerfileRun).toContain("COPY entrypoint.sh /entrypoint.sh");
    expect(dockerfileRun).toContain(
      "RUN chmod +x /entrypoint.sh /nginx-access-control.sh",
    );
    expect(dockerfileRun).toContain('CMD ["/entrypoint.sh"]');
    expect(dockerfileRun).not.toContain('CMD ["sh", "-c", "exec npm start"]');
    expect(copiedScript).toBe(sourceScript);
    expect(copiedStaticContextEnv).toBe(sourceStaticContextEnv);
    // The orchestrator must stage nginx.conf.template + entrypoint.sh into
    // BUILD_OUTPUT_DIR before Step 3. Without this, Dockerfile.run's COPY
    // of those files fails on Go/Rust/Java because their Dockerfile.build
    // CMDs only copy the compiled artifact to /output-mount, not the whole
    // /build/ tree.
    expect(copiedScript).toContain(
      "for sidecar in nginx.conf.template entrypoint.sh nginx-access-control.sh nginx-static-context-path.envsh; do",
    );
    expect(copiedScript).toContain(
      'cp "${SCRIPT_DIR}/${sidecar}" "${BUILD_OUTPUT_DIR}/${sidecar}"',
    );
    expect(copiedScript).toContain(
      'chmod +x "${BUILD_OUTPUT_DIR}/entrypoint.sh"',
    );
    expect(copiedScript).toContain(
      'chmod +x "${BUILD_OUTPUT_DIR}/nginx-access-control.sh"',
    );
    expect(copiedScript).toContain(
      'chmod +x "${BUILD_OUTPUT_DIR}/nginx-static-context-path.envsh"',
    );
    // The CNB build job passes CONTEXT_PATH in its env. The orchestrator
    // must forward it as a docker build-arg so Dockerfile.build can bake
    // the platform-assigned URL prefix into the SPA bundle (Vite/Astro/
    // Angular --base flags, Nuxt env, etc.). Empty defaults to root.
    expect(copiedScript).toContain(
      '--build-arg "CONTEXT_PATH=${CONTEXT_PATH:-}"',
    );

    // Per-build uniqueness. CNB resolves `${APP_NAME}:latest` to a digest
    // and short-circuits the SCF function update when the digest looks
    // unchanged. Two failure modes were observed in production:
    //   1. Two deploys of the same source produce digest-identical images
    //      (BuildKit cache + deterministic layers), so SCF keeps serving
    //      the old image even though our nginx config changed.
    //   2. Operators have no traceable tag to roll back to.
    // Fix: the script stamps every runtime image with a unique build label,
    // which alters the manifest digest, AND pushes a unique companion tag
    // alongside `:latest` so each build is also addressable by tag.
    expect(copiedScript).toContain(
      'DEPLOY_BUILD_ID="${DEPLOY_BUILD_ID:-$(date +%s)',
    );
    expect(copiedScript).toContain(
      '--label "com.cc-deploy.build-id=${DEPLOY_BUILD_ID}"',
    );
    expect(copiedScript).toContain(
      'UNIQUE_IMAGE="${TCR_DOMAIN}/${TCR_NAMESPACE}/${APP_NAME}:cc-deploy-${DEPLOY_BUILD_ID}"',
    );
    expect(copiedScript).toContain('docker push "${UNIQUE_IMAGE}"');

    const copiedNginxTemplate = fs.readFileSync(
      path.join(agentWorkDir, "nginx.conf.template"),
      "utf8",
    );
    const copiedEntrypoint = fs.readFileSync(
      path.join(agentWorkDir, "entrypoint.sh"),
      "utf8",
    );
    const copiedAccessControl = fs.readFileSync(
      path.join(agentWorkDir, "nginx-access-control.sh"),
      "utf8",
    );
    expect(copiedNginxTemplate).toBe(
      fs.readFileSync(RESOURCE_NGINX_TEMPLATE_PATH, "utf8"),
    );
    expect(copiedEntrypoint).toBe(
      fs.readFileSync(RESOURCE_ENTRYPOINT_PATH, "utf8"),
    );
    expect(copiedAccessControl).toBe(
      fs.readFileSync(RESOURCE_ACCESS_CONTROL_PATH, "utf8"),
    );
    expect(result.nginxTemplatePath).toBe(
      path.join(agentWorkDir, "nginx.conf.template"),
    );
    expect(result.entrypointPath).toBe(
      path.join(agentWorkDir, "entrypoint.sh"),
    );
    expect(result.accessControlScriptPath).toBe(
      path.join(agentWorkDir, "nginx-access-control.sh"),
    );
    const entrypointStat = fs.statSync(
      path.join(agentWorkDir, "entrypoint.sh"),
    );
    expect((entrypointStat.mode & 0o111) !== 0).toBe(true);
    const accessControlStat = fs.statSync(
      path.join(agentWorkDir, "nginx-access-control.sh"),
    );
    expect((accessControlStat.mode & 0o111) !== 0).toBe(true);
  });

  it("renders static Node frontend builds as nginx-only runtime images", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-static");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Node.js",
        version: "22",
        framework: "vite",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "pnpm install --frozen-lockfile && pnpm build",
        output: "dist",
        startCommand: null,
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );
    const nginxTemplate = fs.readFileSync(
      path.join(agentWorkDir, "nginx.conf.template"),
      "utf8",
    );

    expect(dockerfileBuild).toContain("FROM node:22-slim");
    expect(dockerfileBuild).toContain(
      "RUN pnpm install --frozen-lockfile && pnpm build",
    );
    expect(dockerfileBuild).not.toContain("injectStaticContextPathBase");
    expect(dockerfileBuild).toContain("cp -R dist/. /output-mount/");

    expect(dockerfileRun).toContain("FROM nginx:1.27-alpine");
    expect(dockerfileRun).toContain("ENV PORT=9000");
    expect(dockerfileRun).toContain('ENV CONTEXT_PATH=""');
    expect(dockerfileRun).toContain("-name '*.envsh'");
    expect(dockerfileRun).toContain(
      "COPY nginx.conf.template /etc/nginx/templates/default.conf.template",
    );
    expect(dockerfileRun).toContain(
      "COPY nginx-access-control.sh /docker-entrypoint.d/10-zai-access-control.sh",
    );
    expect(dockerfileRun).toContain(
      "COPY nginx-static-context-path.envsh /docker-entrypoint.d/15-zai-static-context-path.envsh",
    );
    expect(dockerfileRun).toContain(
      "RUN chmod +x /docker-entrypoint.d/10-zai-access-control.sh /docker-entrypoint.d/15-zai-static-context-path.envsh",
    );
    expect(dockerfileRun).toContain('CMD ["nginx", "-g", "daemon off;"]');
    expect(dockerfileRun).not.toContain("APP_PORT");
    expect(dockerfileRun).not.toContain("USER_START_COMMAND");
    expect(dockerfileRun).not.toContain("entrypoint.sh");

    expect(nginxTemplate).toContain("root /usr/share/nginx/html;");
    expect(nginxTemplate).toContain(
      "include /tmp/cc-deploy/nginx-real-ip.conf;",
    );
    expect(nginxTemplate).toContain(
      "include /tmp/cc-deploy/nginx-access-control.conf;",
    );
    expect(nginxTemplate).toContain("try_files $uri $uri/ /index.html;");
    // Vite (and Astro/Angular/Nuxt) bake CONTEXT_PATH into the built HTML at
    // build time via `--base`/`--base-href`/NUXT_APP_BASE_URL. The nginx
    // sub_filter rewrites must NOT also run here, otherwise the prefix is
    // applied twice: Vite produces href="/<prefix>/assets/…" and nginx
    // would re-prepend the prefix to make href="/<prefix>/<prefix>/…",
    // which falls back through try_files to index.html and breaks the SPA.
    expect(nginxTemplate).not.toContain("sub_filter ");
    expect(nginxTemplate).not.toContain("proxy_pass");
  });

  it("static Node frontend with unknown framework keeps sub_filter as runtime fallback", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(
      tempDir,
      ".zai/deploy/arbitrary/run-static-unknown",
    );

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Node.js",
        version: "20",
        // No framework / one without a build-time --base hook (gatsby,
        // sveltekit-static, plain html-from-script, etc.). The build cannot
        // bake the prefix, so the runtime sub_filter rewrite is the only
        // mechanism that keeps absolute-rooted asset URLs working under
        // /<context>/ deployments.
        framework: "gatsby",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "npm ci && npm run build",
        output: "public",
        startCommand: null,
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const nginxTemplate = fs.readFileSync(
      path.join(agentWorkDir, "nginx.conf.template"),
      "utf8",
    );

    expect(dockerfileBuild).not.toContain("--base=");
    expect(dockerfileBuild).not.toContain("--base-href=");
    expect(dockerfileBuild).toContain("injectStaticContextPathBase");
    expect(dockerfileBuild).toContain('const htmlPath = "public/index.html";');
    expect(dockerfileBuild).toContain("const headPattern = /<head\\b[^>]*>/i;");
    expect(nginxTemplate).toContain(
      "sub_filter ' href=\"/'    ' href=\"${CONTEXT_PATH}/';",
    );
    expect(nginxTemplate).toContain(
      "sub_filter ' src=\"/'     ' src=\"${CONTEXT_PATH}/';",
    );
  });

  it("renders raw static website configs through the nginx runtime path", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(
      tempDir,
      ".zai/deploy/arbitrary/run-raw-static",
    );

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Node.js",
        version: "20",
        framework: "static",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "true",
        output: ".",
        startCommand: "static-site",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );
    const nginxTemplate = fs.readFileSync(
      path.join(agentWorkDir, "nginx.conf.template"),
      "utf8",
    );

    expect(dockerfileBuild).toContain("RUN true");
    expect(dockerfileBuild).toContain("injectStaticContextPathBase");
    expect(dockerfileBuild).toContain('const htmlPath = "index.html";');
    expect(dockerfileBuild).toContain("const headPattern = /<head\\b[^>]*>/i;");
    expect(dockerfileBuild).toContain("cp -R ./.");
    expect(dockerfileRun).toContain("FROM nginx:1.27-alpine");
    expect(dockerfileRun).not.toContain("USER_START_COMMAND");
    expect(nginxTemplate).toContain("try_files $uri $uri/ /index.html;");
    expect(nginxTemplate).toContain("sub_filter ");
    expect(nginxTemplate).not.toContain("base href");
    const staticContextPathEnv = fs.readFileSync(
      path.join(agentWorkDir, "nginx-static-context-path.envsh"),
      "utf8",
    );
    expect(staticContextPathEnv).toContain("normalize_context_path");
  });

  it("copies a selected raw static html file to index.html during Docker build", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(
      tempDir,
      ".zai/deploy/arbitrary/run-raw-static-entry",
    );

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Node.js",
        version: "20",
        framework: "static",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "true",
        output: ".",
        startCommand: "static-site",
        staticIndexFile: "pages/home.html",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );

    expect(dockerfileBuild).toContain(
      "RUN cp './pages/home.html' ./index.html",
    );
    expect(dockerfileBuild).toContain("RUN true");
  });

  it("keeps Vite-backed Node server apps on the process runtime", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-server");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Node.js",
        version: "20",
        framework: "vite",
        runtimeKind: "process",
        serviceRoot: ".",
        buildCommand: "npm ci && npm run build",
        output: "dist",
        startCommand: "npm start",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );

    expect(dockerfileRun).toContain("FROM node:20-slim");
    expect(dockerfileRun).toContain("ENV APP_PORT=9100");
    expect(dockerfileRun).toContain('ENV USER_START_COMMAND="npm start"');
    expect(dockerfileRun).toContain('CMD ["/entrypoint.sh"]');
    expect(dockerfileRun).not.toContain("FROM nginx:1.27-alpine");
  });

  it("installs native-build deps before bundle install for Ruby, but keeps the runtime slim", async () => {
    // ruby-sinatra CNB failure: ruby:*-slim has no toolchain, so gems with
    // native extensions (nio4r, puma) fail to compile during bundle install
    // and buildDockerImage.sh exits 1. Build deps belong in the build stage
    // only — the runtime image copies already-compiled vendored gems.
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-ruby");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Ruby",
        version: "3.2",
        runtimeKind: "process",
        serviceRoot: ".",
        buildCommand: "bundle install --deployment --without development test",
        output: "Source files",
        startCommand:
          "bundle exec rackup config.ru --host 0.0.0.0 --port $PORT",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );

    expect(dockerfileBuild).toContain("FROM ruby:3.2-slim");
    expect(dockerfileBuild).toMatch(/apt-get install[^\n]*build-essential/);
    const depsIdx = dockerfileBuild.indexOf("build-essential");
    const bundleIdx = dockerfileBuild.indexOf("bundle install");
    expect(depsIdx).toBeGreaterThan(-1);
    expect(bundleIdx).toBeGreaterThan(-1);
    expect(depsIdx).toBeLessThan(bundleIdx);
    // Runtime image stays slim — no compiler toolchain baked in.
    expect(dockerfileRun).not.toContain("build-essential");
    // Ruby cold-start under bundle exec + vendored gems regularly overshoots
    // the entrypoint's default 60s wait for $APP_PORT; bake in a 120s window
    // so puma/rackup has time to load and bind before nginx is gated up.
    expect(dockerfileRun).toContain("ENV APP_BOOT_TIMEOUT_SECONDS=120");
  });

  it("declares BUNDLE_PATH/BUNDLE_WITHOUT in the Ruby runtime so vendored gems resolve", async () => {
    // ruby-sinatra runtime GemNotFound: the build installs gems into
    // vendor/bundle, but ruby:*-slim sets BUNDLE_APP_CONFIG=/usr/local/bundle,
    // so the `bundle config --local`/`--deployment` path setting is written
    // inside the build image's /usr/local/bundle/config — which never ships to
    // the run image (only /build -> /app travels). At runtime bundler then
    // defaults to GEM_HOME=/usr/local/bundle (empty) and raises
    // Bundler::GemNotFound for the production gems. The run image must declare
    // the gem path via ENV (which bundler honors regardless of
    // BUNDLE_APP_CONFIG) and skip the dev/test groups that were never
    // installed so `bundle exec` does not demand them.
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(
      tempDir,
      ".zai/deploy/arbitrary/run-ruby-gems",
    );

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Ruby",
        version: "3.2",
        runtimeKind: "process",
        serviceRoot: ".",
        buildCommand: "bundle install --deployment --without development test",
        output: "Source files",
        startCommand: "bundle exec ruby app.rb",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );

    expect(dockerfileRun).toContain('ENV BUNDLE_PATH="/app/vendor/bundle"');
    expect(dockerfileRun).toContain('ENV BUNDLE_WITHOUT="development:test"');
  });

  it("installs native-build deps before cargo build for Rust, but keeps the runtime slim", async () => {
    // rust-actix CNB failure (adt-0dac65d8cb4046c0b2baca1eabe9acac): rust:*-slim
    // ships rustc + cargo + a linker but no pkg-config / libssl-dev / cmake.
    // Several actix-web transitive crates have build.rs scripts that need them,
    // and the user's own committed Dockerfile.build at tests/rust-actix/ already
    // installs pkg-config — empirical evidence the gap is real. Match the Ruby
    // renderer's pattern: deps in the build stage only; the runtime image is
    // debian:bookworm-slim and just copies the compiled binary.
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-rust");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Rust",
        version: "1.85",
        runtimeKind: "process",
        serviceRoot: ".",
        buildCommand: "cargo build --release --locked",
        output: "target/release/app",
        startCommand: "./app",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );

    expect(dockerfileBuild).toContain(
      "FROM --platform=linux/${TARGETARCH} rust:1.85-slim",
    );
    expect(dockerfileBuild).toMatch(/apt-get install[^\n]*pkg-config/);
    expect(dockerfileBuild).toMatch(/apt-get install[^\n]*libssl-dev/);
    expect(dockerfileBuild).toMatch(/apt-get install[^\n]*build-essential/);
    const depsIdx = dockerfileBuild.indexOf("pkg-config");
    const cargoIdx = dockerfileBuild.indexOf("cargo build");
    expect(depsIdx).toBeGreaterThan(-1);
    expect(cargoIdx).toBeGreaterThan(-1);
    expect(depsIdx).toBeLessThan(cargoIdx);
    // Runtime image stays slim — no build toolchain baked in.
    expect(dockerfileRun).not.toContain("build-essential");
    expect(dockerfileRun).not.toContain("libssl-dev");
    // …but it MUST ship libssl3, because any -sys crate in the dep tree that
    // links openssl dynamically produces a binary that needs libssl.so.3 at
    // runtime. debian:bookworm-slim doesn't ship it; without this, the
    // container exits on dlopen and SCF reports init timeout / 446.
    expect(dockerfileRun).toMatch(/apt-get install[^\n]*libssl3/);
  });

  it("normalizes semver-range node versions before rendering image tags", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-semver");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Node.js",
        version: "18.17.0+",
        serviceRoot: ".",
        buildCommand: "npm ci",
        output: "Source files",
        startCommand: "npm start",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );

    expect(dockerfileBuild).toContain("FROM node:18.17.0-slim");
    expect(dockerfileRun).toContain("FROM node:18.17.0-slim");
    expect(dockerfileBuild).not.toContain("18.17.0+");
    expect(dockerfileRun).not.toContain("18.17.0+");
  });

  it("renders java dockerfiles with build-tool-aware images", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-2");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Java",
        version: "17",
        serviceRoot: ".",
        buildCommand: "mvn clean package -DskipTests",
        output: "target/*.jar",
        startCommand: "java -jar app.jar",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );

    expect(dockerfileBuild).toContain("FROM maven:3.9-eclipse-temurin-17");
    expect(dockerfileBuild).toContain("RUN mvn clean package -DskipTests");
    expect(dockerfileBuild).toContain("cp target/*.jar /output-mount/app.jar");
    expect(dockerfileRun).toContain("FROM eclipse-temurin:17-jre");
    expect(dockerfileRun).toContain(
      'ENV USER_START_COMMAND="java -Dserver.port=\\$PORT -jar app.jar"',
    );
    expect(dockerfileRun).toContain('CMD ["/entrypoint.sh"]');
  });

  it("fails for unsupported runtime templates", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir: path.join(tempDir, "agent-work"),
      detectedConfig: {
        language: "Elixir",
        version: "1.17",
        buildCommand: "mix deps.get",
        output: "_build/prod",
        startCommand: "mix phx.server",
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Unsupported runtime");
  });

  it("renders python Pipenv dependencies into /build/python-deps", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-3");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Python",
        version: "3.11",
        serviceRoot: ".",
        buildCommand: "pipenv install --deploy",
        output: "Source files",
        startCommand: "python app.py",
      },
    });

    expect(result.success).toBe(true);

    const dockerfileBuild = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.build"),
      "utf8",
    );
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );

    expect(dockerfileBuild).toContain("RUN mkdir -p /build/python-deps &&");
    expect(dockerfileBuild).toContain("pip install --no-cache-dir pipenv");
    expect(dockerfileBuild).toContain(
      "pipenv requirements > /tmp/requirements.txt",
    );
    expect(dockerfileBuild).toContain(
      "pip install --no-cache-dir --target /build/python-deps -r /tmp/requirements.txt",
    );
    expect(dockerfileRun).toContain("ENV PYTHONPATH=/app/python-deps");
  });

  it("escapes USER_START_COMMAND so $PORT stays literal in the Dockerfile env", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-escape");

    const result = await runRenderArbitraryDockerfiles({
      cwd: tempDir,
      agentWorkDir,
      detectedConfig: {
        language: "Node.js",
        version: "20",
        serviceRoot: ".",
        buildCommand: "npm ci",
        startCommand: 'sh -c "node server.js --port $PORT"',
      },
    });

    expect(result.success).toBe(true);
    const dockerfileRun = fs.readFileSync(
      path.join(agentWorkDir, "Dockerfile.run"),
      "utf8",
    );
    expect(dockerfileRun).toContain(
      'ENV USER_START_COMMAND="sh -c \\"node server.js --port \\$PORT\\""',
    );
  });

  describe("build-tool preamble for Node.js projects", () => {
    // Regression: node:*-slim ships only `node`/`npm`/`npx`. Any pnpm or
    // yarn-berry project failed on the first RUN until the renderer started
    // installing the detected package manager up-front. See plan
    // `.agent/plan-build-tool-preamble/main.md`.

    function renderNodeBuild(detectedConfig) {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-pm");
      return runRenderArbitraryDockerfiles({
        cwd: tempDir,
        agentWorkDir,
        detectedConfig,
      }).then((result) => {
        expect(result.success).toBe(true);
        return fs.readFileSync(
          path.join(agentWorkDir, "Dockerfile.build"),
          "utf8",
        );
      });
    }

    it("pins pnpm@<exact> from packageManager when supplied (process runtime)", async () => {
      const dockerfileBuild = await renderNodeBuild({
        language: "Node.js",
        version: "20",
        serviceRoot: ".",
        buildCommand: "pnpm install --frozen-lockfile && pnpm build",
        startCommand: "node server.js",
        packageManager: {
          name: "pnpm",
          versionSpec: "10.6.5",
          source: "packageManager",
        },
      });
      // The preamble must appear BEFORE the user buildCommand so the tool
      // is on $PATH when the install step runs.
      const preambleIdx = dockerfileBuild.indexOf(
        "RUN npm install --global pnpm@10.6.5",
      );
      const buildIdx = dockerfileBuild.indexOf(
        "RUN pnpm install --frozen-lockfile && pnpm build",
      );
      expect(preambleIdx).toBeGreaterThan(-1);
      expect(buildIdx).toBeGreaterThan(preambleIdx);
    });

    it("pins pnpm@<major> from lockfile when packageManager is absent", async () => {
      const dockerfileBuild = await renderNodeBuild({
        language: "Node.js",
        version: "20",
        serviceRoot: ".",
        buildCommand: "pnpm install --frozen-lockfile && pnpm build",
        startCommand: "node server.js",
        packageManager: { name: "pnpm", versionSpec: "10", source: "lockfile" },
      });
      expect(dockerfileBuild).toContain("RUN npm install --global pnpm@10");
    });

    it("pins yarn@<exact> for yarn berry projects from packageManager", async () => {
      const dockerfileBuild = await renderNodeBuild({
        language: "Node.js",
        version: "20",
        serviceRoot: ".",
        buildCommand: "yarn install --immutable && yarn build",
        startCommand: "node server.js",
        packageManager: {
          name: "yarn",
          versionSpec: "4.4.0",
          source: "packageManager",
        },
      });
      expect(dockerfileBuild).toContain("RUN npm install --global yarn@4.4.0");
    });

    it("emits NO preamble for npm-only projects (npm ships in the base image)", async () => {
      const dockerfileBuild = await renderNodeBuild({
        language: "Node.js",
        version: "20",
        serviceRoot: ".",
        buildCommand: "npm ci && npm run build",
        startCommand: "node server.js",
        packageManager: null,
      });
      expect(dockerfileBuild).not.toContain("npm install --global pnpm");
      expect(dockerfileBuild).not.toContain("npm install --global yarn");
    });

    it("falls back to pnpm@latest when the spec is only the tool name", async () => {
      const dockerfileBuild = await renderNodeBuild({
        language: "Node.js",
        version: "20",
        serviceRoot: ".",
        buildCommand: "pnpm install && pnpm build",
        startCommand: "node server.js",
        packageManager: {
          name: "pnpm",
          versionSpec: null,
          source: "buildCommand",
        },
      });
      expect(dockerfileBuild).toContain("RUN npm install --global pnpm@latest");
    });

    it("also injects the preamble into the static-Node-frontend renderer", async () => {
      const dockerfileBuild = await renderNodeBuild({
        language: "Node.js",
        version: "20",
        framework: "vite",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "pnpm install --frozen-lockfile && pnpm build",
        output: "dist",
        packageManager: {
          name: "pnpm",
          versionSpec: "10.6.5",
          source: "packageManager",
        },
      });
      // Same preamble shape as the process renderer.
      expect(dockerfileBuild).toContain("RUN npm install --global pnpm@10.6.5");
      // And the build still runs after it.
      const preambleIdx = dockerfileBuild.indexOf(
        "RUN npm install --global pnpm@10.6.5",
      );
      const buildIdx = dockerfileBuild.indexOf(
        "RUN pnpm install --frozen-lockfile && pnpm build",
      );
      expect(buildIdx).toBeGreaterThan(preambleIdx);
    });
  });

  describe("SPA build-time CONTEXT_PATH (base path baked into bundle)", () => {
    // Regression: the Vue starter project deployed successfully but
    // `<RouterLink to="/about">` rendered `<a href="/about">` because the
    // Vite build had no `--base`. Nginx sub_filter cannot rewrite DOM that
    // Vue constructs at runtime. Fix: forward the platform-assigned
    // CONTEXT_PATH from the CNB job → docker build-arg → Dockerfile.build
    // → framework-native base-path flag/env. Zero user source mod.

    async function renderStaticBuild(detectedConfig) {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const agentWorkDir = path.join(tempDir, ".zai/deploy/arbitrary/run-spa");
      const result = await runRenderArbitraryDockerfiles({
        cwd: tempDir,
        agentWorkDir,
        detectedConfig,
      });
      expect(result.success).toBe(true);
      return fs.readFileSync(
        path.join(agentWorkDir, "Dockerfile.build"),
        "utf8",
      );
    }

    it("Vite: declares ARG CONTEXT_PATH and passes --base to vite build", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "vite",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "pnpm install --frozen-lockfile && pnpm build",
        output: "dist",
        packageManager: {
          name: "pnpm",
          versionSpec: "10",
          source: "lockfile",
        },
      });
      // ARG must come before any RUN that consumes the value.
      expect(dockerfileBuild).toMatch(/ARG CONTEXT_PATH=""/);
      expect(dockerfileBuild).toContain("ENV CONTEXT_PATH=${CONTEXT_PATH}");
      // The build command must take a --base flag derived from CONTEXT_PATH.
      // Empty CONTEXT_PATH expands to /, which is Vite's default (root deploy).
      expect(dockerfileBuild).toContain('--base="${CONTEXT_PATH:-}/"');
      // Regression: pnpm/yarn MUST NOT emit a `--` separator between the
      // user's build command and `--base=…`. Vite treats `--` as the
      // positional terminator and silently swallows flags after it.
      expect(dockerfileBuild).not.toMatch(
        /pnpm build -- --base=|yarn build -- --base=/,
      );
      const argIdx = dockerfileBuild.indexOf("ARG CONTEXT_PATH");
      const runIdx = dockerfileBuild.indexOf("--base=");
      expect(runIdx).toBeGreaterThan(argIdx);
    });

    it("Vite + npm: uses npm's argument separator so --base reaches vite", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "vite",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "npm ci && npm run build",
        output: "dist",
      });

      expect(dockerfileBuild).toContain(
        'RUN npm ci && npm run build -- --base="${CONTEXT_PATH:-}/"',
      );
      expect(dockerfileBuild).not.toContain(
        'RUN npm ci && npm run build --base="${CONTEXT_PATH:-}/"',
      );
    });

    it("Astro: passes --base to astro build", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "astro",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "pnpm install --frozen-lockfile && pnpm build",
        output: "dist",
        packageManager: {
          name: "pnpm",
          versionSpec: "10",
          source: "lockfile",
        },
      });
      expect(dockerfileBuild).toMatch(/ARG CONTEXT_PATH=""/);
      expect(dockerfileBuild).toContain('--base="${CONTEXT_PATH:-}/"');
      // Same `--`-swallowing risk as Vite.
      expect(dockerfileBuild).not.toMatch(
        /pnpm build -- --base=|yarn build -- --base=/,
      );
    });

    it("Astro + npm: uses npm's argument separator so --base reaches astro", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "astro",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "npm ci && npm run build",
        output: "dist",
      });

      expect(dockerfileBuild).toContain(
        'RUN npm ci && npm run build -- --base="${CONTEXT_PATH:-}/"',
      );
      expect(dockerfileBuild).not.toContain(
        'RUN npm ci && npm run build --base="${CONTEXT_PATH:-}/"',
      );
    });

    it("Angular: passes --base-href to ng build", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "angular",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "npm ci && npm run build",
        output: "dist",
      });
      expect(dockerfileBuild).toMatch(/ARG CONTEXT_PATH=""/);
      expect(dockerfileBuild).toContain('--base-href="${CONTEXT_PATH:-}/"');
      expect(dockerfileBuild).toContain(
        'RUN npm ci && npm run build -- --base-href="${CONTEXT_PATH:-}/"',
      );
    });

    it("Angular + pnpm: keeps --base-href as a bare script argument", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "angular",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "pnpm install --frozen-lockfile && pnpm build",
        output: "dist",
        packageManager: {
          name: "pnpm",
          versionSpec: "10",
          source: "lockfile",
        },
      });

      expect(dockerfileBuild).toContain(
        'RUN pnpm install --frozen-lockfile && pnpm build --base-href="${CONTEXT_PATH:-}/"',
      );
      expect(dockerfileBuild).not.toContain("pnpm build -- --base-href=");
    });

    it("Unknown static framework (e.g. gatsby): falls back to env CONTEXT_PATH only, no flag injection", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "gatsby",
        runtimeKind: "static",
        serviceRoot: ".",
        buildCommand: "npm ci && npm run build",
        output: "public",
      });
      // ARG/ENV still present so user buildCommand can read it if needed
      expect(dockerfileBuild).toMatch(/ARG CONTEXT_PATH=""/);
      expect(dockerfileBuild).toContain("ENV CONTEXT_PATH=${CONTEXT_PATH}");
      // No --base or --base-href flag injected for unknown frameworks
      expect(dockerfileBuild).not.toContain("--base=");
      expect(dockerfileBuild).not.toContain("--base-href=");
    });

    it("Nuxt (process runtime): exports NUXT_APP_BASE_URL from CONTEXT_PATH", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "nuxt",
        runtimeKind: "process",
        serviceRoot: ".",
        buildCommand: "pnpm install --frozen-lockfile && pnpm build",
        startCommand: "node .output/server/index.mjs",
        packageManager: {
          name: "pnpm",
          versionSpec: "10",
          source: "lockfile",
        },
      });
      expect(dockerfileBuild).toMatch(/ARG CONTEXT_PATH=""/);
      // Nuxt reads NUXT_APP_BASE_URL natively. Set it before the build runs.
      expect(dockerfileBuild).toContain(
        "ENV NUXT_APP_BASE_URL=${CONTEXT_PATH:-/}/",
      );
    });

    it("Nuxt static runtime: uses NUXT_APP_BASE_URL and no CLI base flag", async () => {
      const tempDir = makeTempDir();
      tempDirs.push(tempDir);
      const agentWorkDir = path.join(
        tempDir,
        ".zai/deploy/arbitrary/run-nuxt-static",
      );

      const result = await runRenderArbitraryDockerfiles({
        cwd: tempDir,
        agentWorkDir,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          framework: "nuxt",
          runtimeKind: "static",
          serviceRoot: ".",
          buildCommand: "npm ci && npm run build",
          output: ".output/public",
          startCommand: null,
        },
      });

      expect(result.success).toBe(true);

      const dockerfileBuild = fs.readFileSync(
        path.join(agentWorkDir, "Dockerfile.build"),
        "utf8",
      );
      const nginxTemplate = fs.readFileSync(
        path.join(agentWorkDir, "nginx.conf.template"),
        "utf8",
      );

      expect(dockerfileBuild).toContain(
        "ENV NUXT_APP_BASE_URL=${CONTEXT_PATH:-/}/",
      );
      expect(dockerfileBuild).not.toContain("--base=");
      expect(dockerfileBuild).not.toContain("--base-href=");
      expect(nginxTemplate).not.toContain("sub_filter ");
    });

    it("non-SPA process runtime (plain Node express): no SPA base-path injection", async () => {
      const dockerfileBuild = await renderStaticBuild({
        language: "Node.js",
        version: "20",
        framework: "express",
        runtimeKind: "process",
        serviceRoot: ".",
        buildCommand: "npm ci",
        startCommand: "node server.js",
      });
      // No SPA-specific build flags for backend services
      expect(dockerfileBuild).not.toContain("--base=");
      expect(dockerfileBuild).not.toContain("--base-href=");
      expect(dockerfileBuild).not.toContain("NUXT_APP_BASE_URL");
    });
  });

  describe("context path support across languages", () => {
    const cases = [
      {
        language: "Node.js",
        config: {
          language: "Node.js",
          version: "20",
          serviceRoot: ".",
          buildCommand: "npm ci",
          startCommand: "node server.js",
        },
        installSnippet:
          "apt-get install -y --no-install-recommends nginx gettext-base netcat-openbsd",
      },
      {
        language: "Go",
        config: {
          language: "Go",
          version: "1.21",
          serviceRoot: ".",
          buildCommand: "go build -o server .",
          output: "server",
          startCommand: "./server",
        },
        installSnippet: "apk add --no-cache ca-certificates nginx gettext",
      },
      {
        language: "Rust",
        config: {
          language: "Rust",
          version: "1.85",
          serviceRoot: ".",
          buildCommand: "cargo build --release",
          output: "target/release/app",
          startCommand: "./app",
        },
        installSnippet:
          "apt-get install -y --no-install-recommends ca-certificates nginx gettext-base netcat-openbsd",
      },
      {
        language: "Java",
        config: {
          language: "Java",
          version: "17",
          serviceRoot: ".",
          buildCommand: "mvn clean package -DskipTests",
          output: "target/*.jar",
          startCommand: "java -jar app.jar",
        },
        installSnippet:
          "apt-get install -y --no-install-recommends nginx gettext-base netcat-openbsd",
      },
      {
        language: "Python",
        config: {
          language: "Python",
          version: "3.11",
          serviceRoot: ".",
          buildCommand: "pip install --no-cache-dir -r requirements.txt",
          startCommand: "python app.py",
        },
        installSnippet:
          "apt-get install -y --no-install-recommends nginx gettext-base netcat-openbsd",
      },
      {
        language: "Ruby",
        config: {
          language: "Ruby",
          version: "3.2",
          serviceRoot: ".",
          buildCommand:
            "bundle install --deployment --without development test",
          startCommand: "bundle exec ruby app.rb",
        },
        installSnippet:
          "apt-get install -y --no-install-recommends nginx gettext-base netcat-openbsd",
      },
      {
        language: "PHP",
        config: {
          language: "PHP",
          version: "8.2",
          serviceRoot: ".",
          buildCommand: "composer install --no-dev --optimize-autoloader",
          startCommand: "php -S 0.0.0.0:$PORT",
        },
        installSnippet:
          "apt-get install -y --no-install-recommends nginx gettext-base netcat-openbsd",
      },
    ];

    for (const testCase of cases) {
      it(`adds the front-proxy layer for ${testCase.language}`, async () => {
        const tempDir = makeTempDir();
        tempDirs.push(tempDir);
        const agentWorkDir = path.join(
          tempDir,
          `.zai/deploy/arbitrary/run-${testCase.language.toLowerCase()}`,
        );

        const result = await runRenderArbitraryDockerfiles({
          cwd: tempDir,
          agentWorkDir,
          detectedConfig: testCase.config,
        });

        expect(result.success).toBe(true);

        const dockerfileRun = fs.readFileSync(
          path.join(agentWorkDir, "Dockerfile.run"),
          "utf8",
        );

        expect(dockerfileRun).toContain("ENV PORT=9000");
        expect(dockerfileRun).toContain("ENV APP_PORT=9100");
        expect(dockerfileRun).toContain('ENV CONTEXT_PATH=""');
        expect(dockerfileRun).toContain("ENV USER_START_COMMAND=");
        expect(dockerfileRun).toContain(testCase.installSnippet);
        expect(dockerfileRun).toContain(
          "COPY nginx.conf.template /etc/nginx/templates/default.conf.template",
        );
        expect(dockerfileRun).toContain(
          "COPY nginx-access-control.sh /nginx-access-control.sh",
        );
        expect(dockerfileRun).toContain("COPY entrypoint.sh /entrypoint.sh");
        expect(dockerfileRun).toContain(
          "RUN chmod +x /entrypoint.sh /nginx-access-control.sh",
        );
        expect(dockerfileRun).toContain("EXPOSE 9000");
        expect(dockerfileRun).toContain('CMD ["/entrypoint.sh"]');

        const nginxTemplate = fs.readFileSync(
          path.join(agentWorkDir, "nginx.conf.template"),
          "utf8",
        );
        expect(nginxTemplate).toContain("listen ${PORT};");
        expect(nginxTemplate).toContain(
          "include /tmp/cc-deploy/nginx-real-ip.conf;",
        );
        expect(nginxTemplate).toContain(
          "include /tmp/cc-deploy/nginx-access-control.conf;",
        );
        expect(nginxTemplate).toContain(
          "proxy_pass http://127.0.0.1:${APP_PORT};",
        );
        expect(nginxTemplate).toContain(
          'proxy_set_header X-Forwarded-Prefix "${CONTEXT_PATH}";',
        );
        expect(nginxTemplate).toContain(
          "sub_filter ' href=\"/'    ' href=\"${CONTEXT_PATH}/';",
        );
        expect(nginxTemplate).toContain(
          "sub_filter ' src=\"/'     ' src=\"${CONTEXT_PATH}/';",
        );
        expect(nginxTemplate).toContain(
          "sub_filter ' srcset=\"/'  ' srcset=\"${CONTEXT_PATH}/';",
        );

        const entrypoint = fs.readFileSync(
          path.join(agentWorkDir, "entrypoint.sh"),
          "utf8",
        );
        const accessControlScript = fs.readFileSync(
          path.join(agentWorkDir, "nginx-access-control.sh"),
          "utf8",
        );
        expect(entrypoint).toContain("envsubst");
        expect(entrypoint).toContain("/nginx-access-control.sh");
        expect(accessControlScript).toContain(
          "ZAI_NGINX_REAL_IP_DIRECTIVES_B64",
        );
        expect(accessControlScript).toContain(
          "ZAI_NGINX_ACCESS_DIRECTIVES_B64",
        );
        expect(entrypoint).toContain(
          'PORT="$APP_PORT" sh -c "$USER_START_COMMAND"',
        );
        expect(entrypoint).toContain("normalize_context_path");
        // Portable supervisor must not depend on bash-only `wait -n` because
        // every debian-slim base image ships dash as /bin/sh, which lacks it.
        expect(entrypoint).not.toMatch(/^\s*wait -n\b/m);
        expect(entrypoint).toContain("kill -0");
        // Drop <base href> injection when CONTEXT_PATH is empty so we don't
        // emit a `<base href="/">` that silently changes relative URL semantics.
        expect(entrypoint).toContain(
          "sed -i '/<base href=/d' \"$RENDERED_PATH\"",
        );
        // Collapse multi-leading-slash inputs to a single slash so the
        // injected `<base>` is never protocol-relative.
        expect(entrypoint).toContain('//*) value="${value#/}" ;;');
        // Alpine's `apk add nginx` puts the http-block include under
        // /etc/nginx/http.d/, while /etc/nginx/conf.d/ on Alpine is included
        // at the top level (outside `http { }`). Writing our rendered
        // `server { ... }` block to conf.d on Alpine produces
        // `"server" directive is not allowed here` and nginx never starts,
        // which is exactly the SCF 446 / 93s-init-timeout signature observed
        // for Go deploys (adt-67205a6c80a54ab8aa5139ab1a77c026). Detect the
        // correct include directory at runtime instead of hard-coding conf.d.
        expect(entrypoint).toContain("if [ -d /etc/nginx/http.d ]; then");
        expect(entrypoint).toContain(
          'RENDERED_PATH="${NGINX_RENDERED_PATH:-/etc/nginx/http.d/default.conf}"',
        );
        expect(entrypoint).toContain(
          'RENDERED_PATH="${NGINX_RENDERED_PATH:-/etc/nginx/conf.d/default.conf}"',
        );

        // Cold-start 502 fix: nginx is gated on the user app's TCP readiness,
        // probed via `nc -z 127.0.0.1 $APP_PORT` and capped by
        // APP_BOOT_TIMEOUT_SECONDS (default 60s). The user app must launch
        // BEFORE wait_for_app_port runs, and nginx must launch AFTER it.
        expect(entrypoint).toContain("wait_for_app_port");
        expect(entrypoint).toContain('nc -z 127.0.0.1 "$target_port"');
        expect(entrypoint).toContain('"${APP_BOOT_TIMEOUT_SECONDS:-60}"');
        const appLaunchIdx = entrypoint.indexOf(
          'PORT="$APP_PORT" sh -c "$USER_START_COMMAND"',
        );
        const waitIdx = entrypoint.indexOf(
          'wait_for_app_port "$APP_PORT" "$APP_PID"',
        );
        const nginxLaunchIdx = entrypoint.indexOf("nginx -g 'daemon off;' &");
        expect(appLaunchIdx).toBeGreaterThan(-1);
        expect(waitIdx).toBeGreaterThan(appLaunchIdx);
        expect(nginxLaunchIdx).toBeGreaterThan(waitIdx);

        // The nginx config must convert any runtime upstream blip (502/504)
        // into a 503 with a Retry-After header so callers (and the platform's
        // edge router) can back off cleanly. proxy_connect_timeout is also
        // tightened so a dead upstream surfaces fast instead of after 60s.
        expect(nginxTemplate).toContain(
          "error_page 502 504 = @upstream_unavailable;",
        );
        expect(nginxTemplate).toContain("location @upstream_unavailable {");
        expect(nginxTemplate).toContain("add_header Retry-After 5 always;");
        expect(nginxTemplate).toContain("proxy_connect_timeout 5s;");
      });
    }
  });
});
