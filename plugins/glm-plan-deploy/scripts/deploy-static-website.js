#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const {
  DEFAULT_DEPLOY_API_BASE,
  resolveDeployContext,
} = require("./common/auth");
const { getLatestTaskId, loadArbitrarySettings } = require("./common/settings");
const { runArbitraryAnalyze } = require("./arbitrary/analyze");
const { runArbitraryDeploy } = require("./arbitrary/deploy");
const { runArbitraryPollTask } = require("./arbitrary/pollTask");
const {
  runRecordArbitraryDeployment,
} = require("./arbitrary/recordDeployment");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".deploy-arbitrary");
const DEFAULT_STATUS_TIMEOUT_SECONDS = 600;

async function runDeployStaticWebsite(options = {}) {
  try {
    const cwd = path.resolve(options.cwd || process.cwd());
    const configPath = path.resolve(options.configPath || DEFAULT_CONFIG_PATH);
    const env = await resolveDeployEnv({
      env: options.env || process.env,
      configPath,
      reconfigure: Boolean(options.reconfigure),
      promptImpl: options.promptImpl,
      input: options.input,
      output: options.output,
    });
    const progressReporter = createProgressReporter(options);

    if (isStatusCommand(options)) {
      const statusResult = await runStaticDeployStatus({
        ...options,
        cwd,
        env,
        progressReporter,
      });
      return {
        ...statusResult,
        configPath,
        staticDeployMode: "status",
      };
    }

    const deployPlan = await resolveStaticDeployPlan({
      cwd,
      forcePlain: Boolean(options.plain),
      indexFile: options.indexFile,
      analyzeImpl: options.analyzeImpl || runArbitraryAnalyze,
    });
    if (!deployPlan.success) {
      return deployPlan;
    }

    const deployImpl = options.deployImpl || runArbitraryDeploy;
    const deployResult = await deployImpl({
      cwd,
      env,
      databaseMode: "skip",
      appName: options.appName,
      pollIntervalMs: options.pollIntervalMs,
      onTaskCreated: progressReporter.onTaskCreated,
      onTaskStatusChange: progressReporter.onTaskStatusChange,
      ...deployPlan.deployOptions,
    });
    const recordedDeployResult = await withPersistedDeploymentState({
      result: deployResult,
      cwd,
      env,
      projectId: options.projectId,
      recordDeploymentImpl: options.recordDeploymentImpl,
    });

    return {
      ...recordedDeployResult,
      configPath,
      staticDeployMode: deployPlan.mode,
    };
  } catch (error) {
    return failure(error.message);
  }
}

async function resolveDeployEnv({
  env = process.env,
  configPath = DEFAULT_CONFIG_PATH,
  reconfigure = false,
  promptImpl,
  input = process.stdin,
  output = process.stderr,
} = {}) {
  const baseEnv = { ...env };
  const config = readDeployConfig(configPath);
  let changed = false;

  if (!baseEnv.ZAI_API_TOKEN && config.ZAI_API_TOKEN) {
    baseEnv.ZAI_API_TOKEN = config.ZAI_API_TOKEN;
  }
  if (!baseEnv.ZAI_API_BASE_URL && config.ZAI_API_BASE_URL) {
    baseEnv.ZAI_API_BASE_URL = config.ZAI_API_BASE_URL;
  }

  const ask =
    promptImpl ||
    ((question) =>
      promptForValue({
        ...question,
        input,
        output,
      }));

  if (reconfigure) {
    baseEnv.ZAI_API_TOKEN = await ask({
      name: "ZAI_API_TOKEN",
      message: "ZAI_API_TOKEN",
      secret: true,
    });
    baseEnv.ZAI_API_BASE_URL = await ask({
      name: "ZAI_API_BASE_URL",
      message: "ZAI_API_BASE_URL",
      defaultValue:
        baseEnv.ZAI_API_BASE_URL ||
        config.ZAI_API_BASE_URL ||
        DEFAULT_DEPLOY_API_BASE,
    });
    changed = true;
  } else if (!baseEnv.ZAI_API_TOKEN) {
    baseEnv.ZAI_API_TOKEN = await ask({
      name: "ZAI_API_TOKEN",
      message: "ZAI_API_TOKEN",
      secret: true,
    });
    changed = true;
  }
  if (!baseEnv.ZAI_API_BASE_URL) {
    baseEnv.ZAI_API_BASE_URL = await ask({
      name: "ZAI_API_BASE_URL",
      message: "ZAI_API_BASE_URL",
      defaultValue: DEFAULT_DEPLOY_API_BASE,
    });
    changed = true;
  }

  if (!baseEnv.ZAI_API_TOKEN) {
    throw new Error("ZAI_API_TOKEN is required.");
  }
  if (!baseEnv.ZAI_API_BASE_URL) {
    throw new Error("ZAI_API_BASE_URL is required.");
  }

  if (changed) {
    writeDeployConfig(configPath, {
      ZAI_API_TOKEN: baseEnv.ZAI_API_TOKEN,
      ZAI_API_BASE_URL: baseEnv.ZAI_API_BASE_URL,
    });
  }

  return baseEnv;
}

function isStatusCommand(options = {}) {
  return (
    options.command === "status" ||
    options.command === "fetch-status" ||
    options.status === true
  );
}

async function runStaticDeployStatus(options = {}) {
  const taskIdResult = resolveStatusTaskId({
    cwd: options.cwd,
    env: options.env,
    taskId: options.taskId,
  });
  if (!taskIdResult.success) {
    return taskIdResult;
  }

  const statusImpl = options.statusImpl || runArbitraryPollTask;
  const statusResult = await statusImpl({
    cwd: options.cwd,
    env: options.env,
    fetchImpl: options.fetchImpl,
    taskId: taskIdResult.taskId,
    timeoutSeconds:
      options.timeoutSeconds || String(DEFAULT_STATUS_TIMEOUT_SECONDS),
    pollIntervalMs: options.pollIntervalMs,
    sleepFn: options.sleepFn,
    nowFn: options.nowFn,
    onStatusChange:
      options.onStatusChange ||
      (options.progressReporter && options.progressReporter.onTaskStatusChange),
  });

  return await withPersistedDeploymentState({
    result: {
      ...statusResult,
      taskId: statusResult.taskId || taskIdResult.taskId,
    },
    cwd: options.cwd,
    env: options.env,
    projectId: options.projectId,
    recordDeploymentImpl: options.recordDeploymentImpl,
  });
}

function resolveStatusTaskId({ cwd, env, taskId }) {
  const normalized = normalizeOptionalString(taskId);
  if (normalized) {
    return { success: true, taskId: normalized };
  }

  const context = resolveDeployContext({ cwd, env });
  const settings = loadArbitrarySettings(context.projectSettingsPath, {
    cwd: context.cwd,
    projectName: path.basename(context.cwd),
    endpoint: context.baseUrl,
  });
  const latestTaskId = getLatestTaskId(settings);
  if (!latestTaskId) {
    return failure(
      "No taskId was provided and no previous static deployment task was found in the local settings file.",
      {
        settingsPath: context.projectSettingsPath,
      },
    );
  }
  return { success: true, taskId: latestTaskId };
}

async function withPersistedDeploymentState({
  result,
  cwd,
  env,
  projectId,
  recordDeploymentImpl = runRecordArbitraryDeployment,
}) {
  const ids = extractDeploymentIds(result, { projectId });
  if (!ids.taskId) {
    return result;
  }

  const recordResult = await recordDeploymentImpl({
    cwd,
    env,
    taskId: ids.taskId,
    projectId: ids.projectId,
    area: ids.area,
  });
  return {
    ...result,
    taskId: result.taskId || ids.taskId,
    projectId: result.projectId || ids.projectId || null,
    settingsRecord: recordResult,
    settingsPath: recordResult && recordResult.settingsPath,
  };
}

function extractDeploymentIds(result, fallback = {}) {
  const controllerResult = result && result.controllerResult;
  const pollResult = result && result.pollResult;
  return {
    taskId: firstString(
      result && result.taskId,
      pollResult && pollResult.taskId,
      controllerResult && controllerResult.taskId,
    ),
    projectId: firstString(
      result && result.projectId,
      pollResult && pollResult.projectId,
      controllerResult && controllerResult.projectId,
      fallback.projectId,
    ),
    area: firstString(
      result && result.area,
      controllerResult && controllerResult.area,
      fallback.area,
    ),
  };
}

function firstString(...values) {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createProgressReporter(options = {}) {
  if (options.progress === false) {
    return {
      onTaskCreated: null,
      onTaskStatusChange: null,
    };
  }
  const stream = options.progressStream || options.output || process.stderr;
  return {
    onTaskCreated(event) {
      writeProgressLine(stream, formatTaskCreatedMessage(event));
    },
    onTaskStatusChange(event) {
      writeProgressLine(stream, formatTaskStatusMessage(event));
    },
  };
}

function writeProgressLine(stream, message) {
  if (!stream || typeof stream.write !== "function" || !message) return;
  try {
    stream.write(`${message}\n`);
  } catch (_) {
    // Broken progress streams must not affect deployment.
  }
}

function formatTaskCreatedMessage(event = {}) {
  const taskId = event.taskId || "unknown";
  const project = event.projectId ? ` (projectId: ${event.projectId})` : "";
  return `[deploy-static] Created deploy task ${taskId}${project}.`;
}

function formatTaskStatusMessage(event = {}) {
  const taskId = event.taskId || "unknown";
  const status = event.status || "Unknown";
  const parts = [`[deploy-static] Task ${taskId} status changed: ${status}`];
  if (event.currentStep) {
    parts.push(`step: ${event.currentStep}`);
  }
  if (event.stepMessage) {
    parts.push(event.stepMessage);
  }
  return parts.join(" | ");
}

function readDeployConfig(configPath = DEFAULT_CONFIG_PATH) {
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    return parseDeployConfig(fs.readFileSync(configPath, "utf8"));
  } catch (_) {
    return {};
  }
}

function parseDeployConfig(content) {
  const result = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }
    result[match[1]] = parseConfigValue(match[2].trim());
  }
  return result;
}

function parseConfigValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function writeDeployConfig(configPath, values) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const content = [
    "# Config for glm-plan-deploy static website helper",
    `ZAI_API_TOKEN=${formatConfigValue(values.ZAI_API_TOKEN)}`,
    `ZAI_API_BASE_URL=${formatConfigValue(values.ZAI_API_BASE_URL)}`,
    "",
  ].join("\n");
  fs.writeFileSync(configPath, content, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch (_) {
    // chmod is best effort on non-POSIX filesystems.
  }
}

function formatConfigValue(value) {
  const text = String(value || "");
  return /^[A-Za-z0-9_./:@?&=%+-]+$/.test(text) ? text : JSON.stringify(text);
}

async function promptForValue({
  message,
  defaultValue = "",
  secret = false,
  input = process.stdin,
  output = process.stderr,
}) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const prompt = `${message}${suffix}: `;
  const value =
    secret &&
    input.isTTY &&
    output.isTTY &&
    typeof input.setRawMode === "function"
      ? await promptHidden(prompt, { input, output })
      : await promptLine(prompt, { input, output });
  const trimmed = value.trim();
  return trimmed || defaultValue;
}

function promptLine(prompt, { input, output }) {
  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(output.isTTY),
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(prompt, { input, output }) {
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = input.isRaw;
    output.write(prompt);
    input.setRawMode(true);
    input.resume();

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      output.write("\n");
    };
    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Input cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    input.on("data", onData);
  });
}

async function resolveStaticDeployPlan({
  cwd,
  forcePlain = false,
  indexFile,
  analyzeImpl = runArbitraryAnalyze,
}) {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return failure(`Static website directory does not exist: ${cwd}`);
  }

  const requestedIndex = indexFile ? resolveIndexFile(cwd, indexFile) : null;
  if (requestedIndex && !requestedIndex.success) {
    return requestedIndex;
  }

  if (requestedIndex) {
    return {
      success: true,
      mode: "plain-static",
      deployOptions: plainStaticDeployOverrides(requestedIndex.relativePath),
    };
  }

  if (forcePlain && !fs.existsSync(path.join(cwd, "index.html"))) {
    return failure(
      `Plain static deployment requires an index.html file in ${cwd}`,
    );
  }

  if (forcePlain || isPlainStaticDirectory(cwd)) {
    return {
      success: true,
      mode: "plain-static",
      deployOptions: plainStaticDeployOverrides("index.html"),
    };
  }

  const analyzeResult = await analyzeImpl({ cwd });
  if (!analyzeResult.success) {
    return failure(analyzeResult.message || analyzeResult.summary);
  }
  const detectedConfig = analyzeResult.detectedConfig || {};
  if (analyzeResult.needsUserInput || detectedConfig.runtimeKind !== "static") {
    return failure(
      "The target does not look like a static website. Use a folder with index.html, a supported static frontend build, or rerun with --plain to force raw-file static deployment.",
      {
        analyzeResult,
      },
    );
  }

  return {
    success: true,
    mode: "framework-static",
    deployOptions: {},
  };
}

function isPlainStaticDirectory(cwd) {
  if (!fs.existsSync(path.join(cwd, "index.html"))) {
    return false;
  }
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return true;
  }
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const scripts = packageJson.scripts || {};
    return !scripts.build && !scripts.start;
  } catch (_) {
    return false;
  }
}

function resolveIndexFile(cwd, indexFile) {
  const trimmed = String(indexFile || "").trim();
  if (!trimmed) {
    return failure("--index requires a non-empty HTML file path.");
  }
  const absolutePath = path.resolve(cwd, trimmed);
  if (!isPathInsideDirectory(cwd, absolutePath)) {
    return failure(`--index must point to an HTML file inside ${cwd}`);
  }
  if (!/\.html?$/i.test(path.basename(absolutePath))) {
    return failure("--index must point to a .html or .htm file.");
  }
  try {
    if (!fs.statSync(absolutePath).isFile()) {
      return failure(`--index must point to a file: ${absolutePath}`);
    }
  } catch (_) {
    return failure(`--index file does not exist: ${absolutePath}`);
  }
  return {
    success: true,
    absolutePath,
    relativePath: path.relative(cwd, absolutePath).replace(/\\/g, "/"),
  };
}

function isPathInsideDirectory(directory, candidatePath) {
  const relativePath = path.relative(directory, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function plainStaticDeployOverrides(indexFile = "index.html") {
  const normalizedIndex = normalizeStaticIndexFile(indexFile);
  const overrides = {
    language: "Node.js",
    version: "20",
    serviceRoot: ".",
    buildCommand: "true",
    output: ".",
    startCommand: "static-site",
    runtimeKind: "static",
    framework: "static",
  };
  if (normalizedIndex && normalizedIndex !== "index.html") {
    overrides.staticIndexFile = normalizedIndex;
  }
  return overrides;
}

function normalizeStaticIndexFile(indexFile) {
  return String(indexFile || "index.html")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    command: "deploy",
    cwd: process.cwd(),
    configPath: DEFAULT_CONFIG_PATH,
    json: false,
    plain: false,
  };
  if (args[0] === "status" || args[0] === "fetch-status") {
    parsed.command = args.shift();
  }
  while (args.length) {
    const arg = args.shift();
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "status" || arg === "fetch-status") {
      parsed.command = arg;
    } else if (arg === "--plain") {
      parsed.plain = true;
    } else if (arg === "--status") {
      parsed.command = "status";
    } else if (arg === "--reconfigure") {
      parsed.reconfigure = true;
    } else if (arg === "--cwd") {
      parsed.cwd = readArgValue(args, arg);
    } else if (arg === "--index") {
      parsed.indexFile = readArgValue(args, arg);
    } else if (arg === "--config") {
      parsed.configPath = readArgValue(args, arg);
    } else if (arg === "--appName") {
      parsed.appName = readArgValue(args, arg);
    } else if (arg === "--taskId") {
      parsed.taskId = readArgValue(args, arg);
    } else if (arg === "--projectId") {
      parsed.projectId = readArgValue(args, arg);
    } else if (arg === "--timeoutSeconds") {
      parsed.timeoutSeconds = readArgValue(args, arg);
    } else if (arg === "--pollIntervalMs") {
      parsed.pollIntervalMs = readArgValue(args, arg);
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readArgValue(args, flag) {
  if (!args.length) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return args.shift();
}

function renderHelp() {
  return [
    "Usage:",
    "  node deploy-static-website.js [--cwd <dir>] [--json] [--plain] [--index <html-file>]",
    "  node deploy-static-website.js status [--cwd <dir>] [--taskId <id>] [--json]",
    "",
    "Deploy a static website and wait until the remote deploy task finishes.",
    "Use the status command to fetch the final result of a previously timed-out task.",
    "",
    "Options:",
    "  --cwd <dir>             Static website directory (default: current directory)",
    "  --json                  Print the completed deploy result as JSON",
    "  --plain                 Force raw-file static deployment for index.html folders",
    "  --index <html-file>     Treat this HTML file as index.html during raw-file static deployment",
    "  --status                Fetch task status instead of starting a new deployment",
    "  --taskId <id>           Task ID to fetch; status mode reads local settings when omitted",
    "  --projectId <id>        Optional project ID to persist with the task ID",
    `  --timeoutSeconds <s>    Status polling timeout (default: ${DEFAULT_STATUS_TIMEOUT_SECONDS})`,
    "  --reconfigure           Prompt for deploy credentials again and rewrite the config file",
    "  --config <path>         Credential config path (default: ~/.deploy-arbitrary)",
    "  --appName <name>        Optional deploy app name override",
    "  --pollIntervalMs <ms>   Optional polling interval override",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const { args, result } = await runDeployStaticWebsiteCli(argv);
  if (args.help) {
    process.stdout.write(`${result.summary || renderHelp()}\n`);
  } else if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(
      `${result.finalReport || result.summary || result.message}\n`,
    );
  }
  if (!result.success) {
    process.exitCode = 1;
  }
}

async function runDeployStaticWebsiteCli(argv = [], overrides = {}) {
  const json = argv.includes("--json");
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return {
      args: { json },
      result: failure(error.message),
    };
  }
  if (args.help) {
    return {
      args,
      result: {
        success: true,
        summary: renderHelp(),
      },
    };
  }
  return {
    args,
    result: await runDeployStaticWebsite({
      ...args,
      ...overrides,
    }),
  };
}

function failure(message, extra = {}) {
  return {
    success: false,
    message,
    summary: message,
    ...extra,
  };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_STATUS_TIMEOUT_SECONDS,
  createProgressReporter,
  extractDeploymentIds,
  formatTaskCreatedMessage,
  formatTaskStatusMessage,
  formatConfigValue,
  isStatusCommand,
  parseDeployConfig,
  plainStaticDeployOverrides,
  readDeployConfig,
  renderHelp,
  resolveDeployEnv,
  resolveIndexFile,
  resolveStaticDeployPlan,
  resolveStatusTaskId,
  runDeployStaticWebsite,
  runDeployStaticWebsiteCli,
  runStaticDeployStatus,
  withPersistedDeploymentState,
  writeDeployConfig,
};
