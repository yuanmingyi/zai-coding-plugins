#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const SPLIT_HELPER_COMMANDS = [
  "analyze-arbitrary",
  "classify-failure-arbitrary",
  "controller-deploy-arbitrary",
  "format-deploy-arbitrary-report",
  "package-project-arbitrary",
  "poll-arbitrary-task",
  "preflight-arbitrary",
  "prepare-local-arbitrary",
  "record-arbitrary-deployment",
  "remote-deploy-arbitrary",
  "render-dockerfiles-arbitrary",
  "validate-build-arbitrary",
  "verify-access-url-arbitrary",
];
const SPLIT_HELPER_COMMAND_PATTERN = new RegExp(
  `\\b(?:${SPLIT_HELPER_COMMANDS.join("|")})\\b`,
);
const SPLIT_HELPER_CLI_COMMAND_PATTERN = new RegExp(
  `plugin-cli\\.js["']?\\s+(?:${SPLIT_HELPER_COMMANDS.join("|")})\\b`,
);

function usage() {
  console.log(
    [
      "Usage:",
      "  node plugins/glm-plan-deploy/scripts/auditDeployArbitraryAgentLog.js [--json] [--min-score <0-100>] [--score-profile <strict|balanced>] [--fail-on-check <id[,id...]>] <log-file-or-dir>",
      "",
      "If a directory is provided, the newest *.jsonl file is selected.",
      "",
      "Options:",
      "  --json                     Print JSON report instead of human-readable text",
      "  --min-score <n>            Exit code 2 if weighted adherence score is below n",
      "  --score-profile <name>     Score weighting profile: strict (default) or balanced",
      "  --fail-on-check <ids>      Exit code 3 if any listed check IDs are FAIL (repeatable, comma-separated allowed)",
    ].join("\n"),
  );
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectNumericMatches(text, patterns) {
  const values = [];
  if (typeof text !== "string" || !text) return values;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n >= 0) values.push(n);
    }
  }
  return values;
}

function inferConfiguredRetryTimes(allSurfaceBlob, bashCommands) {
  const values = [];
  const surfacePatterns = [
    /"retryTimes"\s*:\s*(\d+)/g,
    /\bDEPLOY_TASK_MAX_RETRIES\s*(?:=|:)\s*(\d+)\b/g,
    /\bretryTimes\s*(?:=|:)\s*(\d+)\b/g,
    /\bretry budget\b[^0-9]{0,40}(\d+)\b/gi,
  ];

  values.push(...collectNumericMatches(allSurfaceBlob, surfacePatterns));

  for (const c of bashCommands) {
    values.push(
      ...collectNumericMatches(c.command, [
        /\bDEPLOY_TASK_MAX_RETRIES\s*=\s*(\d+)\b/g,
        /\bretryTimes\s*(?:=|:)\s*(\d+)\b/g,
      ]),
    );
  }

  return values.length ? values[values.length - 1] : null;
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      obj.__line = i + 1;
      entries.push(obj);
    } catch (err) {
      // Skip malformed lines; keep audit resilient.
    }
  }
  return entries;
}

// The consolidated deploy runs inside a subagent, whose transcript lives in
// `<session-id>/subagents/agent-*.jsonl` next to the main session log. The
// orchestrator session only contains the Agent delegation, not the
// `plugin-cli.js deploy-arbitrary` call, so the auditor must merge the
// subagent entries. Subagent lines are offset into disjoint high ranges so
// each transcript keeps its own internal ordering (read-before-call etc.)
// while still sorting after the parent turn that delegated to it.
function readJsonlWithSubagents(primaryLogPath) {
  const entries = readJsonl(primaryLogPath);
  const dir = path.dirname(primaryLogPath);
  const base = path.basename(primaryLogPath).replace(/\.jsonl$/, "");
  const subagentsDir = path.join(dir, base, "subagents");
  let subFiles = [];
  try {
    subFiles = fs
      .readdirSync(subagentsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .map((f) => path.join(subagentsDir, f));
  } catch {
    return entries;
  }
  const OFFSET_STEP = 1_000_000;
  subFiles.forEach((file, idx) => {
    const base = (idx + 1) * OFFSET_STEP;
    for (const e of readJsonl(file)) {
      e.__line = base + (e.__line || 0);
      e.__subagent = path.basename(file);
      entries.push(e);
    }
  });
  return entries;
}

function resolveLogPath(inputPath) {
  const abs = path.resolve(inputPath);
  const stat = fs.statSync(abs);
  if (stat.isFile()) return abs;
  const files = fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const p = path.join(abs, f);
      return { p, mtimeMs: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!files.length) {
    throw new Error(`No .jsonl files found in directory: ${abs}`);
  }
  return files[0].p;
}

function flattenContentTexts(content) {
  const texts = [];
  if (!Array.isArray(content)) return texts;
  for (const item of content) {
    if (!isObject(item)) continue;
    if (item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
      continue;
    }
    if (item.type === "tool_result") {
      if (typeof item.content === "string") {
        texts.push(item.content);
      } else if (Array.isArray(item.content)) {
        texts.push(...flattenContentTexts(item.content));
      }
    }
  }
  return texts;
}

function collect(entries) {
  const toolUses = [];
  const assistantTexts = [];
  const progressUserToolResultTexts = [];
  const topLevelUserToolResultTexts = [];
  const bashProgressTexts = [];
  const toolUseResults = [];
  const prompts = [];

  for (const e of entries) {
    if (typeof e.prompt === "string")
      prompts.push({ text: e.prompt, line: e.__line });
    if (isObject(e.data) && typeof e.data.prompt === "string") {
      prompts.push({ text: e.data.prompt, line: e.__line });
    }
    if (
      isObject(e.toolUseResult) &&
      typeof e.toolUseResult.prompt === "string"
    ) {
      prompts.push({ text: e.toolUseResult.prompt, line: e.__line });
    }

    if (
      e.type === "progress" &&
      isObject(e.data) &&
      e.data.type === "bash_progress"
    ) {
      const full =
        typeof e.data.fullOutput === "string" ? e.data.fullOutput : "";
      const out = typeof e.data.output === "string" ? e.data.output : "";
      const text = full || out;
      if (text) bashProgressTexts.push({ text, line: e.__line });
    }

    if (typeof e.toolUseResult === "string") {
      toolUseResults.push({ text: e.toolUseResult, line: e.__line });
    }

    if (
      e.type === "progress" &&
      isObject(e.data) &&
      e.data.message &&
      e.data.message.type === "assistant"
    ) {
      const msg = e.data.message.message;
      const content = Array.isArray(msg && msg.content) ? msg.content : [];
      for (const item of content) {
        if (!isObject(item)) continue;
        if (item.type === "tool_use" && typeof item.name === "string") {
          toolUses.push({
            line: e.__line,
            name: item.name,
            input: isObject(item.input) ? item.input : {},
            raw: item,
          });
        } else if (item.type === "text" && typeof item.text === "string") {
          assistantTexts.push({ text: item.text, line: e.__line });
        }
      }
      continue;
    }

    if (e.type === "assistant" && isObject(e.message)) {
      const content = Array.isArray(e.message.content) ? e.message.content : [];
      for (const item of content) {
        if (!isObject(item)) continue;
        if (item.type === "tool_use" && typeof item.name === "string") {
          toolUses.push({
            line: e.__line,
            name: item.name,
            input: isObject(item.input) ? item.input : {},
            raw: item,
          });
        } else if (item.type === "text" && typeof item.text === "string") {
          assistantTexts.push({ text: item.text, line: e.__line });
        }
      }
      continue;
    }

    if (
      e.type === "progress" &&
      isObject(e.data) &&
      e.data.message &&
      e.data.message.type === "user"
    ) {
      const msg = e.data.message.message;
      const texts = flattenContentTexts(msg && msg.content);
      for (const t of texts) {
        progressUserToolResultTexts.push({ text: t, line: e.__line });
      }
      continue;
    }

    if (e.type === "user" && isObject(e.message)) {
      const texts = flattenContentTexts(e.message.content);
      for (const t of texts) {
        // This captures top-level tool_result text (including subagent final output)
        // and also regular user text. Downstream checks use this conservatively.
        topLevelUserToolResultTexts.push({ text: t, line: e.__line });
      }
    }
  }

  return {
    toolUses,
    assistantTexts,
    progressUserToolResultTexts,
    topLevelUserToolResultTexts,
    bashProgressTexts,
    toolUseResults,
    prompts,
  };
}

function findProjectRoot(prompts) {
  for (const p of prompts) {
    const m = p.text.match(/located at (\/[^\n.]+?)(?:\.\s|\.\n|\n|$)/);
    if (m) return { path: m[1], line: p.line };
  }
  return null;
}

function getLineList(items, max = 4) {
  const lines = Array.from(new Set(items.map((x) => x.line))).sort(
    (a, b) => a - b,
  );
  if (lines.length <= max) return lines.map(String).join(", ");
  return `${lines.slice(0, max).join(", ")}, +${lines.length - max} more`;
}

function isTerminalFinalReportText(text) {
  if (typeof text !== "string") return false;
  if (!/"success"\s*:\s*false/.test(text)) return false;
  if (!/"finalReport"\s*:/.test(text)) return false;
  return !/"retryable"\s*:\s*true/.test(text);
}

function isRemoteRetryCommand(command) {
  return /\b(deploy-arbitrary|remote-deploy-arbitrary|package-project-arbitrary|controller-deploy-arbitrary|poll-arbitrary-task|verify-access-url-arbitrary)\b/.test(
    command,
  );
}

// The consolidated happy-path call: `plugin-cli.js deploy-arbitrary`.
// Excludes the lower-level sub-helpers (prepare-local-arbitrary, etc.).
function isConsolidatedDeployCommand(command) {
  return (
    /plugin-cli\.js["']?\s+deploy-arbitrary\b/.test(command) &&
    !SPLIT_HELPER_COMMAND_PATTERN.test(command)
  );
}

// Standalone lower-level helper invocations that must NOT appear on the
// happy path once the consolidated helper produces a finalReport.
function isSubHelperCommand(command) {
  return SPLIT_HELPER_CLI_COMMAND_PATTERN.test(command);
}

// Extract the plugin-cli.js path token and classify how it was resolved.
// Compliant: literal ${PLUGIN_ROOT}/... or an absolute /.../scripts/plugin-cli.js.
// Non-compliant: a cwd/project-relative `plugins/glm-plan-deploy/...` token
// (the deprecated REPO_ROOT-style path that broke uninstalled-project runs).
function classifyPluginCliPath(command) {
  const m = command.match(/(\S*plugin-cli\.js)/);
  if (!m) return { found: false, compliant: false, token: null };
  const token = m[1].replace(/^["']/, "");
  const compliant =
    /^\$\{PLUGIN_ROOT\}\//.test(token) ||
    token.startsWith("$CLAUDE_PLUGIN_ROOT/") ||
    path.isAbsolute(token.replace(/^["']/, ""));
  return { found: true, compliant, token };
}

function isPromptRemoteDiagnosticCommand(command) {
  return (
    /\bcurl\b/.test(command) ||
    /\bnode\s+(?:-e|--eval)\b[\s\S]*\bfetch\s*\(/.test(command) ||
    /\b(?:env|printenv|set)\b[\s\S]*(?:TOKEN|AUTH|PROXY|NODE_OPTIONS)/i.test(
      command,
    ) ||
    /\b(?:dig|nslookup|host)\b/.test(command) ||
    /\bscutil\s+--dns\b/.test(command) ||
    /\bNODE_OPTIONS\s*=/.test(command) ||
    /--dns-result-order/.test(command) ||
    /\/client\/tcb\/(?:initUpload|createTask|status)\b/.test(command)
  );
}

function findSecretExposureEvidence(allSurfaceTexts, bashCommands) {
  const evidence = [];
  const secretPattern =
    /\b(?:ZAI_API_TOKEN|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|TCB_[A-Z0-9_]*TOKEN)\b\s*(?:=|:)\s*["']?[^\s"'`,}]+/i;
  const bearerPattern = /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/i;

  for (const item of allSurfaceTexts) {
    if (secretPattern.test(item.text) || bearerPattern.test(item.text)) {
      evidence.push({
        line: item.line,
        detail: "Secret-like value surfaced in transcript text.",
      });
    }
  }
  for (const command of bashCommands) {
    if (
      secretPattern.test(command.command) ||
      bearerPattern.test(command.command)
    ) {
      evidence.push({
        line: command.line,
        detail: "Secret-like value included in Bash command.",
      });
    }
  }
  return evidence;
}

function redactSensitiveText(text) {
  return text
    .replace(
      /(\b(?:ZAI_API_TOKEN|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|TCB_[A-Z0-9_]*TOKEN)\b\s*(?:=|:)\s*["']?)[^\s"'`,}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

function sanitizeEvidenceValue(value) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(sanitizeEvidenceValue);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sanitizeEvidenceValue(nested),
      ]),
    );
  }
  return value;
}

function makeCheck(id, label, weight, status, reason, evidence = []) {
  return {
    id,
    label,
    weight,
    status,
    reason,
    evidence: evidence.map(sanitizeEvidenceValue),
  };
}

function scoreStatus(status) {
  if (status === "pass") return 1;
  if (status === "partial") return 0.5;
  if (status === "fail") return 0;
  return null; // n/a
}

const SCORE_PROFILES = {
  strict: {},
  balanced: {
    absolute_paths_only: 8,
    plugin_root_resolution: 6,
  },
};

function normalizeScoreProfile(name) {
  if (!name) return "strict";
  const lowered = String(name).toLowerCase();
  if (
    lowered === "manual" ||
    lowered === "manualish" ||
    lowered === "manual-ish"
  ) {
    return "balanced";
  }
  if (!(lowered in SCORE_PROFILES)) {
    throw new Error(
      `Unknown --score-profile: ${name} (expected: ${Object.keys(SCORE_PROFILES).join(", ")})`,
    );
  }
  return lowered;
}

function applyScoreProfile(checks, profileName) {
  const overrides = SCORE_PROFILES[profileName] || {};
  for (const c of checks) {
    c.baseWeight = c.weight;
    if (Object.prototype.hasOwnProperty.call(overrides, c.id)) {
      c.weight = overrides[c.id];
    }
  }
}

function analyze(logPath, entries, options = {}) {
  const scoreProfile = normalizeScoreProfile(options.scoreProfile);
  const data = collect(entries);
  const {
    toolUses,
    assistantTexts,
    progressUserToolResultTexts,
    topLevelUserToolResultTexts,
    bashProgressTexts,
    toolUseResults,
    prompts,
  } = data;
  const projectRootInfo = findProjectRoot(prompts);
  const projectRoot = projectRootInfo ? projectRootInfo.path : null;

  const bashTools = toolUses.filter((t) => t.name === "Bash");
  const bashCommands = bashTools
    .map((t) => ({
      line: t.line,
      command: typeof t.input.command === "string" ? t.input.command : "",
    }))
    .filter((x) => x.command);

  const readTools = toolUses.filter((t) => t.name === "Read");
  const writeTools = toolUses.filter((t) => t.name === "Write");
  const globTools = toolUses.filter((t) => t.name === "Glob");
  const grepTools = toolUses.filter((t) => t.name === "Grep");

  const readPaths = readTools
    .map((t) => ({ line: t.line, path: t.input.file_path }))
    .filter((x) => typeof x.path === "string");
  const writePaths = writeTools
    .map((t) => ({
      line: t.line,
      path: t.input.file_path,
      content: typeof t.input.content === "string" ? t.input.content : "",
    }))
    .filter((x) => typeof x.path === "string");
  const globPaths = globTools
    .map((t) => ({ line: t.line, path: t.input.path }))
    .filter((x) => typeof x.path === "string");

  const assistantSurface = [...assistantTexts, ...topLevelUserToolResultTexts];
  const allSurfaceTexts = [
    ...assistantTexts,
    ...progressUserToolResultTexts,
    ...topLevelUserToolResultTexts,
    ...bashProgressTexts,
    ...toolUseResults,
  ];
  const allSurfaceBlob = allSurfaceTexts.map((x) => x.text).join("\n\n");
  const assistantSurfaceBlob = assistantSurface.map((x) => x.text).join("\n\n");

  const uploadAttempts = bashCommands.filter((c) =>
    /upload-and-deploy\.sh\b/.test(c.command),
  );
  const uploadAttemptCount = uploadAttempts.length;
  const statusBudgetCalls = bashCommands.filter((c) =>
    /\/client\/tcb\/status\b/.test(c.command),
  );
  const configuredRetryTimes = inferConfiguredRetryTimes(
    allSurfaceBlob,
    bashCommands,
  );
  const maxDeployAttempts =
    configuredRetryTimes !== null ? configuredRetryTimes + 1 : null;

  const snMatches = Array.from(
    allSurfaceBlob.matchAll(/Pipeline triggered\. SN:\s*([^\s]+)/g),
  ).map((m) => m[1]);
  const sns = Array.from(new Set(snMatches));

  const runnerLogCalls = bashCommands.filter((c) =>
    /\/build\/runner\/download\/log\//.test(c.command),
  );
  const statusCalls = bashCommands.filter((c) =>
    /\/build\/status\//.test(c.command),
  );
  const hadPipelineFailure =
    /Pipeline failed with status:\s*error|\[ERROR\]\s*Pipeline failed/.test(
      allSurfaceBlob,
    );

  const dockerBuildCommands = bashCommands.filter((c) =>
    /\bdocker build\b/.test(c.command),
  );
  const cleanupCommands = bashCommands.filter(
    (c) =>
      /rm -rf deploy-package/.test(c.command) &&
      /Dockerfile\.build/.test(c.command) &&
      /Dockerfile\.run/.test(c.command) &&
      /buildDockerImage\.sh/.test(c.command),
  );

  const buildValidationCommands = bashCommands.filter((c) =>
    /\bbundle install\b|\bnpm (ci|install)\b|\bpip install\b|\bcomposer install\b|\bmvn clean package\b|\bcargo build\b|\bgo build\b/.test(
      c.command,
    ),
  );

  const copyBuildScript = bashCommands.filter(
    (c) =>
      /\bcp\b/.test(c.command) &&
      /resource\/buildDockerImage\.sh/.test(c.command) &&
      /buildDockerImage\.sh/.test(c.command),
  );

  const dockerfileRunWrites = writePaths.filter((w) =>
    w.path.endsWith("Dockerfile.run"),
  );
  const dockerfileRunHasPort9000 = dockerfileRunWrites.some((w) =>
    /ENV PORT=9000/.test(w.content),
  );
  const dockerfileRunHasCopyDot = dockerfileRunWrites.some((w) =>
    /COPY \. \./.test(w.content),
  );
  const dockerfileRunHasExpose9000 = dockerfileRunWrites.some((w) =>
    /EXPOSE 9000/.test(w.content),
  );

  const detectedConfigMsg = assistantSurface.filter((t) =>
    /Detected Configuration:/.test(t.text),
  );
  const proceedDetectedMsg = assistantSurface.filter((t) =>
    /Proceeding with detected settings/.test(t.text),
  );

  const explicitPortSearch =
    grepTools.length > 0 ||
    bashCommands.some(
      (c) => /\b(rg|grep)\b/.test(c.command) && /port|PORT/.test(c.command),
    );

  const readEntrypointFiles = readPaths.filter((r) =>
    /\/(app\.rb|config\.ru)$/.test(r.path),
  );

  const deployPackageFinds = bashCommands.filter((c) =>
    /find deploy-package -maxdepth 2 -type f \| sort/.test(c.command),
  );
  const readDeployPackageDockerfile = readPaths.filter((r) =>
    /\/deploy-package\/Dockerfile\.build$/.test(r.path),
  );
  const explicitCopyAddParse = bashCommands.filter(
    (c) => /COPY|ADD/.test(c.command) && /Dockerfile\.build/.test(c.command),
  );

  const absolutePathViolations = [];
  const pathLikeTools = [
    ...readPaths.map((x) => ({ ...x, kind: "Read" })),
    ...writePaths.map((x) => ({ line: x.line, path: x.path, kind: "Write" })),
    ...globPaths.map((x) => ({ ...x, kind: "Glob" })),
  ];
  for (const p of pathLikeTools) {
    if (!path.isAbsolute(p.path)) {
      absolutePathViolations.push({
        line: p.line,
        detail: `${p.kind} uses relative path: ${p.path}`,
      });
    }
  }

  // Heuristic: flag relative-path bash ops on generated/project files when a project root was provided.
  if (projectRoot) {
    const trackedBaseNames = new Set();
    for (const r of readPaths) {
      if (r.path.startsWith(projectRoot + path.sep))
        trackedBaseNames.add(path.basename(r.path));
    }
    for (const w of writePaths) {
      if (w.path.startsWith(projectRoot + path.sep))
        trackedBaseNames.add(path.basename(w.path));
    }
    trackedBaseNames.add("deploy-package");

    for (const c of bashCommands) {
      for (const base of trackedBaseNames) {
        const relToken = new RegExp(
          `(^|[\\s'"])${escapeRegExp(base)}(?=($|[\\s/'"]))`,
        );
        const absToken = new RegExp(
          escapeRegExp(path.posix.join(projectRoot.replace(/\\/g, "/"), base)),
        );
        const cmdNorm = c.command.replace(/\\/g, "/");
        if (relToken.test(c.command) && !absToken.test(cmdNorm)) {
          absolutePathViolations.push({
            line: c.line,
            detail: `Bash uses relative project path token: ${base} (${c.command})`,
          });
          break;
        }
      }
    }
  }

  const deploymentLogFileMentionedToUser = /Deployment log file:\s*\S+/.test(
    assistantSurfaceBlob,
  );
  const uploadOutputSurfacedToUser =
    /Pipeline triggered\. SN:/.test(assistantSurfaceBlob) ||
    /Pipeline status:/.test(assistantSurfaceBlob);

  const accessUrlMentioned = /Access URL:/i.test(allSurfaceBlob);
  const postDeployCurls = bashCommands.filter(
    (c) => /\bcurl\b/.test(c.command) && /-i -sS/.test(c.command),
  );
  const deployHelperVerification =
    bashCommands.some((c) =>
      /\b(?:deploy-arbitrary|remote-deploy-arbitrary)\b/.test(c.command),
    ) &&
    (/"verificationStatus"\s*:\s*\d+/.test(allSurfaceBlob) ||
      /"usedDiagnosticRequest"\s*:\s*(true|false)/.test(allSurfaceBlob));

  // --- Consolidated-helper flow evidence ---------------------------------
  const consolidatedDeployCalls = bashCommands.filter((c) =>
    isConsolidatedDeployCommand(c.command),
  );
  const firstConsolidatedCall = consolidatedDeployCalls.length
    ? consolidatedDeployCalls.reduce((a, b) => (a.line <= b.line ? a : b))
    : null;
  const subHelperCalls = bashCommands.filter((c) =>
    isSubHelperCommand(c.command),
  );
  const anyFinalReport = allSurfaceTexts.some((t) =>
    /"finalReport"\s*:/.test(t.text),
  );
  // The agent must surface the helper's finalReport banner verbatim.
  const finalReportBannerInAssistant =
    /\[OK\]\s+Deployment Completed Successfully|\[FAIL\]\s+Deployment Failed/.test(
      assistantSurfaceBlob,
    );
  const helperReturnedFinalReport = [
    ...progressUserToolResultTexts,
    ...topLevelUserToolResultTexts,
    ...toolUseResults,
    ...bashProgressTexts,
  ].some((t) => /"finalReport"\s*:/.test(t.text));
  const needsUserInputSignals = allSurfaceTexts.filter((t) =>
    /"needsUserInput"\s*:\s*true/.test(t.text),
  );
  const classificationSignals = allSurfaceTexts.filter((t) =>
    /"classification"\s*:/.test(t.text),
  );

  const bearerTokenHits = Array.from(
    new Set(
      (
        allSurfaceBlob.match(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/g) || []
      ).map((s) => s.replace(/Bearer\s+.*/, "Bearer [REDACTED]")),
    ),
  );
  const terminalFinalReportTexts = allSurfaceTexts
    .filter((item) => isTerminalFinalReportText(item.text))
    .sort((a, b) => (a.line || 0) - (b.line || 0));
  const firstTerminalFinalReportLine = terminalFinalReportTexts.length
    ? terminalFinalReportTexts[0].line
    : null;
  const toolsAfterTerminalFinalReport =
    firstTerminalFinalReportLine == null
      ? []
      : toolUses.filter((tool) => tool.line > firstTerminalFinalReportLine);
  const bashCommandsAfterTerminalFinalReport =
    firstTerminalFinalReportLine == null
      ? []
      : bashCommands.filter(
          (command) => command.line > firstTerminalFinalReportLine,
        );
  const terminalRetryCommands = bashCommandsAfterTerminalFinalReport.filter(
    (command) => isRemoteRetryCommand(command.command),
  );
  const terminalDiagnosticCommands =
    bashCommandsAfterTerminalFinalReport.filter((command) =>
      isPromptRemoteDiagnosticCommand(command.command),
    );
  const secretExposureEvidence = findSecretExposureEvidence(
    allSurfaceTexts,
    bashCommands,
  );

  const checks = [];

  checks.push(
    makeCheck(
      "no_tools_after_terminal_final_report",
      "No Tool Calls After Terminal finalReport",
      12,
      firstTerminalFinalReportLine == null
        ? "n/a"
        : toolsAfterTerminalFinalReport.length
          ? "fail"
          : "pass",
      firstTerminalFinalReportLine == null
        ? "No terminal failure finalReport detected."
        : toolsAfterTerminalFinalReport.length
          ? "Found tool call(s) after a non-retryable finalReport; terminal reports should be relayed without further action."
          : "No tool calls detected after terminal finalReport.",
      toolsAfterTerminalFinalReport.length
        ? toolsAfterTerminalFinalReport
        : terminalFinalReportTexts,
    ),
  );

  checks.push(
    makeCheck(
      "no_terminal_final_report_retry",
      "No Remote Retry After Terminal finalReport",
      12,
      firstTerminalFinalReportLine == null
        ? "n/a"
        : terminalRetryCommands.length
          ? "fail"
          : "pass",
      firstTerminalFinalReportLine == null
        ? "No terminal failure finalReport detected."
        : terminalRetryCommands.length
          ? "Found remote helper invocation(s) after a non-retryable finalReport."
          : "No remote helper retry detected after terminal finalReport.",
      terminalRetryCommands.length
        ? terminalRetryCommands
        : terminalFinalReportTexts,
    ),
  );

  checks.push(
    makeCheck(
      "no_prompt_remote_diagnostics_after_terminal",
      "No Prompt Remote Diagnostics After Terminal finalReport",
      12,
      firstTerminalFinalReportLine == null
        ? "n/a"
        : terminalDiagnosticCommands.length
          ? "fail"
          : "pass",
      firstTerminalFinalReportLine == null
        ? "No terminal failure finalReport detected."
        : terminalDiagnosticCommands.length
          ? "Found prompt-level curl/env/DNS/proxy/fetch/API diagnostics after terminal finalReport."
          : "No prompt-level remote diagnostics detected after terminal finalReport.",
      terminalDiagnosticCommands.length
        ? terminalDiagnosticCommands
        : terminalFinalReportTexts,
    ),
  );

  checks.push(
    makeCheck(
      "no_secret_exposure",
      "No Secret Exposure In Commands Or Output",
      12,
      secretExposureEvidence.length ? "fail" : "pass",
      secretExposureEvidence.length
        ? "Secret-like token or bearer authorization text was exposed in the transcript."
        : "No secret-like token exposure detected.",
      secretExposureEvidence,
    ),
  );

  checks.push(
    makeCheck(
      "no_local_docker_build",
      "No Local docker build",
      4,
      dockerBuildCommands.length ? "fail" : "pass",
      dockerBuildCommands.length
        ? "Found local docker build command(s), which are prohibited."
        : "No local docker build command found.",
      dockerBuildCommands,
    ),
  );

  checks.push(
    makeCheck(
      "absolute_paths_only",
      "Use Explicit Project Paths For File Ops",
      12,
      absolutePathViolations.length ? "fail" : "pass",
      absolutePathViolations.length
        ? `Found ${absolutePathViolations.length} relative-path file operation(s) despite provided project path.`
        : "No relative-path file ops detected.",
      absolutePathViolations,
    ),
  );

  // --- Consolidated-helper compliance ------------------------------------
  let consolidatedStatus = "fail";
  let consolidatedReason =
    "No consolidated `deploy-arbitrary --json` helper invocation found.";
  if (consolidatedDeployCalls.length === 1) {
    consolidatedStatus = "pass";
    consolidatedReason =
      "Exactly one consolidated deploy-arbitrary helper invocation.";
  } else if (consolidatedDeployCalls.length > 1) {
    consolidatedStatus =
      needsUserInputSignals.length || classificationSignals.length
        ? "partial"
        : "fail";
    consolidatedReason = `Found ${consolidatedDeployCalls.length} consolidated deploy-arbitrary invocations; multiple calls are only justified by needsUserInput or a retryable classification.`;
  }
  checks.push(
    makeCheck(
      "consolidated_helper_invoked",
      "Consolidated Helper Invoked",
      14,
      consolidatedStatus,
      consolidatedReason,
      consolidatedDeployCalls,
    ),
  );

  let flagsStatus = "n/a";
  let flagsReason = "No consolidated helper invocation to inspect.";
  let flagsEvidence = [];
  if (firstConsolidatedCall) {
    const cmd = firstConsolidatedCall.command;
    const hasJson = /--json\b/.test(cmd);
    const cwdMatch = cmd.match(/--cwd\s+["']?([^"'\s]+)/);
    const hasAbsoluteCwd = Boolean(
      cwdMatch &&
      (path.isAbsolute(cwdMatch[1]) ||
        /^\$\{[A-Z_]+\}/.test(cwdMatch[1]) ||
        cwdMatch[1].startsWith("$")),
    );
    flagsStatus = hasJson && hasAbsoluteCwd ? "pass" : "fail";
    flagsReason =
      flagsStatus === "pass"
        ? "Helper called with --json and absolute --cwd."
        : `Helper flags incomplete: --json=${hasJson}, absolute --cwd=${hasAbsoluteCwd}.`;
    flagsEvidence = [firstConsolidatedCall];
  }
  checks.push(
    makeCheck(
      "helper_required_flags",
      "Helper Invoked With Required Flags",
      10,
      flagsStatus,
      flagsReason,
      flagsEvidence,
    ),
  );

  let pluginRootStatus = "n/a";
  let pluginRootReason = "No consolidated helper invocation to inspect.";
  let pluginRootEvidence = [];
  if (firstConsolidatedCall) {
    const info = classifyPluginCliPath(firstConsolidatedCall.command);
    pluginRootStatus = info.compliant ? "pass" : "fail";
    pluginRootReason = info.compliant
      ? `plugin-cli.js resolved from an absolute / \${PLUGIN_ROOT} path (${info.token}).`
      : `plugin-cli.js resolved from a non-absolute, project-relative path (${info.token}); must come from $CLAUDE_PLUGIN_ROOT.`;
    pluginRootEvidence = [firstConsolidatedCall];
  }
  checks.push(
    makeCheck(
      "plugin_root_resolution",
      "Plugin Path Resolved From CLAUDE_PLUGIN_ROOT",
      8,
      pluginRootStatus,
      pluginRootReason,
      pluginRootEvidence,
    ),
  );

  let relayStatus = "n/a";
  let relayReason =
    "Helper did not return a finalReport, so verbatim relay is not applicable.";
  if (helperReturnedFinalReport) {
    relayStatus = finalReportBannerInAssistant ? "pass" : "fail";
    relayReason = finalReportBannerInAssistant
      ? "finalReport banner surfaced verbatim in assistant-facing text."
      : "Helper returned a finalReport but the banner was not relayed to the user.";
  }
  checks.push(
    makeCheck(
      "final_report_relayed_verbatim",
      "finalReport Relayed Verbatim",
      12,
      relayStatus,
      relayReason,
      [],
    ),
  );

  let chainStatus = "n/a";
  let chainReason =
    "No deploy activity detected; sub-helper rule not applicable.";
  if (subHelperCalls.length) {
    chainStatus = "fail";
    chainReason = `Found ${subHelperCalls.length} standalone lower-level sub-helper invocation(s); the consolidated helper must own the full flow.`;
  } else if (anyFinalReport || consolidatedDeployCalls.length > 0) {
    chainStatus = "pass";
    chainReason = "No manual sub-helper chaining detected.";
  }
  checks.push(
    makeCheck(
      "no_manual_subhelper_chaining",
      "No Manual Sub-Helper Chaining",
      8,
      chainStatus,
      chainReason,
      subHelperCalls,
    ),
  );

  checks.push(
    makeCheck(
      "needs_user_input_handled",
      "needsUserInput Handled By Re-Running Helper",
      6,
      needsUserInputSignals.length === 0
        ? "n/a"
        : consolidatedDeployCalls.length >= 2
          ? "pass"
          : "fail",
      needsUserInputSignals.length === 0
        ? "Helper never returned needsUserInput."
        : consolidatedDeployCalls.length >= 2
          ? "needsUserInput was followed by a re-run of the consolidated helper."
          : "needsUserInput returned but the consolidated helper was not re-run.",
      needsUserInputSignals,
    ),
  );

  checks.push(
    makeCheck(
      "retryable_classification_respected",
      "Retryable Classification Respected",
      6,
      classificationSignals.length === 0
        ? "n/a"
        : terminalRetryCommands.length
          ? "fail"
          : "pass",
      classificationSignals.length === 0
        ? "No classification present in transcript."
        : terminalRetryCommands.length
          ? "Remote helper was retried after a non-retryable terminal finalReport."
          : "No disallowed retry after a terminal finalReport.",
      classificationSignals,
    ),
  );

  applyScoreProfile(checks, scoreProfile);

  const weighted = checks
    .map((c) => {
      const s = scoreStatus(c.status);
      if (s === null) return null;
      return { earned: c.weight * s, total: c.weight };
    })
    .filter(Boolean);
  const earned = weighted.reduce((n, x) => n + x.earned, 0);
  const total = weighted.reduce((n, x) => n + x.total, 0);
  const score = total ? (earned / total) * 100 : 0;

  const counts = checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    { pass: 0, partial: 0, fail: 0, "n/a": 0 },
  );

  return {
    logPath,
    projectRootInfo,
    uploadAttemptCount,
    consolidatedDeployCallCount: consolidatedDeployCalls.length,
    sns,
    scoreProfile,
    checks,
    score,
    counts,
    bearerTokenHits,
  };
}

function printReport(report) {
  console.log(`Log: ${report.logPath}`);
  if (report.projectRootInfo) {
    console.log(
      `Project root (from prompt): ${report.projectRootInfo.path} [log line ${report.projectRootInfo.line}]`,
    );
  }
  console.log(
    `Consolidated helper calls: ${report.consolidatedDeployCallCount}`,
  );
  if (report.sns.length) console.log(`Pipeline SNs: ${report.sns.join(", ")}`);
  if (report.scoreProfile) console.log(`Score profile: ${report.scoreProfile}`);
  console.log("");

  console.log(
    `Weighted adherence: ${report.score.toFixed(1)}/100 (${(100 - report.score).toFixed(1)}% non-compliance)`,
  );
  console.log(
    `Checklist counts: pass=${report.counts.pass || 0}, partial=${report.counts.partial || 0}, fail=${report.counts.fail || 0}, n/a=${report.counts["n/a"] || 0}`,
  );
  console.log("");

  for (const c of report.checks) {
    const mark =
      c.status === "pass"
        ? "PASS"
        : c.status === "partial"
          ? "PARTIAL"
          : c.status === "fail"
            ? "FAIL"
            : "N/A";
    const weightText = c.status === "n/a" ? "n/a" : String(c.weight);
    console.log(`[${mark}] (${weightText}) ${c.label}`);
    console.log(`  ${c.reason}`);
    if (c.evidence && c.evidence.length) {
      console.log(`  Evidence lines: ${getLineList(c.evidence)}`);
    }
  }

  if (report.bearerTokenHits.length) {
    console.log("");
    console.log("Warnings:");
    console.log(
      `- Plaintext bearer token references found in log output (${report.bearerTokenHits.length} hit type(s)); rotate credentials if this is a real token.`,
    );
  }
}

function parseCliArgs(argv) {
  const opts = {
    json: false,
    minScore: null,
    scoreProfile: "strict",
    failOnChecks: [],
    target: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      opts.json = true;
      continue;
    }
    if (arg === "--min-score") {
      const next = argv[i + 1];
      if (next == null) throw new Error("--min-score requires a numeric value");
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error("--min-score must be a number between 0 and 100");
      }
      opts.minScore = n;
      i += 1;
      continue;
    }
    if (arg === "--score-profile") {
      const next = argv[i + 1];
      if (next == null) throw new Error("--score-profile requires a value");
      opts.scoreProfile = next;
      i += 1;
      continue;
    }
    if (arg === "--fail-on-check") {
      const next = argv[i + 1];
      if (next == null) {
        throw new Error(
          "--fail-on-check requires a check id or comma-separated list",
        );
      }
      const ids = String(next)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ids.length) {
        throw new Error(
          "--fail-on-check requires at least one non-empty check id",
        );
      }
      opts.failOnChecks.push(...ids);
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      opts.help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (opts.target) {
      throw new Error("Only one log file/directory argument is supported");
    }
    opts.target = arg;
  }

  return opts;
}

function main() {
  let cli;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    usage();
    process.exit(1);
  }

  if (cli.help) {
    usage();
    process.exit(0);
  }

  if (!cli.target) {
    usage();
    process.exit(1);
  }

  let logPath;
  try {
    logPath = resolveLogPath(cli.target);
  } catch (err) {
    console.error(`Error resolving log path: ${err.message}`);
    process.exit(1);
  }

  let entries;
  try {
    entries = readJsonlWithSubagents(logPath);
  } catch (err) {
    console.error(`Error reading/parsing log: ${err.message}`);
    process.exit(1);
  }

  let report;
  try {
    report = analyze(logPath, entries, { scoreProfile: cli.scoreProfile });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const normalizedFailOnChecks = Array.from(new Set(cli.failOnChecks));
  const checkById = new Map(report.checks.map((c) => [c.id, c]));
  const unknownFailCheckIds = normalizedFailOnChecks.filter(
    (id) => !checkById.has(id),
  );
  if (unknownFailCheckIds.length) {
    console.error(
      `Unknown check id(s) for --fail-on-check: ${unknownFailCheckIds.join(", ")}`,
    );
    if (!cli.json) {
      console.error(
        `Available check IDs: ${report.checks.map((c) => c.id).join(", ")}`,
      );
    }
    process.exit(1);
  }

  if (cli.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  const failedPolicyChecks = normalizedFailOnChecks
    .map((id) => checkById.get(id))
    .filter((c) => c && c.status === "fail");
  if (failedPolicyChecks.length) {
    console.error(
      `Required check(s) failed: ${failedPolicyChecks.map((c) => c.id).join(", ")}`,
    );
    process.exit(3);
  }

  if (cli.minScore !== null && report.score < cli.minScore) {
    if (!cli.json) {
      console.error(
        `Score ${report.score.toFixed(1)} is below minimum ${cli.minScore.toFixed(1)}`,
      );
    }
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyze,
  readJsonl,
  resolveLogPath,
};
