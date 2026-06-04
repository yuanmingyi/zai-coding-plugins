"use strict";

const fs = require("fs");
const path = require("path");

const { formatArbitraryAnalyzeResult } = require("../common/format");
const {
  detectRequirementFromFiles,
  loadPackageJson,
} = require("../standard/detectNodeVersion");
const { detectOutputDir } = require("../standard/detectOutputDir");
const {
  detectBuildCommand,
  detectFramework,
  detectPackageManager,
  detectPackageManagerSpec,
} = require("../standard/inspectProject");

const DISCOVERY_IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  ".zai",
  "__pycache__",
  "node_modules",
  "vendor",
  "venv",
]);

const PORT_SCAN_IGNORE_DIRS = new Set([
  ...DISCOVERY_IGNORE_DIRS,
  "__tests__",
  "build",
  "coverage",
  "dist",
  "target",
  "test",
  "tests",
]);

const INDICATOR_FILES = [
  { fileName: "go.mod", language: "Go", indicator: "go.mod" },
  { fileName: "Cargo.toml", language: "Rust", indicator: "Cargo.toml" },
  { fileName: "pom.xml", language: "Java", indicator: "pom.xml" },
  { fileName: "build.gradle", language: "Java", indicator: "build.gradle" },
  { fileName: "package.json", language: "Node.js", indicator: "package.json" },
  {
    fileName: "requirements.txt",
    language: "Python",
    indicator: "requirements.txt",
  },
  { fileName: "Pipfile", language: "Python", indicator: "Pipfile" },
  {
    fileName: "pyproject.toml",
    language: "Python",
    indicator: "pyproject.toml",
  },
  { fileName: "Gemfile", language: "Ruby", indicator: "Gemfile" },
  { fileName: "composer.json", language: "PHP", indicator: "composer.json" },
];
const RAW_STATIC_INDEX_FILES = ["index.html", "index.htm"];

const PORT_RULES = {
  "Node.js": {
    extensions: [".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx"],
    patterns: [/listen\s*\(\s*(\d{2,5})\s*[),]/, /port\s*:\s*(\d{2,5})\b/],
    suggestion: "app.listen(process.env.PORT || 3000)",
  },
  Python: {
    extensions: [".py"],
    patterns: [/port\s*=\s*(\d{2,5})\b/, /bind\([^)]*:(\d{2,5})/],
    suggestion: "app.run(port=int(os.environ.get('PORT', 5000)))",
  },
  Go: {
    extensions: [".go"],
    patterns: [/ListenAndServe\(\s*"[^"]*:?(\d{2,5})/, /Addr[^\\n]*:(\d{2,5})/],
    suggestion: 'http.ListenAndServe(":"+os.Getenv("PORT"), handler)',
  },
  Java: {
    extensions: [".java", ".properties", ".yaml", ".yml"],
    patterns: [
      /server\.port\s*[:=]\s*(\d{2,5})\b/,
      /setPort\((\d{2,5})\)/,
      /\.port\((\d{2,5})\)/,
    ],
    suggestion: "server.port=${PORT:8080}",
  },
  Ruby: {
    extensions: [".rb", ".ru"],
    patterns: [/set\s+:port,\s*(\d{2,5})\b/, /port:\s*(\d{2,5})\b/],
    suggestion: "set :port, ENV['PORT'] || 3000",
  },
  PHP: {
    extensions: [".php"],
    patterns: [/-S\s+0\.0\.0\.0:(\d{2,5})\b/, /listen\s+(\d{2,5})\b/],
    suggestion: "php -S 0.0.0.0:$PORT",
  },
  Rust: {
    extensions: [".rs"],
    patterns: [/bind\(".*:(\d{2,5})/, /port:\s*(\d{2,5})\b/],
    suggestion:
      '.bind(format!("0.0.0.0:{}", std::env::var("PORT").unwrap_or("8080".into())))',
  },
};

const STATIC_NODE_FRONTEND_FRAMEWORKS = new Set([
  "angular",
  "astro",
  "gatsby",
  "nuxt",
  "vite",
]);

const NODE_SERVER_DEPENDENCIES = [
  "@fastify/core",
  "@hapi/hapi",
  "@nestjs/core",
  "express",
  "fastify",
  "h3",
  "koa",
  "polka",
];

const MYSQL_DEPENDENCIES = new Set(["mysql", "mysql2", "mariadb"]);
const POSTGRESQL_DEPENDENCIES = new Set(["pg", "postgres", "postgresql"]);
const ORM_DEPENDENCIES = [
  { name: "@prisma/client", orm: "prisma" },
  { name: "prisma", orm: "prisma" },
  { name: "sequelize", orm: "sequelize" },
  { name: "typeorm", orm: "typeorm" },
  { name: "knex", orm: "knex" },
];
const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_DATABASE",
  "POSTGRES_USER",
  "POSTGRESQL_HOST",
  "POSTGRESQL_PORT",
  "POSTGRESQL_DATABASE",
  "POSTGRESQL_USER",
];
const DATABASE_ENV_FILES = [
  ".env",
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
];

async function runArbitraryAnalyze(options = {}) {
  const cwd = options.cwd || process.cwd();

  try {
    const scope = resolveAnalyzeScope(cwd, options.path);
    if (!scope.ok) {
      return prompt(scope.reasonCode, scope.message, scope.extra);
    }
    const candidates = collectServiceCandidates(scope.projectDir, {
      baseDir: scope.baseDir,
      rawStaticEntry: scope.rawStaticEntry,
    });
    const selection = selectCandidate(candidates, scope.baseDir);
    if (!selection.ok) {
      return prompt(selection.reasonCode, selection.message, selection.extra);
    }

    const detectedConfig = analyzeService(selection.service, scope.baseDir);
    if (detectedConfig.needsUserInput) {
      return prompt(detectedConfig.reasonCode, detectedConfig.message, {
        detectedConfig: detectedConfig.detectedConfig || null,
      });
    }

    const portIssue = shouldScanFixedPortBinding(
      selection.service.language,
      detectedConfig,
    )
      ? scanFixedPortBinding(
          selection.service.language,
          selection.service.rootDir,
        )
      : null;
    if (portIssue) {
      return prompt(
        "PORT_CONFIGURATION_REQUIRED",
        formatPortIssueMessage(portIssue),
        {
          detectedConfig,
          portIssue,
        },
      );
    }

    const result = {
      success: true,
      needsUserInput: false,
      reasonCode: null,
      detectedConfig,
      portIssue: null,
    };
    result.summary = formatArbitraryAnalyzeResult(result);
    return result;
  } catch (error) {
    return {
      success: false,
      message: error.message,
      summary: error.message,
    };
  }
}

function prompt(reasonCode, message, extra = {}) {
  const result = {
    success: true,
    needsUserInput: true,
    reasonCode,
    message,
    ...extra,
  };
  result.summary = formatArbitraryAnalyzeResult(result);
  return result;
}

function resolveAnalyzeScope(cwd, entryPath) {
  const baseDir = path.resolve(cwd || process.cwd());
  const trimmedPath = trimmed(entryPath);
  if (!trimmedPath) {
    return { ok: true, baseDir, projectDir: baseDir, rawStaticEntry: null };
  }

  const absolutePath = path.resolve(baseDir, trimmedPath);
  if (!isPathInsideDirectory(baseDir, absolutePath)) {
    return invalidEntryPath(
      `Deploy entry path must be inside the project directory: ${trimmedPath}`,
    );
  }

  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch (_) {
    return invalidEntryPath(`Deploy entry path does not exist: ${trimmedPath}`);
  }

  if (stat.isDirectory()) {
    return {
      ok: true,
      baseDir,
      projectDir: absolutePath,
      rawStaticEntry: null,
    };
  }

  if (!stat.isFile()) {
    return invalidEntryPath(
      `Deploy entry path must be a file or directory: ${trimmedPath}`,
    );
  }

  const relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, "/");
  if (/\.html?$/i.test(path.basename(absolutePath))) {
    return {
      ok: true,
      baseDir,
      projectDir: baseDir,
      rawStaticEntry: {
        absolutePath,
        relativePath,
      },
    };
  }

  return {
    ok: true,
    baseDir,
    projectDir: path.dirname(absolutePath),
    rawStaticEntry: null,
  };
}

function invalidEntryPath(message) {
  return {
    ok: false,
    reasonCode: "ENTRY_PATH_INVALID",
    message,
    extra: {},
  };
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPathInsideDirectory(directory, candidatePath) {
  const relativePath = path.relative(directory, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function normalizeStaticIndexFile(value) {
  const normalized = trimmed(value).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    return null;
  }
  return normalized;
}

function collectServiceCandidates(projectDir, options = {}) {
  const baseDir = options.baseDir || projectDir;
  if (options.rawStaticEntry) {
    return [
      {
        language: "Static HTML",
        indicator: options.rawStaticEntry.relativePath,
        manifestPath: options.rawStaticEntry.relativePath,
        rootDir: baseDir,
        depth: 0,
        staticIndexFile: options.rawStaticEntry.relativePath,
      },
    ];
  }

  const files = walkFiles(projectDir, {
    ignoreDirs: DISCOVERY_IGNORE_DIRS,
  });
  const candidates = [];

  for (const filePath of files) {
    const relativePath = path.relative(projectDir, filePath);
    for (const indicator of INDICATOR_FILES) {
      if (path.basename(filePath) !== indicator.fileName) {
        continue;
      }

      candidates.push({
        language: indicator.language,
        indicator: indicator.indicator,
        manifestPath: relativePath,
        rootDir: path.dirname(filePath),
        depth: relativeDirDepth(projectDir, path.dirname(filePath)),
      });
    }
  }

  if (!candidates.length) {
    const phpEntrypoints = findPhpEntrypoints(projectDir);
    for (const phpEntrypoint of phpEntrypoints) {
      candidates.push({
        language: "PHP",
        indicator: phpEntrypoint,
        manifestPath: phpEntrypoint,
        rootDir: inferPhpServiceRoot(projectDir, phpEntrypoint),
        depth: relativeDirDepth(
          projectDir,
          inferPhpServiceRoot(projectDir, phpEntrypoint),
        ),
      });
    }
  }

  if (!candidates.length) {
    const rawStaticEntrypoint = findRawStaticEntrypoint(projectDir);
    if (rawStaticEntrypoint) {
      candidates.push({
        language: "Static HTML",
        indicator: rawStaticEntrypoint,
        manifestPath: rawStaticEntrypoint,
        rootDir: projectDir,
        depth: 0,
        staticIndexFile: rawStaticEntrypoint,
      });
    }
  }

  return candidates;
}

function selectCandidate(candidates, projectDir) {
  if (!candidates.length) {
    return {
      ok: false,
      reasonCode: "UNKNOWN_RUNTIME",
      message:
        "Could not detect a supported language/runtime in the current project. Please confirm the language/runtime to deploy.",
    };
  }

  const nearestDepth = Math.min(...candidates.map((item) => item.depth));
  const nearest = candidates.filter((item) => item.depth === nearestDepth);
  const services = [];
  const seen = new Set();

  for (const candidate of nearest) {
    const key = `${candidate.language}:${candidate.rootDir}`;
    if (!seen.has(key)) {
      seen.add(key);
      services.push({
        language: candidate.language,
        rootDir: candidate.rootDir,
        staticIndexFile: candidate.staticIndexFile || null,
        indicators: nearest
          .filter(
            (item) =>
              item.language === candidate.language &&
              item.rootDir === candidate.rootDir,
          )
          .map((item) => item.indicator),
      });
    }
  }

  if (services.length > 1) {
    const serviceList = services
      .map(
        (service) =>
          `- ${service.language} at \`${formatRelativeRoot(projectDir, service.rootDir)}\``,
      )
      .join("\n");

    return {
      ok: false,
      reasonCode: "AMBIGUOUS_SERVICE",
      message: `Multiple runnable services were detected near the project root.\n${serviceList}\nPlease confirm which service to deploy.`,
    };
  }

  return {
    ok: true,
    service: services[0],
  };
}

function analyzeService(service, projectDir) {
  switch (service.language) {
    case "Node.js":
      return analyzeNodeService(service, projectDir);
    case "Go":
      return analyzeGoService(service, projectDir);
    case "Rust":
      return analyzeRustService(service, projectDir);
    case "Java":
      return analyzeJavaService(service, projectDir);
    case "Python":
      return analyzePythonService(service, projectDir);
    case "Ruby":
      return analyzeRubyService(service, projectDir);
    case "PHP":
      return analyzePhpService(service, projectDir);
    case "Static HTML":
      return analyzeRawStaticService(service, projectDir);
    default:
      return {
        needsUserInput: true,
        reasonCode: "UNKNOWN_RUNTIME",
        message: `Could not analyze runtime ${service.language}. Please confirm the deployment settings manually.`,
      };
  }
}

function analyzeRawStaticService(service, projectDir) {
  const staticIndexFile = normalizeStaticIndexFile(service.staticIndexFile);
  const config = {
    language: "Node.js",
    version: "20",
    framework: "static",
    runtimeKind: "static",
    serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
    buildCommand: "true",
    output: ".",
    startCommand: "static-site",
  };
  if (staticIndexFile && staticIndexFile !== "index.html") {
    config.staticIndexFile = staticIndexFile;
  }
  return config;
}

function analyzeNodeService(service, projectDir) {
  const packageJson = safeLoadPackageJson(service.rootDir);
  const packageManager = detectPackageManager(packageJson, service.rootDir);
  const framework = detectFramework(packageJson);
  const database = detectNodeDatabaseRequirement(service.rootDir, packageJson);
  const requirement = detectRequirementFromFiles(service.rootDir, packageJson);
  const version = requirement || "20";
  const hasBuildScript = Boolean(
    packageJson.scripts && packageJson.scripts.build,
  );
  const buildCommand =
    detectBuildCommand(packageJson, service.rootDir) ||
    detectNodeInstallCommand(packageManager);
  const packageManagerSpec = detectPackageManagerSpec(
    packageJson,
    service.rootDir,
    { buildCommand },
  );
  const output = hasBuildScript
    ? safeDetectOutputDir(service.rootDir, packageJson)
    : "Source files";

  if (hasBuildScript && !output) {
    return {
      needsUserInput: true,
      reasonCode: "OUTPUT_UNCLEAR",
      message:
        "A build command was detected, but the build output location is unclear. Please confirm the output files or directory.",
      detectedConfig: withDatabaseDetection(
        {
          language: "Node.js",
          version,
          buildCommand,
        },
        database,
      ),
    };
  }

  const runtimeKind = detectNodeRuntimeKind({
    serviceRoot: service.rootDir,
    packageJson,
    framework,
    hasBuildScript,
    output,
  });

  if (runtimeKind === "static") {
    return withDatabaseDetection(
      {
        language: "Node.js",
        version,
        framework,
        runtimeKind,
        serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
        buildCommand,
        output,
        startCommand: null,
        packageManager: packageManagerSpec,
      },
      database,
    );
  }

  const startCommand = detectNodeStartCommand(
    service.rootDir,
    packageJson,
    packageManager,
  );
  if (!startCommand.ok) {
    return {
      needsUserInput: true,
      reasonCode: startCommand.reasonCode,
      message: startCommand.message,
      detectedConfig: withDatabaseDetection(
        {
          language: "Node.js",
          version,
          buildCommand,
          output,
        },
        database,
      ),
    };
  }

  return withDatabaseDetection(
    {
      language: "Node.js",
      version,
      framework,
      runtimeKind,
      serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
      buildCommand,
      output,
      startCommand: startCommand.command,
      packageManager: packageManagerSpec,
    },
    database,
  );
}

function analyzeGoService(service, projectDir) {
  return withDatabaseDetection(
    {
      language: "Go",
      version: parseGoVersion(service.rootDir),
      serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
      buildCommand: "go build -o server .",
      output: "server",
      startCommand: "./server",
    },
    detectNonNodeDatabaseRequirement("Go", service.rootDir),
  );
}

function analyzeRustService(service, projectDir) {
  const binaryName = parseCargoBinaryName(service.rootDir) || "app";
  return withDatabaseDetection(
    {
      language: "Rust",
      version: parseRustVersion(service.rootDir),
      serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
      buildCommand: fs.existsSync(path.join(service.rootDir, "Cargo.lock"))
        ? "cargo build --release --locked"
        : "cargo build --release",
      output: `target/release/${binaryName}`,
      startCommand: `./${binaryName}`,
    },
    detectNonNodeDatabaseRequirement("Rust", service.rootDir),
  );
}

function analyzeJavaService(service, projectDir) {
  const isMaven = fs.existsSync(path.join(service.rootDir, "pom.xml"));
  return withDatabaseDetection(
    {
      language: "Java",
      version: parseJavaVersion(service.rootDir, isMaven),
      serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
      buildCommand: isMaven
        ? "mvn clean package -DskipTests"
        : fs.existsSync(path.join(service.rootDir, "gradlew"))
          ? "./gradlew build -x test"
          : "gradle build -x test",
      output: isMaven ? "target/*.jar" : "build/libs/*.jar",
      startCommand: "java -jar app.jar",
    },
    detectNonNodeDatabaseRequirement("Java", service.rootDir),
  );
}

function analyzePythonService(service, projectDir) {
  const database = detectNonNodeDatabaseRequirement("Python", service.rootDir);
  const requirementsPath = path.join(service.rootDir, "requirements.txt");
  const pipfilePath = path.join(service.rootDir, "Pipfile");
  const pyprojectPath = path.join(service.rootDir, "pyproject.toml");
  let buildCommand = null;

  if (fs.existsSync(requirementsPath)) {
    buildCommand = "pip install --no-cache-dir -r requirements.txt";
  } else if (fs.existsSync(pipfilePath)) {
    buildCommand = "pipenv install --deploy";
  } else if (fs.existsSync(pyprojectPath)) {
    const pyproject = safeReadFile(pyprojectPath);
    if (/\[tool\.poetry\]/.test(pyproject) || /poetry-core/.test(pyproject)) {
      buildCommand = "poetry install --no-root";
    }
  }

  if (!buildCommand) {
    return {
      needsUserInput: true,
      reasonCode: "BUILD_COMMAND_UNCLEAR",
      message:
        "Detected a Python project, but the build/install command is unclear. Please confirm the command to install dependencies locally.",
      detectedConfig: withDatabaseDetection(
        {
          language: "Python",
          version: parsePythonVersion(service.rootDir),
        },
        database,
      ),
    };
  }

  const startCommand = detectSingleEntrypoint(service.rootDir, [
    "app.py",
    "main.py",
    "wsgi.py",
  ]);
  if (!startCommand.ok) {
    return {
      needsUserInput: true,
      reasonCode: startCommand.reasonCode,
      message: startCommand.message,
      detectedConfig: withDatabaseDetection(
        {
          language: "Python",
          version: parsePythonVersion(service.rootDir),
          buildCommand,
          output: "Source files",
        },
        database,
      ),
    };
  }

  return withDatabaseDetection(
    {
      language: "Python",
      version: parsePythonVersion(service.rootDir),
      serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
      buildCommand,
      output: "Source files",
      startCommand: `python ${startCommand.fileName}`,
    },
    database,
  );
}

function analyzeRubyService(service, projectDir) {
  const database = detectNonNodeDatabaseRequirement("Ruby", service.rootDir);
  // For the standard Sinatra-with-app.rb layout (with or without a
  // companion config.ru), prefer `bundle exec ruby app.rb` over launching
  // a Rack server CLI. Sinatra's classic-mode runner picks up the rack
  // server bundled in the Gemfile (puma, falcon, thin, …) via its native
  // Ruby API and binds to the `set :bind` / `set :port` settings inside
  // app.rb. We tried emitting `rackup` and then `puma -b tcp://0.0.0.0:$PORT`
  // (commits b3566f7 + f91a74e) and both reliably produced TCB SCF 446
  // with ~95s upstream timecost — the user app exited before binding to
  // $APP_PORT. The classic-mode entry path has been the historically
  // working invocation for ruby-sinatra. The earlier production hit
  // (adt-f8f7644fb38c425280b0835ccdaa60bd) was the agent supplying a wrong
  // override `ruby app.rb` *without* `bundle exec`, not the form emitted
  // here.
  //
  // Selection order:
  //   1. app.rb (Sinatra classic; preferred)
  //   2. config.ru as a last resort → bundle exec puma directly (no
  //      rackup intermediary). Reached only when there is no app.rb.
  const appRb = path.join(service.rootDir, "app.rb");
  const configRu = path.join(service.rootDir, "config.ru");
  let entrypoint;
  if (fs.existsSync(appRb)) {
    entrypoint = { ok: true, fileName: "app.rb" };
  } else if (fs.existsSync(configRu)) {
    entrypoint = { ok: true, fileName: "config.ru" };
  } else {
    entrypoint = detectSingleEntrypoint(service.rootDir, [
      "app.rb",
      "config.ru",
    ]);
  }
  if (!entrypoint.ok) {
    return {
      needsUserInput: true,
      reasonCode: entrypoint.reasonCode,
      message: entrypoint.message,
      detectedConfig: withDatabaseDetection(
        {
          language: "Ruby",
          version: "3.2",
          buildCommand:
            "bundle install --deployment --without development test",
          output: "Source files",
        },
        database,
      ),
    };
  }

  const startCommand =
    entrypoint.fileName === "config.ru"
      ? "bundle exec puma -b tcp://0.0.0.0:$PORT"
      : `bundle exec ruby ${entrypoint.fileName}`;

  return withDatabaseDetection(
    {
      language: "Ruby",
      version: "3.2",
      serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
      buildCommand: "bundle install --deployment --without development test",
      output: "Source files",
      startCommand,
    },
    database,
  );
}

function analyzePhpService(service, projectDir) {
  const composerPath = path.join(service.rootDir, "composer.json");
  const phpEntrypoint = findPhpEntrypointInService(service.rootDir);

  return withDatabaseDetection(
    {
      language: "PHP",
      version: "8.2",
      serviceRoot: formatRelativeRoot(projectDir, service.rootDir),
      buildCommand: fs.existsSync(composerPath)
        ? "composer install --no-dev --optimize-autoloader"
        : `php -l ${phpEntrypoint || "index.php"}`,
      output: "Source files",
      startCommand: "php -S 0.0.0.0:$PORT",
    },
    detectNonNodeDatabaseRequirement("PHP", service.rootDir),
  );
}

function withDatabaseDetection(config, database) {
  if (!database) {
    return config;
  }
  return {
    ...config,
    database,
  };
}

function detectNodeDatabaseRequirement(serviceRoot, packageJson) {
  const dependencyNames = collectDependencyNames(packageJson);
  const prismaSchema = detectPrismaSchema(serviceRoot);
  const envKeys = new Set([
    ...collectDatabaseEnvKeysFromFiles(serviceRoot),
    ...prismaSchema.envKeys,
  ]);

  let type = prismaSchema.type || null;
  if (!type) {
    if (hasAnyDependency(dependencyNames, MYSQL_DEPENDENCIES)) {
      type = "mysql";
    } else if (hasAnyDependency(dependencyNames, POSTGRESQL_DEPENDENCIES)) {
      type = "postgresql";
    }
  }

  let orm = prismaSchema.found ? "prisma" : null;
  if (!orm) {
    const match = ORM_DEPENDENCIES.find((item) =>
      dependencyNames.has(item.name),
    );
    orm = match ? match.orm : null;
  }

  if (!type && !orm && envKeys.size === 0) {
    return null;
  }

  if (type === "mysql") {
    for (const key of [
      "MYSQL_HOST",
      "MYSQL_PORT",
      "MYSQL_DATABASE",
      "MYSQL_USER",
    ]) {
      if (envKeys.has(key)) envKeys.add(key);
    }
  }

  const requiredEnv = orderDatabaseEnvKeys(envKeys);
  if (!requiredEnv.length && (type === "mysql" || type === "postgresql")) {
    requiredEnv.push("DATABASE_URL");
  }

  return {
    detected: true,
    type: type || "unknown",
    requiredEnv,
    orm,
    migrationCommand: orm === "prisma" ? "npx prisma migrate deploy" : null,
  };
}

function detectNonNodeDatabaseRequirement(language, serviceRoot) {
  const text = readDatabaseSignalText(language, serviceRoot);
  const envKeys = collectDatabaseEnvKeysFromFiles(serviceRoot);
  let type =
    detectDatabaseTypeFromText(text) || inferDatabaseTypeFromEnvKeys(envKeys);
  const orm = detectOrmFromText(language, text);

  if (!type && !orm && envKeys.length === 0) {
    return null;
  }

  const requiredEnv = orderDatabaseEnvKeys(envKeys);
  if (!requiredEnv.length && (type === "mysql" || type === "postgresql")) {
    requiredEnv.push("DATABASE_URL");
  }

  return {
    detected: true,
    type: type || "unknown",
    requiredEnv,
    orm,
    migrationCommand: defaultMigrationCommand(language, orm),
  };
}

function detectPrismaSchema(serviceRoot) {
  const schemaPath = path.join(serviceRoot, "prisma", "schema.prisma");
  if (!fs.existsSync(schemaPath)) {
    return { found: false, type: null, envKeys: [] };
  }

  const text = safeReadFile(schemaPath);
  const datasourceMatch = text.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/);
  const providerMatch = (datasourceMatch ? datasourceMatch[1] : text).match(
    /provider\s*=\s*["']([^"']+)["']/,
  );
  const provider = providerMatch ? providerMatch[1].toLowerCase() : null;
  const envKeys = [];
  for (const match of text.matchAll(/env\(\s*["']([^"']+)["']\s*\)/g)) {
    envKeys.push(match[1]);
  }
  return {
    found: true,
    type: normalizeDatabaseProvider(provider),
    envKeys,
  };
}

function readDatabaseSignalText(language, serviceRoot) {
  const filesByLanguage = {
    Go: ["go.mod"],
    Java: ["pom.xml", "build.gradle", "build.gradle.kts"],
    PHP: ["composer.json"],
    Python: ["requirements.txt", "Pipfile", "pyproject.toml"],
    Ruby: ["Gemfile"],
    Rust: ["Cargo.toml"],
  };
  const files = filesByLanguage[language] || [];
  return files
    .map((fileName) => {
      const filePath = path.join(serviceRoot, fileName);
      return fs.existsSync(filePath) ? safeReadFile(filePath) : "";
    })
    .join("\n")
    .toLowerCase();
}

function detectDatabaseTypeFromText(text) {
  if (!text) return null;
  if (
    /mysql-connector-j|mysql-connector-java|go-sql-driver\/mysql|mysqlclient|pymysql|mysql-connector-python|aiomysql|mysql2|pdo_mysql|ext-pdo_mysql|mysql_async|\bmysql\b|mariadb/.test(
      text,
    )
  ) {
    return "mysql";
  }
  if (
    /postgresql|postgres|psycopg|asyncpg|pg8000|lib\/pq|jackc\/pgx|\bpg\b|tokio-postgres/.test(
      text,
    )
  ) {
    return "postgresql";
  }
  return null;
}

function inferDatabaseTypeFromEnvKeys(envKeys) {
  if ((envKeys || []).some((key) => key.startsWith("MYSQL_"))) {
    return "mysql";
  }
  if (
    (envKeys || []).some(
      (key) => key.startsWith("POSTGRES_") || key.startsWith("POSTGRESQL_"),
    )
  ) {
    return "postgresql";
  }
  return null;
}

function detectOrmFromText(language, text) {
  if (!text) return null;
  if (language === "Python") {
    if (/sqlalchemy/.test(text)) return "sqlalchemy";
    if (/django/.test(text)) return "django";
  }
  if (language === "Java") {
    if (/spring-boot-starter-data-jpa/.test(text)) return "spring-data-jpa";
    if (/hibernate/.test(text)) return "hibernate";
    if (/mybatis/.test(text)) return "mybatis";
  }
  if (language === "Ruby") {
    if (/activerecord|rails/.test(text)) return "activerecord";
  }
  if (language === "PHP") {
    if (/laravel\/framework|illuminate\/database/.test(text)) return "laravel";
    if (/doctrine\/orm|doctrine\/dbal/.test(text)) return "doctrine";
  }
  if (language === "Go") {
    if (/gorm\.io\/gorm/.test(text)) return "gorm";
  }
  if (language === "Rust") {
    if (/\bsqlx\b/.test(text)) return "sqlx";
    if (/\bdiesel\b/.test(text)) return "diesel";
  }
  return null;
}

function defaultMigrationCommand(language, orm) {
  if (language === "Ruby" && orm === "activerecord") {
    return "bundle exec rails db:migrate";
  }
  if (language === "PHP" && orm === "laravel") {
    return "php artisan migrate --force";
  }
  return null;
}

function collectDatabaseEnvKeysFromFiles(serviceRoot) {
  const envKeys = [];
  for (const fileName of DATABASE_ENV_FILES) {
    const filePath = path.join(serviceRoot, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const lines = safeReadFile(filePath).split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
      if (match && DATABASE_ENV_KEYS.includes(match[1])) {
        envKeys.push(match[1]);
      }
    }
  }
  return envKeys;
}

function normalizeDatabaseProvider(provider) {
  if (provider === "mysql") return "mysql";
  if (provider === "postgresql" || provider === "postgres") {
    return "postgresql";
  }
  return null;
}

function orderDatabaseEnvKeys(keys) {
  const set = new Set(Array.from(keys || []).filter(Boolean));
  const result = [];
  for (const key of DATABASE_ENV_KEYS) {
    if (set.has(key)) {
      result.push(key);
      set.delete(key);
    }
  }
  for (const key of Array.from(set).sort()) {
    result.push(key);
  }
  return result;
}

function collectDependencyNames(packageJson) {
  const names = new Set();
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys((packageJson && packageJson[group]) || {})) {
      names.add(name);
    }
  }
  return names;
}

function hasAnyDependency(dependencyNames, candidates) {
  for (const name of candidates) {
    if (dependencyNames.has(name)) {
      return true;
    }
  }
  return false;
}

function detectNodeInstallCommand(packageManager) {
  if (packageManager === "pnpm") {
    return "pnpm install --prod";
  }
  if (packageManager === "yarn") {
    return "yarn install --production=true";
  }
  return "npm ci --omit=dev";
}

function detectNodeRuntimeKind({
  serviceRoot,
  packageJson,
  framework,
  hasBuildScript,
  output,
}) {
  const normalizedFramework = String(framework || "").toLowerCase();
  if (
    !hasBuildScript ||
    !output ||
    output === "Source files" ||
    !STATIC_NODE_FRONTEND_FRAMEWORKS.has(normalizedFramework) ||
    (normalizedFramework === "nuxt" && !isStaticNuxtBuildScript(packageJson))
  ) {
    return "process";
  }

  const startScript = String(
    (packageJson.scripts && packageJson.scripts.start) || "",
  ).trim();
  if (startScript) {
    return isStaticNodeStartScript(startScript, packageJson)
      ? "static"
      : "process";
  }

  return hasNodeProcessEntrypoint(serviceRoot, packageJson)
    ? "process"
    : "static";
}

function isStaticNodeStartScript(script, packageJson, seen = new Set()) {
  const normalized = String(script || "").trim();
  if (!normalized) {
    return false;
  }

  const scriptName = matchPackageScriptReference(normalized);
  if (scriptName && !seen.has(scriptName)) {
    const referencedScript =
      packageJson.scripts && typeof packageJson.scripts[scriptName] === "string"
        ? packageJson.scripts[scriptName]
        : null;
    if (referencedScript) {
      seen.add(scriptName);
      return isStaticNodeStartScript(referencedScript, packageJson, seen);
    }
  }

  if (
    /\b(?:npx\s+)?serve\b/.test(normalized) ||
    /\b(?:http-server|sirv|sirv-cli|spa-http-server|static-server)\b/.test(
      normalized,
    ) ||
    /\bvite(?:\s+preview|\s+--|$)/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function isStaticNuxtBuildScript(packageJson) {
  const scripts = (packageJson && packageJson.scripts) || {};
  return (
    isStaticNuxtScript(scripts.build, packageJson) ||
    isStaticNuxtScript(scripts.generate, packageJson)
  );
}

function isStaticNuxtScript(script, packageJson, seen = new Set()) {
  const normalized = String(script || "").trim();
  if (!normalized) {
    return false;
  }

  if (
    /\b(?:nuxi|nuxt)\s+generate\b/.test(normalized) ||
    /\b(?:nuxi|nuxt)\s+build\b[^\n;&|]*\s--prerender\b/.test(normalized)
  ) {
    return true;
  }

  const scriptName = matchPackageScriptReference(normalized);
  if (!scriptName || seen.has(scriptName)) {
    return false;
  }

  const referencedScript =
    packageJson.scripts && typeof packageJson.scripts[scriptName] === "string"
      ? packageJson.scripts[scriptName]
      : null;
  if (!referencedScript) {
    return false;
  }

  seen.add(scriptName);
  return isStaticNuxtScript(referencedScript, packageJson, seen);
}

function matchPackageScriptReference(script) {
  const match = script.match(
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?([A-Za-z0-9:_-]+)/,
  );
  if (!match) {
    return null;
  }

  const scriptName = match[1];
  return scriptName === "start" ? null : scriptName;
}

function hasNodeProcessEntrypoint(serviceRoot, packageJson) {
  if (typeof packageJson.main === "string" && packageJson.main.trim()) {
    return true;
  }

  if (
    NODE_SERVER_DEPENDENCIES.some((name) => hasDependency(packageJson, name))
  ) {
    return true;
  }

  return [
    "server.js",
    "server.cjs",
    "server.mjs",
    "server.ts",
    "app.js",
    "app.ts",
    "index.js",
  ].some((fileName) => fs.existsSync(path.join(serviceRoot, fileName)));
}

function detectNodeStartCommand(serviceRoot, packageJson, packageManager) {
  const scripts = packageJson.scripts || {};
  if (scripts.start) {
    return {
      ok: true,
      command:
        packageManager === "pnpm"
          ? "pnpm start"
          : packageManager === "yarn"
            ? "yarn start"
            : "npm start",
    };
  }

  if (typeof packageJson.main === "string" && packageJson.main.trim()) {
    return {
      ok: true,
      command: `node ${packageJson.main}`,
    };
  }

  const entrypoint = detectSingleEntrypoint(serviceRoot, [
    "server.js",
    "index.js",
  ]);
  if (!entrypoint.ok) {
    return entrypoint;
  }

  return {
    ok: true,
    command: `node ${entrypoint.fileName}`,
  };
}

function detectSingleEntrypoint(serviceRoot, candidates) {
  const matches = candidates.filter((fileName) =>
    fs.existsSync(path.join(serviceRoot, fileName)),
  );

  if (matches.length === 1) {
    return {
      ok: true,
      fileName: matches[0],
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reasonCode: "AMBIGUOUS_ENTRYPOINT",
      message: `Multiple startup files were detected (${matches
        .map((item) => `\`${item}\``)
        .join(
          ", ",
        )}). Please confirm which file should be used to start the app.`,
    };
  }

  return {
    ok: false,
    reasonCode: "START_COMMAND_UNCLEAR",
    message:
      "Could not determine the startup command automatically. Please confirm the file or command used to start the app.",
  };
}

function walkFiles(rootDir, options = {}) {
  const files = [];
  const queue = [rootDir];
  const ignoreDirs = options.ignoreDirs || DISCOVERY_IGNORE_DIRS;

  while (queue.length) {
    const currentDir = queue.shift();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreDirs.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function shouldScanFixedPortBinding(language, detectedConfig) {
  return !(
    language === "Node.js" &&
    detectedConfig &&
    detectedConfig.runtimeKind === "static"
  );
}

function scanFixedPortBinding(language, serviceRoot) {
  const rule = PORT_RULES[language];
  if (!rule) {
    return null;
  }

  const files = walkFiles(serviceRoot, {
    ignoreDirs: PORT_SCAN_IGNORE_DIRS,
  }).filter(
    (filePath) =>
      rule.extensions.includes(path.extname(filePath)) && !isTestFile(filePath),
  );

  for (const filePath of files) {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (isEnvDrivenPortLine(line)) {
        continue;
      }

      for (const pattern of rule.patterns) {
        const match = line.match(pattern);
        if (!match) {
          continue;
        }

        return {
          file: path.relative(serviceRoot, filePath),
          line: index + 1,
          port: match[1],
          lineText: line.trim(),
          suggestion: rule.suggestion,
        };
      }
    }
  }

  return null;
}

function isEnvDrivenPortLine(line) {
  return (
    /process\.env(?:\.PORT|\[['"]PORT['"]\])/.test(line) ||
    /os\.environ\.get\(['"]PORT['"]/.test(line) ||
    /getenv\(['"]PORT['"]/.test(line) ||
    /ENV\[['"]PORT['"]\]/.test(line) ||
    /std::env::var\(['"]PORT['"]\)/.test(line) ||
    /\$\{PORT[:}]/.test(line)
  );
}

function formatPortIssueMessage(issue) {
  return [
    "⚠️ **Port Configuration Required**",
    "",
    `Found a fixed port binding \`${issue.port}\` in \`${issue.file}:${issue.line}\`.`,
    "",
    "The production environment sets `PORT=9000`. Your application must read the port from the `PORT` environment variable at runtime.",
    "",
    "**Suggested fix:**",
    issue.suggestion,
    "",
    "Please update your code, then confirm to proceed.",
  ].join("\n");
}

function isTestFile(filePath) {
  return /\.(test|spec)\.[^.]+$/.test(path.basename(filePath));
}

function parseGoVersion(serviceRoot) {
  const goModPath = path.join(serviceRoot, "go.mod");
  if (fs.existsSync(goModPath)) {
    const match = fs.readFileSync(goModPath, "utf8").match(/^go\s+([\d.]+)/m);
    if (match) {
      return match[1];
    }
  }
  return "1.21";
}

function parseRustVersion(serviceRoot) {
  const toolchainToml = path.join(serviceRoot, "rust-toolchain.toml");
  if (fs.existsSync(toolchainToml)) {
    const match = fs
      .readFileSync(toolchainToml, "utf8")
      .match(/channel\s*=\s*["']([^"']+)["']/);
    if (match) {
      return match[1];
    }
  }

  const toolchain = path.join(serviceRoot, "rust-toolchain");
  if (fs.existsSync(toolchain)) {
    const value = fs.readFileSync(toolchain, "utf8").trim();
    if (value) {
      return value;
    }
  }

  // Cargo.toml's [package].rust-version is the project's stated MSRV. Honor
  // it when set so newer actix-web/tokio Cargo.lock files (which pin
  // rust-version >= 1.86) don't fast-fail under the renderer's default.
  const cargoToml = path.join(serviceRoot, "Cargo.toml");
  if (fs.existsSync(cargoToml)) {
    const text = fs.readFileSync(cargoToml, "utf8");
    // Match `rust-version` only inside the [package] table; ignore the same
    // key inside [workspace.package] or other tables to keep scope tight.
    const packageBlock = text.match(/\[package\]([\s\S]*?)(?:\n\[|$)/);
    if (packageBlock) {
      const m = packageBlock[1].match(
        /(?:^|\n)\s*rust-version\s*=\s*["']([^"']+)["']/,
      );
      if (m) {
        return m[1];
      }
    }
  }

  // Default bumped from 1.85 -> 1.88 because the previous floor was below
  // the MSRV of current actix-web / actix-http / time releases, causing
  // CNB cargo builds to fast-fail with no docker stdout (rust-actix deploy
  // adt-1d875ba49c104d8dbd49d8bb1260f218). 1.88 was the latest stable when
  // this bump landed; users that need an exact toolchain can pin via
  // rust-toolchain.toml.
  return "1.88";
}

function parseCargoBinaryName(serviceRoot) {
  const cargoPath = path.join(serviceRoot, "Cargo.toml");
  if (!fs.existsSync(cargoPath)) {
    return null;
  }

  const match = fs
    .readFileSync(cargoPath, "utf8")
    .match(/^\s*name\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

function parseJavaVersion(serviceRoot, isMaven) {
  if (isMaven) {
    const pomPath = path.join(serviceRoot, "pom.xml");
    const pom = fs.readFileSync(pomPath, "utf8");
    const match =
      pom.match(/<maven\.compiler\.release>([^<]+)</) ||
      pom.match(/<maven\.compiler\.source>([^<]+)</) ||
      pom.match(/<java\.version>([^<]+)</);
    if (match) {
      return match[1];
    }
  }

  return "17";
}

function parsePythonVersion(serviceRoot) {
  const pipfilePath = path.join(serviceRoot, "Pipfile");
  if (fs.existsSync(pipfilePath)) {
    const match = fs
      .readFileSync(pipfilePath, "utf8")
      .match(/python_version\s*=\s*"([^"]+)"/);
    if (match) {
      return match[1];
    }
  }

  const pyprojectPath = path.join(serviceRoot, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    const match = fs
      .readFileSync(pyprojectPath, "utf8")
      .match(/requires-python\s*=\s*"[^\\d]*([\d.]+)[^"]*"/);
    if (match) {
      return match[1];
    }
  }

  return "3.11";
}

function findPhpEntrypoints(projectDir) {
  const phpFiles = walkFiles(projectDir, {
    ignoreDirs: DISCOVERY_IGNORE_DIRS,
  }).filter((filePath) => {
    const normalized = path.relative(projectDir, filePath).replace(/\\/g, "/");
    return normalized.endsWith("index.php") && isPhpEntrypoint(normalized);
  });

  return phpFiles.map((filePath) =>
    path.relative(projectDir, filePath).replace(/\\/g, "/"),
  );
}

function findPhpEntrypointInService(serviceRoot) {
  for (const fileName of ["index.php", path.join("public", "index.php")]) {
    if (fs.existsSync(path.join(serviceRoot, fileName))) {
      return fileName.replace(/\\/g, "/");
    }
  }

  return null;
}

function findRawStaticEntrypoint(projectDir) {
  for (const fileName of RAW_STATIC_INDEX_FILES) {
    if (isFile(path.join(projectDir, fileName))) {
      return fileName;
    }
  }
  return findFirstHtmlFile(projectDir);
}

function findFirstHtmlFile(projectDir) {
  const htmlFile = walkFiles(projectDir, {
    ignoreDirs: DISCOVERY_IGNORE_DIRS,
  }).find((filePath) => /\.html?$/i.test(path.basename(filePath)));
  return htmlFile
    ? path.relative(projectDir, htmlFile).replace(/\\/g, "/")
    : null;
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function inferPhpServiceRoot(projectDir, entrypointPath) {
  const normalized = entrypointPath.replace(/\\/g, "/");
  if (normalized.endsWith("/public/index.php")) {
    return path.resolve(
      projectDir,
      normalized.slice(0, -"public/index.php".length),
    );
  }

  return path.resolve(projectDir, path.dirname(normalized));
}

function isPhpEntrypoint(relativePath) {
  return (
    relativePath === "index.php" ||
    relativePath.endsWith("/index.php") ||
    relativePath.endsWith("/public/index.php")
  );
}

function safeLoadPackageJson(serviceRoot) {
  const packageJsonPath = path.join(serviceRoot, "package.json");
  try {
    return loadPackageJson(serviceRoot);
  } catch (error) {
    throw wrapFileError(error, packageJsonPath);
  }
}

function safeDetectOutputDir(serviceRoot, packageJson) {
  try {
    return detectOutputDir(serviceRoot, { packageJson });
  } catch (error) {
    throw wrapFileError(error, serviceRoot);
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw wrapFileError(error, filePath);
  }
}

function hasDependency(packageJson, dependencyName) {
  if (!packageJson) {
    return false;
  }
  return Boolean(
    (packageJson.dependencies && packageJson.dependencies[dependencyName]) ||
    (packageJson.devDependencies &&
      packageJson.devDependencies[dependencyName]),
  );
}

function wrapFileError(error, filePath) {
  if (error instanceof SyntaxError) {
    return new Error(`Invalid project file: ${filePath}`);
  }

  return error;
}

function relativeDirDepth(projectDir, serviceRoot) {
  const relative = formatRelativeRoot(projectDir, serviceRoot);
  if (relative === ".") {
    return 0;
  }
  return relative.split("/").length;
}

function formatRelativeRoot(projectDir, serviceRoot) {
  const relative = path.relative(projectDir, serviceRoot).replace(/\\/g, "/");
  return relative || ".";
}

module.exports = {
  runArbitraryAnalyze,
};
