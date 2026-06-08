"use strict";

const fs = require("fs");
const path = require("path");

async function runRenderArbitraryDockerfiles(options = {}) {
  try {
    const cwd = options.cwd || process.cwd();
    const agentWorkDir = resolveRequiredDir(
      options.agentWorkDir,
      "agentWorkDir",
      cwd,
    );
    const detectedConfig = resolveDetectedConfig(
      options.detectedConfig,
      options,
    );
    const renderer = RENDERERS[detectedConfig.language];

    if (!renderer) {
      return failure(
        `Unsupported runtime for scripted Dockerfile generation: ${detectedConfig.language}`,
      );
    }

    fs.mkdirSync(agentWorkDir, { recursive: true });
    const rendered = renderer(detectedConfig);
    const dockerfileBuildPath = path.join(agentWorkDir, "Dockerfile.build");
    const dockerfileRunPath = path.join(agentWorkDir, "Dockerfile.run");
    const scriptPath = path.join(agentWorkDir, "buildDockerImage.sh");
    const nginxTemplatePath = path.join(agentWorkDir, "nginx.conf.template");
    const entrypointPath = path.join(agentWorkDir, "entrypoint.sh");
    const accessControlScriptPath = path.join(
      agentWorkDir,
      "nginx-access-control.sh",
    );
    const staticContextEnvPath = path.join(
      agentWorkDir,
      "nginx-static-context-path.envsh",
    );

    fs.writeFileSync(
      dockerfileBuildPath,
      `${rendered.dockerfileBuild.trim()}\n`,
      "utf8",
    );
    fs.writeFileSync(
      dockerfileRunPath,
      `${rendered.dockerfileRun.trim()}\n`,
      "utf8",
    );
    writeNginxTemplate(nginxTemplatePath, rendered.nginxTemplate);
    copyEntrypointResource(entrypointPath);
    copyNginxAccessControlResource(accessControlScriptPath);
    copyStaticContextPathEnvResource(staticContextEnvPath);
    copyBuildDockerImageScript(scriptPath);

    return {
      success: true,
      agentWorkDir,
      dockerfileBuildPath,
      dockerfileRunPath,
      buildScriptPath: scriptPath,
      nginxTemplatePath,
      entrypointPath,
      accessControlScriptPath,
      staticContextEnvPath,
      serviceRoot: detectedConfig.serviceRoot || ".",
      summary: `Rendered Docker deployment files in ${agentWorkDir}`,
    };
  } catch (error) {
    return failure(error.message);
  }
}

function resolveRequiredDir(value, fieldName, cwd) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Missing required Dockerfile render input: \`${fieldName}\`.`,
    );
  }

  return path.resolve(cwd, value);
}

function resolveDetectedConfig(detectedConfig, options) {
  if (detectedConfig && typeof detectedConfig === "object") {
    return detectedConfig;
  }

  return {
    language: options.language,
    version: options.version,
    framework: options.framework,
    runtimeKind: options.runtimeKind,
    serviceRoot: options.serviceRoot || ".",
    buildCommand: options.buildCommand,
    output: options.output,
    startCommand: options.startCommand,
    staticIndexFile: options.staticIndexFile,
  };
}

function copyBuildDockerImageScript(destinationPath) {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "..",
    "resource",
    "buildDockerImage.sh",
  );
  fs.copyFileSync(sourcePath, destinationPath);
  fs.chmodSync(destinationPath, 0o755);
}

function writeNginxTemplate(destinationPath, renderedTemplate) {
  if (typeof renderedTemplate === "string" && renderedTemplate.trim()) {
    fs.writeFileSync(destinationPath, `${renderedTemplate.trim()}\n`, "utf8");
    return;
  }

  const sourcePath = path.join(
    resolveContextPathResourceDir(),
    "nginx.conf.template",
  );
  fs.copyFileSync(sourcePath, destinationPath);
}

function copyEntrypointResource(destinationPath) {
  const sourcePath = path.join(
    resolveContextPathResourceDir(),
    "entrypoint.sh",
  );
  fs.copyFileSync(sourcePath, destinationPath);
  fs.chmodSync(destinationPath, 0o755);
}

function copyNginxAccessControlResource(destinationPath) {
  const sourcePath = path.join(
    resolveContextPathResourceDir(),
    "nginx-access-control.sh",
  );
  fs.copyFileSync(sourcePath, destinationPath);
  fs.chmodSync(destinationPath, 0o755);
}

function copyStaticContextPathEnvResource(destinationPath) {
  const sourcePath = path.join(
    resolveContextPathResourceDir(),
    "nginx-static-context-path.envsh",
  );
  fs.copyFileSync(sourcePath, destinationPath);
  fs.chmodSync(destinationPath, 0o755);
}

function resolveContextPathResourceDir() {
  const sourceDir = path.resolve(
    __dirname,
    "..",
    "..",
    "resource",
    "contextPath",
  );
  return sourceDir;
}

function dockerfileEnvQuote(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")}"`;
}

function renderRunEnvBlock(extraEnv = []) {
  return [
    ...extraEnv,
    "ENV PORT=9000",
    "ENV APP_PORT=9100",
    'ENV CONTEXT_PATH=""',
  ].join("\n");
}

function renderUserStartCommand(value) {
  return `ENV USER_START_COMMAND=${dockerfileEnvQuote(value)}`;
}

const RUN_FOOTER = [
  "COPY nginx.conf.template /etc/nginx/templates/default.conf.template",
  "COPY nginx-access-control.sh /nginx-access-control.sh",
  "COPY entrypoint.sh /entrypoint.sh",
  "RUN chmod +x /entrypoint.sh /nginx-access-control.sh",
  "EXPOSE 9000",
  'CMD ["/entrypoint.sh"]',
].join("\n");

// netcat-openbsd ships /usr/bin/nc which entrypoint.sh uses to gate nginx
// on the user app's TCP readiness, avoiding cold-start 502s.
const APT_INSTALL_PROXY =
  "RUN apt-get update && apt-get install -y --no-install-recommends nginx gettext-base netcat-openbsd && rm -rf /var/lib/apt/lists/*";

// Used by the Rust runtime image. Adds libssl3 on top of the standard
// nginx/envsubst/netcat set: any -sys crate in the actix-web/tokio tree that
// links openssl dynamically produces a binary that needs libssl.so.3 at
// runtime, and debian:bookworm-slim doesn't ship it. Without libssl3 the
// container exits on dlopen and SCF reports an init-timeout 446.
const APT_INSTALL_PROXY_WITH_CA =
  "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates nginx gettext-base netcat-openbsd libssl3 && rm -rf /var/lib/apt/lists/*";

// busybox on alpine already ships `nc`, so no extra package is required here.
const APK_INSTALL_PROXY_WITH_CA =
  "RUN apk add --no-cache ca-certificates nginx gettext";

// Render a `RUN npm install --global <pm>@<version>` line that goes BEFORE
// the user's build command, so the package manager exists on $PATH when the
// install step runs. node:*-slim base images ship only node/npm/npx, so any
// project that uses pnpm or yarn-berry would otherwise fail with
// `pnpm: not found` on the very first RUN.
//
// Returns "" when no preamble is needed (npm-only, classic yarn already in
// the image, or no detected package manager).
function renderPackageManagerPreamble(spec) {
  if (!spec || typeof spec !== "object") return "";
  const { name, versionSpec } = spec;
  if (name !== "pnpm" && name !== "yarn") return "";
  const versionSuffix =
    typeof versionSpec === "string" && versionSpec.trim()
      ? versionSpec.trim()
      : "latest";
  return `RUN npm install --global ${name}@${versionSuffix}\n`;
}

function sanitizeVersion(raw, fallback) {
  const value = String(raw || "").trim();
  const version = value.match(/\d+(?:\.\d+){0,2}/);
  return version ? version[0] : fallback;
}

function renderNode(config) {
  const version = sanitizeVersion(config.version, "20");
  if (isStaticNodeFrontend(config)) {
    return renderStaticNodeFrontend(config, version);
  }

  const preamble = renderPackageManagerPreamble(config.packageManager);
  const buildContextBlock = renderBuildContextPathBlock(config.framework);
  const buildCommand = appendFrameworkBaseFlag(
    config.buildCommand,
    config.framework,
  );

  return {
    dockerfileBuild: `
FROM node:${version}-slim
WORKDIR /build
COPY . /build/
${buildContextBlock}${preamble}RUN ${buildCommand}
CMD mkdir -p /output-mount && cp -R . /output-mount/
`,
    dockerfileRun: `
FROM node:${version}-slim
${APT_INSTALL_PROXY}
${renderRunEnvBlock(["ENV NODE_ENV=production"])}
${renderUserStartCommand(config.startCommand)}
WORKDIR /app
COPY . /app/
${RUN_FOOTER}
`,
  };
}

function renderStaticNodeFrontend(config, version) {
  const outputDir = normalizeStaticOutputDir(config.output);
  const preamble = renderPackageManagerPreamble(config.packageManager);
  const buildContextBlock = renderBuildContextPathBlock(config.framework);
  const staticIndexCopy = renderStaticIndexCopyCommand(config.staticIndexFile);
  const rewritesPaths = !frameworkBakesContextPathAtBuildTime(config.framework);
  const staticContextBaseInjection = renderStaticContextBaseInjectionCommand(
    outputDir,
    rewritesPaths,
  );
  const buildCommand = appendFrameworkBaseFlag(
    config.buildCommand,
    config.framework,
  );
  return {
    dockerfileBuild: `
FROM node:${version}-slim
WORKDIR /build
COPY . /build/
${buildContextBlock}${preamble}${staticIndexCopy}RUN ${buildCommand}
${staticContextBaseInjection}CMD mkdir -p /output-mount && cp -R ${outputDir}/. /output-mount/
`,
    dockerfileRun: `
FROM nginx:1.27-alpine
ENV PORT=9000
ENV CONTEXT_PATH=""
COPY . /usr/share/nginx/html/
RUN find /usr/share/nginx/html -maxdepth 1 \\( -name Dockerfile -o -name '*.template' -o -name '*.sh' -o -name '*.envsh' \\) -delete
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY nginx-access-control.sh /docker-entrypoint.d/10-zai-access-control.sh
COPY nginx-static-context-path.envsh /docker-entrypoint.d/15-zai-static-context-path.envsh
RUN chmod +x /docker-entrypoint.d/10-zai-access-control.sh /docker-entrypoint.d/15-zai-static-context-path.envsh
EXPOSE 9000
CMD ["nginx", "-g", "daemon off;"]
`,
    nginxTemplate: renderStaticNginxTemplate({
      rewritesPaths,
    }),
  };
}

function renderStaticContextBaseInjectionCommand(outputDir, rewritesPaths) {
  if (!rewritesPaths) {
    return "";
  }

  const htmlPath = outputDir === "." ? "index.html" : `${outputDir}/index.html`;
  const jsRootDir = outputDir === "." ? "." : outputDir;
  const script = [
    'const fs = require("fs");',
    `const htmlPath = ${JSON.stringify(htmlPath)};`,
    `const jsRootDir = ${JSON.stringify(jsRootDir)};`,
    "function normalizeContextPath(value) {",
    '  let normalized = String(value || "").trim();',
    '  if (!normalized) return "";',
    '  normalized = normalized.replace(/^https?:\\/\\/[^/]*(\\/.*)?$/i, (_match, path) => path || "");',
    '  normalized = normalized.replace(/^\\/+/, "/");',
    '  if (!normalized.startsWith("/")) normalized = `/${normalized}`;',
    '  normalized = normalized.replace(/\\/+$/, "");',
    '  return normalized === "/" ? "" : normalized;',
    "}",
    "function escapeHtmlAttr(value) {",
    '  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");',
    "}",
    "function escapeRegex(value) {",
    '  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
    "}",
    "function listJavaScriptFiles(rootDir) {",
    "  const files = [];",
    "  const queue = [rootDir];",
    "  while (queue.length) {",
    "    const currentDir = queue.shift();",
    "    if (!fs.existsSync(currentDir)) continue;",
    "    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {",
    "      const fullPath = `${currentDir}/${entry.name}`;",
    "      if (entry.isDirectory()) { queue.push(fullPath); continue; }",
    "      if (entry.isFile() && /\\.m?js$/i.test(entry.name)) files.push(fullPath);",
    "    }",
    "  }",
    "  return files;",
    "}",
    "function injectStaticContextPathBase() {",
    '  const contextPath = normalizeContextPath(process.env.CONTEXT_PATH || "");',
    "  if (!contextPath || !fs.existsSync(htmlPath)) return;",
    '  const html = fs.readFileSync(htmlPath, "utf8");',
    "  if (/<base\\b/i.test(html)) return;",
    "  const headPattern = /<head\\b[^>]*>/i;",
    "  if (!headPattern.test(html)) return;",
    // Keep HREF uppercase so nginx's lowercase sub_filter href rules do not
    // rewrite this generated base tag into /<context>/<context>/.
    '  const baseTag = `<base HREF="${escapeHtmlAttr(contextPath)}/">`;',
    "  fs.writeFileSync(htmlPath, html.replace(headPattern, (match) => `${match}${baseTag}`));",
    "}",
    "function rewriteStaticContextPathJavaScriptRedirects() {",
    '  const contextPath = normalizeContextPath(process.env.CONTEXT_PATH || "");',
    "  if (!contextPath) return;",
    "  const contextSegment = escapeRegex(contextPath.slice(1));",
    '  const rootPathLookahead = contextSegment ? `(?!/|${contextSegment}(?:/|[?#]|["\']))` : "(?!/)";',
    "  const patterns = [",
    '    new RegExp(`(location\\\\.href\\\\s*=\\\\s*["\'])/${rootPathLookahead}`, "g"),',
    '    new RegExp(`(location\\\\.assign\\\\(\\\\s*["\'])/${rootPathLookahead}`, "g"),',
    '    new RegExp(`(location\\\\.replace\\\\(\\\\s*["\'])/${rootPathLookahead}`, "g"),',
    '    new RegExp(`(window\\\\.location\\\\s*=\\\\s*["\'])/${rootPathLookahead}`, "g"),',
    "  ];",
    "  for (const filePath of listJavaScriptFiles(jsRootDir)) {",
    '    const original = fs.readFileSync(filePath, "utf8");',
    "    let rewritten = original;",
    "    for (const pattern of patterns) {",
    "      rewritten = rewritten.replace(pattern, (_match, prefix) => `${prefix}${contextPath}/`);",
    "    }",
    "    if (rewritten !== original) fs.writeFileSync(filePath, rewritten);",
    "  }",
    "}",
    "injectStaticContextPathBase();",
    "rewriteStaticContextPathJavaScriptRedirects();",
  ].join(" ");

  return `RUN node -e ${shellQuote(script)}\n`;
}

function renderStaticIndexCopyCommand(staticIndexFile) {
  const normalized = normalizeStaticIndexFile(staticIndexFile);
  if (!normalized || normalized === "index.html") {
    return "";
  }
  return `RUN cp ${shellQuote(`./${normalized}`)} ./index.html\n`;
}

function normalizeStaticIndexFile(staticIndexFile) {
  const normalized = String(staticIndexFile || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    return null;
  }
  return normalized;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// SPA frameworks where renderBuildContextPathBlock + appendFrameworkBaseFlag
// already inject CONTEXT_PATH into the built HTML at build time. For these,
// the runtime nginx must NOT also rewrite absolute-rooted URLs — doing both
// produces /<prefix>/<prefix>/asset.js, which try_files falls back to
// index.html, and the browser silently parses HTML as JS so the SPA never
// boots. Observed in vue-starter deploy adt-6965eb84daec4110b6aaf5157d630a4a.
function frameworkBakesContextPathAtBuildTime(framework) {
  const fw = String(framework || "").toLowerCase();
  return fw === "vite" || fw === "astro" || fw === "angular" || fw === "nuxt";
}

// Emit the CONTEXT_PATH plumbing every Node Dockerfile.build needs. The CNB
// build job exports CONTEXT_PATH; buildDockerImage.sh forwards it as a
// docker build-arg; we re-export it as an ENV so RUN steps can read it.
// For Nuxt (process runtime) we also export NUXT_APP_BASE_URL so the
// Nuxt build picks up the base path natively without any config edit.
//
// The block is unconditional (every Node renderer gets ARG/ENV CONTEXT_PATH)
// so user buildCommands can read it even when the framework is unknown.
function renderBuildContextPathBlock(framework) {
  const lines = ['ARG CONTEXT_PATH=""', "ENV CONTEXT_PATH=${CONTEXT_PATH}"];
  if (String(framework || "").toLowerCase() === "nuxt") {
    lines.push("ENV NUXT_APP_BASE_URL=${CONTEXT_PATH:-/}/");
  }
  return `${lines.join("\n")}\n`;
}

// Inject the framework-native base-path flag into the build command so the
// bundle ships with the prefix baked in. Each framework reads a different
// flag:
//   Vite:    --base=<path>/   (Vue Router picks it up via createWebHistory)
//   Astro:   --base=<path>/
//   Angular: --base-href=<path>/  (CLI flag, not --base)
//
// Critical: pnpm/yarn/direct build commands must not get a `--` separator
// between the buildCommand and the flag. Vite/Astro/Angular use commander/cac
// argv parsers that treat `--` as the positional terminator and silently
// swallow any flags that follow.
// Regression observed with pnpm in vue-starter deploy adt-26a102d5b3ff49de92df4d850aa2637e:
// the renderer used to emit `pnpm build -- --base=…`, which became
// `vite build -- --base=…` and produced a dist/ with no prefix baked in,
// breaking RouterLink and lazy chunks even though the deploy was reported
// as successful.
//
// npm is the exception: `npm run build --base=...` is parsed as an npm config
// option and the script receives no flag. For npm run-script commands, emit
// the npm argument separator: `npm run build -- --base=...`.
//
// Empty CONTEXT_PATH expands to "/" (root), which is every framework's
// default — so behavior is unchanged when the CNB env doesn't carry the var.
function appendFrameworkBaseFlag(buildCommand, framework) {
  if (typeof buildCommand !== "string" || !buildCommand.trim()) {
    return buildCommand;
  }
  const fw = String(framework || "").toLowerCase();
  let flag = null;
  if (fw === "vite" || fw === "astro") {
    flag = '--base="${CONTEXT_PATH:-}/"';
  }
  if (fw === "angular") {
    flag = '--base-href="${CONTEXT_PATH:-}/"';
  }
  if (flag) {
    return appendBuildScriptFlag(buildCommand, flag);
  }
  // Nuxt uses NUXT_APP_BASE_URL ENV (set in renderBuildContextPathBlock);
  // no flag injection. Other frameworks (gatsby, sveltekit, nextjs, etc.)
  // get no flag in this phase — they still receive ARG/ENV CONTEXT_PATH for
  // their own build scripts to consume.
  return buildCommand;
}

function appendBuildScriptFlag(buildCommand, flag) {
  const trimmed = buildCommand.trimEnd();
  const separator = needsNpmRunArgumentSeparator(trimmed) ? " --" : "";
  return `${trimmed}${separator} ${flag}`;
}

function needsNpmRunArgumentSeparator(command) {
  const lastSegment = command
    .split(/\s+(?:&&|\|\||;)\s+/)
    .pop()
    .trim();

  if (/\s--(?:\s|$)/.test(lastSegment)) {
    return false;
  }

  return /\bnpm(?:\s+(?:--[A-Za-z0-9_-]+(?:=\S+)?|-[A-Za-z])|\s+(?:--prefix|-C|--workspace|-w)\s+\S+)*\s+(?:run|run-script)\s+\S+/.test(
    lastSegment,
  );
}

function isStaticNodeFrontend(config) {
  if (!config || config.language !== "Node.js") {
    return false;
  }

  if (config.runtimeKind !== "static") {
    return false;
  }

  const output = String(config.output || "").trim();
  return Boolean(output && output !== "Source files");
}

function normalizeStaticOutputDir(output) {
  const value = String(output || "dist").trim();
  if (!value || value === "Source files") {
    return "dist";
  }
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function renderStaticNginxTemplate({ rewritesPaths = true } = {}) {
  const rewriteBlock = rewritesPaths
    ? `
        sub_filter_once off;
        sub_filter_last_modified on;
        sub_filter_types text/html text/css application/javascript application/x-javascript;

        sub_filter ' href="/'    ' href="\${CONTEXT_PATH}/';
        sub_filter " href='/"    " href='\${CONTEXT_PATH}/";
        sub_filter ' src="/'     ' src="\${CONTEXT_PATH}/';
        sub_filter " src='/"     " src='\${CONTEXT_PATH}/";
        sub_filter ' srcset="/'  ' srcset="\${CONTEXT_PATH}/';
        sub_filter " srcset='/"  " srcset='\${CONTEXT_PATH}/";
        sub_filter ' poster="/'  ' poster="\${CONTEXT_PATH}/';
        sub_filter " poster='/"  " poster='\${CONTEXT_PATH}/";
        sub_filter ' data-src="/' ' data-src="\${CONTEXT_PATH}/';
        sub_filter " data-src='/" " data-src='\${CONTEXT_PATH}/";
        sub_filter ' action="/'  ' action="\${CONTEXT_PATH}/';
        sub_filter " action='/"  " action='\${CONTEXT_PATH}/";
        sub_filter ' formaction="/' ' formaction="\${CONTEXT_PATH}/';
        sub_filter " formaction='/" " formaction='\${CONTEXT_PATH}/";
        sub_filter ' manifest="/' ' manifest="\${CONTEXT_PATH}/';
        sub_filter " manifest='/" " manifest='\${CONTEXT_PATH}/";

        sub_filter 'url("/'      'url("\${CONTEXT_PATH}/';
        sub_filter "url('/"      "url('\${CONTEXT_PATH}/";
        sub_filter 'url(/'       'url(\${CONTEXT_PATH}/';
`
    : "";
  return `
server {
    listen \${PORT};
    server_name _;
    include /tmp/cc-deploy/nginx-real-ip.conf;
    include /tmp/cc-deploy/nginx-access-control.conf;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        set $zai_static_uri $uri;
        if ($uri ~ ^\${CONTEXT_PATH}(/.*)$) {
            set $zai_static_uri $1;
        }
        try_files $zai_static_uri $zai_static_uri/ /index.html;
${rewriteBlock}    }
}
`;
}

function renderGo(config) {
  const version = sanitizeVersion(config.version, "1.21");
  const outputName = path.basename(config.output || "server");
  return {
    dockerfileBuild: `
ARG TARGETARCH=amd64
FROM --platform=linux/\${TARGETARCH} golang:${version}-alpine
WORKDIR /build
COPY . /build/
RUN ${config.buildCommand}
CMD mkdir -p /output-mount && cp ${outputName} /output-mount/
`,
    dockerfileRun: `
ARG TARGETARCH=amd64
FROM --platform=linux/\${TARGETARCH} alpine:3.20
${APK_INSTALL_PROXY_WITH_CA}
WORKDIR /app
COPY . /app/
RUN chmod +x /app/${outputName}
${renderRunEnvBlock()}
${renderUserStartCommand(config.startCommand)}
${RUN_FOOTER}
`,
  };
}

function renderRust(config) {
  const version = sanitizeVersion(config.version, "1.88");
  const outputName = path.basename(config.output || "app");
  return {
    dockerfileBuild: `
ARG TARGETARCH=amd64
FROM --platform=linux/\${TARGETARCH} rust:${version}-slim
WORKDIR /build
COPY . /build/
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config libssl-dev cmake git && rm -rf /var/lib/apt/lists/*
RUN ${config.buildCommand}
CMD mkdir -p /output-mount && cp ${config.output || `target/release/${outputName}`} /output-mount/${outputName}
`,
    dockerfileRun: `
ARG TARGETARCH=amd64
FROM --platform=linux/\${TARGETARCH} debian:bookworm-slim
${APT_INSTALL_PROXY_WITH_CA}
WORKDIR /app
COPY . /app/
RUN chmod +x /app/${outputName}
${renderRunEnvBlock()}
${renderUserStartCommand(config.startCommand)}
${RUN_FOOTER}
`,
  };
}

function renderJava(config) {
  const version = sanitizeVersion(config.version, "17");
  const buildImage =
    config.buildCommand && config.buildCommand.startsWith("mvn")
      ? `maven:3.9-eclipse-temurin-${version}`
      : `gradle:8.7-jdk${version}`;
  const normalizedStartCommand =
    config.startCommand === "java -jar app.jar"
      ? "java -Dserver.port=$PORT -jar app.jar"
      : config.startCommand;

  return {
    dockerfileBuild: `
FROM ${buildImage}
WORKDIR /build
COPY . /build/
RUN ${config.buildCommand}
CMD sh -c 'mkdir -p /output-mount && cp ${config.output || "target/*.jar"} /output-mount/app.jar'
`,
    dockerfileRun: `
FROM eclipse-temurin:${version}-jre
${APT_INSTALL_PROXY}
${renderRunEnvBlock()}
${renderUserStartCommand(normalizedStartCommand)}
WORKDIR /app
COPY . /app/
${RUN_FOOTER}
`,
  };
}

function renderPython(config) {
  const version = sanitizeVersion(config.version, "3.11");
  const installCommand = renderPythonDependencyCommand(config.buildCommand);
  return {
    dockerfileBuild: `
FROM python:${version}-slim
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /build
COPY . /build/
RUN mkdir -p /build/python-deps && ${installCommand}
CMD mkdir -p /output-mount && cp -R . /output-mount/ && cp -R python-deps /output-mount/python-deps
`,
    dockerfileRun: `
FROM python:${version}-slim
${APT_INSTALL_PROXY}
${renderRunEnvBlock([
  "ENV PYTHONDONTWRITEBYTECODE=1",
  "ENV PYTHONUNBUFFERED=1",
  "ENV PYTHONPATH=/app/python-deps",
])}
${renderUserStartCommand(config.startCommand)}
WORKDIR /app
COPY . /app/
${RUN_FOOTER}
`,
  };
}

function renderPythonDependencyCommand(buildCommand) {
  if (/requirements\.txt/.test(buildCommand)) {
    return "pip install --no-cache-dir --target /build/python-deps -r requirements.txt";
  }
  if (/pipenv/.test(buildCommand)) {
    return "pip install --no-cache-dir pipenv && pipenv requirements > /tmp/requirements.txt && pip install --no-cache-dir --target /build/python-deps -r /tmp/requirements.txt";
  }
  if (/poetry/.test(buildCommand)) {
    return "pip install --no-cache-dir poetry && poetry export -f requirements.txt --without-hashes -o /tmp/requirements.txt && pip install --no-cache-dir --target /build/python-deps -r /tmp/requirements.txt";
  }
  return buildCommand;
}

function renderRuby(config) {
  const version = sanitizeVersion(config.version, "3.2");
  return {
    dockerfileBuild: `
FROM ruby:${version}-slim
WORKDIR /build
COPY . /build/
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libyaml-dev pkg-config git && rm -rf /var/lib/apt/lists/*
RUN bundle config set --local path 'vendor/bundle' && bundle config set --local without 'development test' && ${config.buildCommand}
CMD mkdir -p /output-mount && cp -R . /output-mount/
`,
    dockerfileRun: `
FROM ruby:${version}-slim
${APT_INSTALL_PROXY}
${renderRunEnvBlock([
  "ENV RAILS_ENV=production",
  "ENV RACK_ENV=production",
  "ENV RAILS_SERVE_STATIC_FILES=true",
  "ENV RAILS_LOG_TO_STDOUT=true",
  // The build installs gems into vendor/bundle, which ships to /app via the
  // output-mount copy. But ruby:*-slim sets BUNDLE_APP_CONFIG=/usr/local/bundle,
  // so the build's `bundle config --local`/`--deployment` path setting is
  // written to /usr/local/bundle/config INSIDE the build image and never
  // travels to the run image (only /build -> /app ships). Without it, runtime
  // bundler defaults gem lookup to GEM_HOME=/usr/local/bundle (empty) and
  // raises Bundler::GemNotFound for the production gems
  // (ruby-sinatra runtime failure, deploy ruby-sinatra-tcbp-b348a92e). ENV
  // vars are honored by bundler regardless of BUNDLE_APP_CONFIG, so pin the
  // gem path here. BUNDLE_WITHOUT mirrors the build's skipped groups so
  // `bundle exec` does not demand the dev/test gems that were never installed.
  'ENV BUNDLE_PATH="/app/vendor/bundle"',
  'ENV BUNDLE_WITHOUT="development:test"',
  // Ruby cold-start under bundle exec + vendored gems regularly runs past
  // the entrypoint's default APP_BOOT_TIMEOUT_SECONDS=60 on TCB. Observed:
  // ruby-sinatra repeatedly returning HTTP 446 with ~95s upstream timecost
  // because puma had not yet bound to $APP_PORT when entrypoint.sh gave up
  // (task adt-3447f0c2caaa4f2db7bdf9a0bb8d7cbc). 120s gives bundler enough
  // headroom to load gems, JIT cache, etc., before nginx is started.
  "ENV APP_BOOT_TIMEOUT_SECONDS=120",
])}
${renderUserStartCommand(config.startCommand)}
WORKDIR /app
COPY . /app/
${RUN_FOOTER}
`,
  };
}

function renderPhp(config) {
  const version = sanitizeVersion(config.version, "8.2");
  return {
    dockerfileBuild: `
FROM php:${version}-cli
WORKDIR /build
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY . /build/
RUN ${config.buildCommand}
CMD mkdir -p /output-mount && cp -R . /output-mount/
`,
    dockerfileRun: `
FROM php:${version}-cli
${APT_INSTALL_PROXY}
${renderRunEnvBlock()}
${renderUserStartCommand(config.startCommand)}
WORKDIR /app
COPY . /app/
${RUN_FOOTER}
`,
  };
}

const RENDERERS = {
  "Node.js": renderNode,
  Go: renderGo,
  Rust: renderRust,
  Java: renderJava,
  Python: renderPython,
  Ruby: renderRuby,
  PHP: renderPhp,
};

function failure(message) {
  return {
    success: false,
    message,
    summary: message,
  };
}

module.exports = {
  runRenderArbitraryDockerfiles,
};
