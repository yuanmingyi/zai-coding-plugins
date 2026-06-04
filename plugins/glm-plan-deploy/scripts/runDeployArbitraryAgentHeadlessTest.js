#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_MIN_SCORE = 90;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const PLUGIN_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9_-])(?:\.{1,2}\/)*plugins\/glm-plan-deploy\//;

function usage() {
  console.log(
    [
      "Usage:",
      "  node plugins/glm-plan-deploy/scripts/runDeployArbitraryAgentHeadlessTest.js --project-dir <abs-path> [options]",
      "",
      "Runs /glm-plan-deploy:deploy-arbitrary through Claude Code headless print mode,",
      "then evaluates the resulting Claude .jsonl log for task success and process adherence.",
      "",
      "Options:",
      "  --project-dir <path>        Deployed application directory. Required.",
      "  --repo-root <path>          Repository root containing plugins/glm-plan-deploy. Defaults to cwd.",
      "  --session-cwd <path>        Directory used as Claude CLI cwd/log project. Defaults to project-dir.",
      "  --claude-projects-dir <dir> Claude projects log root. Defaults to ~/.claude/projects.",
      "  --settings-file <path>      Claude Code settings.json to pass via --settings.",
      "  --model <id>                LLM model id to pass via --model (e.g. claude-opus-4-7).",
      "  --log-file <path>           Evaluate an existing .jsonl log instead of running Claude.",
      "  --min-score <0-100>         Minimum process adherence score. Defaults to 90.",
      "  --timeout-ms <n>            Claude run timeout. Defaults to 1800000.",
      "  --json                      Print JSON report.",
      "",
      "The Claude CLI binary is always `claude` (or the CLAUDE_CLI env var when set).",
      "The headless run is launched with --permission-mode=bypassPermissions so deploy",
      "helper Bash calls never stall on permission prompts.",
    ].join("\n"),
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildAgentPrompt(projectDir, repoRoot = process.cwd()) {
  return [
    "/glm-plan-deploy:deploy-arbitrary --run-test",
    "",
    `Deploy the project located at: ${projectDir}`,
    `Repository root containing plugins/glm-plan-deploy: ${repoRoot}`,
    "",
    "IMPORTANT: All file operations for the deployed application must use the absolute path above.",
    "IMPORTANT: Follow the deploy-arbitrary agent prompt exactly and use the one-call deploy-arbitrary scripted helper on the normal path.",
  ].join("\n");
}

function getClaudeProjectLogDir(
  sessionCwd,
  claudeProjectsDir = defaultClaudeProjectsDir(),
) {
  return path.join(claudeProjectsDir, sessionCwd.replace(/\//g, "-"));
}

function defaultClaudeProjectsDir() {
  return path.join(process.env.HOME || process.cwd(), ".claude", "projects");
}

function readJsonl(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      parsed.__line = index + 1;
      entries.push(parsed);
    } catch (_) {
      // Keep log parsing resilient; malformed lines do not make the whole run unreadable.
    }
  }
  return entries;
}

function readJsonlWithSubagents(filePath) {
  const files = [path.resolve(filePath), ...findSubagentJsonlFiles(filePath)];
  const combined = [];
  for (const currentFile of files) {
    for (const entry of readJsonl(currentFile)) {
      combined.push({
        ...entry,
        __source: currentFile,
        __sourceLine: entry.__line,
      });
    }
  }

  return combined
    .sort((left, right) => {
      const leftTime = Date.parse(left.timestamp || "");
      const rightTime = Date.parse(right.timestamp || "");
      if (
        Number.isFinite(leftTime) &&
        Number.isFinite(rightTime) &&
        leftTime !== rightTime
      ) {
        return leftTime - rightTime;
      }
      if (left.__source !== right.__source) {
        return left.__source.localeCompare(right.__source);
      }
      return left.__sourceLine - right.__sourceLine;
    })
    .map((entry, index) => ({
      ...entry,
      __line: index + 1,
    }));
}

function findSubagentJsonlFiles(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.endsWith(".jsonl")) return [];
  const sessionId = path.basename(resolved, ".jsonl");
  const subagentsDir = path.join(
    path.dirname(resolved),
    sessionId,
    "subagents",
  );
  if (!fs.existsSync(subagentsDir)) return [];
  return fs
    .readdirSync(subagentsDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(subagentsDir, name))
    .sort();
}

function listJsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      const filePath = path.join(dir, name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function findNewestJsonlAfter(dir, startedAtMs, beforeFiles = []) {
  const before = new Set(
    beforeFiles.map((item) => path.resolve(item.filePath)),
  );
  return (
    listJsonlFiles(dir).find((item) => {
      const resolved = path.resolve(item.filePath);
      return !before.has(resolved) || item.mtimeMs >= startedAtMs;
    }) || null
  );
}

function flattenContentTexts(content) {
  const texts = [];
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return texts;
  for (const item of content) {
    if (!isObject(item)) continue;
    if (item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
    } else if (item.type === "tool_result") {
      texts.push(...flattenContentTexts(item.content));
    }
  }
  return texts;
}

function collectLogSurface(entries) {
  const texts = [];
  const toolUses = [];

  for (const entry of entries) {
    const line = entry.__line;
    const message =
      entry.type === "progress" &&
      isObject(entry.data) &&
      isObject(entry.data.message)
        ? entry.data.message.message
        : entry.message;

    if (isObject(message)) {
      const content = Array.isArray(message.content) ? message.content : [];
      for (const item of content) {
        if (!isObject(item)) continue;
        if (item.type === "tool_use" && typeof item.name === "string") {
          toolUses.push({
            line,
            name: item.name,
            input: isObject(item.input) ? item.input : {},
          });
        }
      }
      for (const text of flattenContentTexts(content)) {
        texts.push({ line, text });
      }
    }

    if (typeof entry.toolUseResult === "string") {
      texts.push({ line, text: entry.toolUseResult });
    }
    if (isObject(entry.data) && entry.data.type === "bash_progress") {
      const text = entry.data.fullOutput || entry.data.output;
      if (typeof text === "string" && text) texts.push({ line, text });
    }
  }

  const bashCommands = toolUses
    .filter((tool) => tool.name === "Bash")
    .map((tool) => ({
      line: tool.line,
      command: typeof tool.input.command === "string" ? tool.input.command : "",
    }))
    .filter((item) => item.command);

  return { texts, toolUses, bashCommands };
}

function entryTimestampMs(entry) {
  if (!isObject(entry)) return null;
  const raw =
    entry.timestamp || (isObject(entry.data) ? entry.data.timestamp : null);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function collectSessionTimings(entries) {
  const assistantToolUses = new Map();
  const toolResults = new Map();
  const assistantMessageTimestamps = [];
  const allTimestamps = [];

  for (const entry of entries) {
    const ts = entryTimestampMs(entry);
    if (ts != null) allTimestamps.push(ts);
    const message = isObject(entry.message) ? entry.message : null;
    if (!message) continue;
    const content = Array.isArray(message.content) ? message.content : [];

    if (entry.type === "assistant") {
      if (ts != null) assistantMessageTimestamps.push(ts);
      for (const item of content) {
        if (!isObject(item) || item.type !== "tool_use") continue;
        if (typeof item.id !== "string" || !item.id) continue;
        assistantToolUses.set(item.id, {
          id: item.id,
          name: typeof item.name === "string" ? item.name : "unknown",
          input: isObject(item.input) ? item.input : {},
          startedAtMs: ts,
          line: entry.__line,
        });
      }
    } else if (entry.type === "user") {
      for (const item of content) {
        if (!isObject(item) || item.type !== "tool_result") continue;
        const id =
          typeof item.tool_use_id === "string" ? item.tool_use_id : null;
        if (!id) continue;
        toolResults.set(id, {
          id,
          finishedAtMs: ts,
          isError: Boolean(item.is_error),
          content: typeof item.content === "string" ? item.content : "",
          line: entry.__line,
        });
      }
    }
  }

  const toolCalls = [];
  for (const [id, tool] of assistantToolUses) {
    const result = toolResults.get(id) || null;
    const startedAtMs = tool.startedAtMs;
    const finishedAtMs = result ? result.finishedAtMs : null;
    const durationMs =
      startedAtMs != null && finishedAtMs != null
        ? Math.max(0, finishedAtMs - startedAtMs)
        : null;
    toolCalls.push({
      id,
      name: tool.name,
      command:
        typeof tool.input.command === "string" ? tool.input.command : null,
      startedAtMs,
      finishedAtMs,
      durationMs,
      isError: result ? result.isError : null,
      resultContent: result ? result.content : null,
      line: tool.line,
    });
  }

  toolCalls.sort((a, b) => {
    const left = a.startedAtMs == null ? Infinity : a.startedAtMs;
    const right = b.startedAtMs == null ? Infinity : b.startedAtMs;
    return left - right;
  });

  const byName = {};
  let toolTotalMs = 0;
  for (const call of toolCalls) {
    const entry =
      byName[call.name] || (byName[call.name] = { calls: 0, durationMs: 0 });
    entry.calls += 1;
    if (call.durationMs != null) {
      entry.durationMs += call.durationMs;
      toolTotalMs += call.durationMs;
    }
  }

  const firstEntryAtMs = allTimestamps.length
    ? Math.min(...allTimestamps)
    : null;
  const lastEntryAtMs = allTimestamps.length
    ? Math.max(...allTimestamps)
    : null;
  const totalMs =
    firstEntryAtMs != null && lastEntryAtMs != null
      ? Math.max(0, lastEntryAtMs - firstEntryAtMs)
      : null;
  const llmReasoningMs =
    totalMs != null && Number.isFinite(toolTotalMs)
      ? Math.max(0, totalMs - toolTotalMs)
      : null;

  const attempts = extractDeployAttempts(toolCalls);

  return {
    firstEntryAtMs,
    lastEntryAtMs,
    totalMs,
    tools: {
      byName,
      totalCalls: toolCalls.length,
      totalDurationMs: toolTotalMs,
    },
    llmReasoningMs,
    attempts,
    toolCalls,
  };
}

function extractDeployAttempts(toolCalls) {
  const attempts = [];
  for (const call of toolCalls) {
    if (call.name !== "Bash") continue;
    if (
      !call.command ||
      !/\bplugin-cli\.js["']?\s+deploy-arbitrary\b/.test(call.command)
    ) {
      continue;
    }
    const parsed = call.resultContent
      ? parseJsonText(call.resultContent)
      : null;
    const elapsedSeconds =
      parsed && typeof parsed.elapsedSeconds === "number"
        ? parsed.elapsedSeconds
        : null;
    const success =
      parsed && typeof parsed.success === "boolean"
        ? parsed.success
        : call.isError === true
          ? false
          : null;
    attempts.push({
      startedAtMs: call.startedAtMs,
      finishedAtMs: call.finishedAtMs,
      durationMs: call.durationMs,
      stage: parsed && typeof parsed.stage === "string" ? parsed.stage : null,
      success,
      elapsedSeconds,
      reason:
        parsed && typeof parsed.message === "string"
          ? parsed.message
          : parsed && typeof parsed.summary === "string"
            ? parsed.summary
            : null,
      classificationCategory:
        parsed &&
        isObject(parsed.classification) &&
        typeof parsed.classification.category === "string"
          ? parsed.classification.category
          : null,
      retryable:
        parsed &&
        isObject(parsed.classification) &&
        typeof parsed.classification.retryable === "boolean"
          ? parsed.classification.retryable
          : null,
      line: call.line,
    });
  }
  return attempts;
}

function parseJsonText(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    return parseJsonText(trimmed.slice(start, end + 1));
  }
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}

function extractAccessUrl(value) {
  if (
    isObject(value) &&
    typeof value.accessUrl === "string" &&
    value.accessUrl
  ) {
    return value.accessUrl;
  }
  const text =
    typeof value === "string"
      ? value
      : isObject(value)
        ? value.finalReport
        : "";
  const match =
    typeof text === "string" ? text.match(/https?:\/\/[^\s"'<>]+/) : null;
  return match ? match[0] : null;
}

function extractDeployTaskResult(entries) {
  const { texts } = collectLogSurface(entries);
  let latest = {
    status: "unknown",
    reason: "No terminal deploy finalReport found in Claude log.",
    line: null,
  };

  for (const item of texts) {
    const parsed = parseJsonText(item.text);
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, "success")) {
      const finalReport =
        typeof parsed.finalReport === "string" ? parsed.finalReport : "";
      if (
        parsed.success === true &&
        (parsed.stage === "completed" || finalReport)
      ) {
        latest = {
          status: "success",
          line: item.line,
          accessUrl: extractAccessUrl(parsed),
          stage: parsed.stage || null,
          evidence: "Structured deploy helper result reported success.",
        };
        continue;
      }
      if (parsed.success === false && finalReport) {
        latest = {
          status: "failure",
          line: item.line,
          stage: parsed.stage || null,
          reason:
            parsed.message ||
            parsed.summary ||
            "Deploy helper reported failure.",
          evidence: "Structured deploy helper result reported failure.",
        };
      }
      continue;
    }

    if (
      /Deployment Completed Successfully/i.test(item.text) &&
      latest.status === "unknown"
    ) {
      latest = {
        status: "success",
        line: item.line,
        accessUrl: extractAccessUrl(item.text),
        evidence: "Assistant text included successful final report.",
      };
    } else if (
      /Deployment Failed/i.test(item.text) &&
      latest.status === "unknown"
    ) {
      latest = {
        status: "failure",
        line: item.line,
        reason: "Assistant text included failed final report.",
        evidence: "Assistant text included failed final report.",
      };
    }
  }

  return latest;
}

function hasAbsoluteCwd(command, projectDir) {
  if (!path.isAbsolute(projectDir)) return false;
  const escaped = escapeRegExp(projectDir);
  return new RegExp(
    `--cwd\\s+(?:"${escaped}"|'${escaped}'|${escaped})(?:\\s|$)`,
  ).test(command);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreStatus(status) {
  if (status === "pass") return 1;
  if (status === "partial") return 0.5;
  if (status === "fail") return 0;
  return null;
}

function makeCheck(id, weight, status, reason, evidence = []) {
  return { id, weight, status, reason, evidence };
}

function findTerminalFinalReportLine(texts) {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const item = texts[index];
    const parsed = parseJsonText(item.text);
    if (
      parsed &&
      Object.prototype.hasOwnProperty.call(parsed, "success") &&
      parsed.finalReport
    ) {
      return item.line;
    }
    if (
      /Deployment Completed Successfully|Deployment Failed/i.test(item.text)
    ) {
      return item.line;
    }
  }
  return null;
}

function evaluateProcess(entries, projectDir) {
  const { texts, toolUses, bashCommands } = collectLogSurface(entries);
  const deployHelperCommands = bashCommands.filter((item) =>
    /\bplugin-cli\.js["']?\s+deploy-arbitrary\b/.test(item.command),
  );
  const splitHelperCommands = bashCommands.filter((item) =>
    /\b(prepare-local-arbitrary|remote-deploy-arbitrary|package-project-arbitrary|controller-deploy-arbitrary|poll-arbitrary-task|verify-access-url-arbitrary|preflight-arbitrary|analyze-arbitrary|validate-build-arbitrary|render-dockerfiles-arbitrary)\b/.test(
      item.command,
    ),
  );
  const searchTools = toolUses.filter(
    (tool) => tool.name === "Glob" || tool.name === "Grep",
  );
  const searchCommands = bashCommands.filter(
    (item) =>
      /\b(find|rg|grep)\b/.test(item.command) &&
      /(deploy-arbitrary|prepare-local|remote-deploy|finalReport|checklist|progress|agents|README|tests)/i.test(
        item.command,
      ),
  );
  const dockerBuildCommands = bashCommands.filter((item) =>
    /\bdocker\s+build\b/.test(item.command),
  );
  const diagnosticCommands = bashCommands.filter((item) =>
    isPromptRemoteDiagnosticCommand(item.command),
  );
  const pluginSourceEditAttempts = [
    ...toolUses
      .filter((tool) => isPluginWriteTool(tool))
      .map((tool) => ({
        line: tool.line,
        command: tool.name,
        input: tool.input,
      })),
    ...bashCommands.filter((item) => isPluginMutationCommand(item.command)),
  ];
  const repoTestCommands = bashCommands.filter((item) =>
    isRepoTestCommand(item.command),
  );
  const terminalLine = findTerminalFinalReportLine(texts);
  const toolsAfterTerminal =
    terminalLine == null
      ? []
      : toolUses.filter((tool) => tool.line > terminalLine);
  const deploymentResultEvidence = texts.filter((item) =>
    hasDeploymentResultEvidence(item.text),
  );
  const terminalResult = extractTerminalStructuredResult(texts);
  const taskSnapshot = extractDeployTaskResult(entries);
  const stageCoverage = evaluateStageCoverage({ terminalResult });
  const projectFit = evaluateProjectFit({
    projectDir,
    terminalResult,
    task: taskSnapshot,
  });

  const unexpectedAttempts = [
    ...splitHelperCommands.map((item) => ({ kind: "split-helper", ...item })),
    ...searchTools.map((item) => ({
      kind: "search",
      line: item.line,
      command: item.name,
    })),
    ...searchCommands.map((item) => ({ kind: "search", ...item })),
    ...dockerBuildCommands.map((item) => ({
      kind: "local-docker-build",
      ...item,
    })),
    ...diagnosticCommands.map((item) => ({
      kind: "prompt-remote-diagnostic",
      ...item,
    })),
    ...pluginSourceEditAttempts.map((item) => ({
      kind: "plugin-source-edit",
      ...item,
    })),
    ...repoTestCommands.map((item) => ({ kind: "repo-test-command", ...item })),
    ...toolsAfterTerminal.map((item) => ({
      kind: "post-terminal-tool",
      line: item.line,
      command: item.name,
    })),
  ];

  const checks = [
    makeCheck(
      "top_level_deploy_helper_used",
      20,
      deployHelperCommands.length ? "pass" : "fail",
      deployHelperCommands.length
        ? "The normal path invoked plugin-cli.js deploy-arbitrary."
        : "No top-level deploy-arbitrary helper invocation found.",
      deployHelperCommands,
    ),
    makeCheck(
      "deploy_helper_uses_absolute_cwd",
      15,
      deployHelperCommands.some((item) =>
        hasAbsoluteCwd(item.command, projectDir),
      )
        ? "pass"
        : "fail",
      `The deploy helper must pass --cwd with the absolute project path ${projectDir}.`,
      deployHelperCommands,
    ),
    makeCheck(
      "no_split_helper_attempts",
      15,
      splitHelperCommands.length ? "fail" : "pass",
      splitHelperCommands.length
        ? "Found split/lower-level helper invocation(s) on the normal path."
        : "No split/lower-level helper invocation found on the normal path.",
      splitHelperCommands,
    ),
    makeCheck(
      "no_prompt_search_for_fixed_docs",
      10,
      searchTools.length || searchCommands.length ? "fail" : "pass",
      searchTools.length || searchCommands.length
        ? "Found search activity for deploy docs/scripts despite fixed-path instructions."
        : "No unexpected deploy-doc search activity found.",
      [...searchTools, ...searchCommands],
    ),
    makeCheck(
      "no_local_docker_build",
      10,
      dockerBuildCommands.length ? "fail" : "pass",
      dockerBuildCommands.length
        ? "Found local docker build command(s), which are prohibited."
        : "No local docker build command found.",
      dockerBuildCommands,
    ),
    makeCheck(
      "no_prompt_remote_diagnostics",
      10,
      diagnosticCommands.length ? "fail" : "pass",
      diagnosticCommands.length
        ? "Found prompt-level curl/env/fetch/DNS/proxy/API diagnostics."
        : "No prompt-level remote diagnostics found.",
      diagnosticCommands,
    ),
    makeCheck(
      "no_plugin_source_edits",
      15,
      pluginSourceEditAttempts.length ? "fail" : "pass",
      pluginSourceEditAttempts.length
        ? "Found plugin source edit/patch attempt(s) during deployment."
        : "No plugin source edit or patch command found.",
      pluginSourceEditAttempts,
    ),
    makeCheck(
      "no_repo_test_commands",
      15,
      repoTestCommands.length ? "fail" : "pass",
      repoTestCommands.length
        ? "Found repository/plugin test command(s) during deployment."
        : "No repository or plugin test command found.",
      repoTestCommands,
    ),
    makeCheck(
      "stop_after_terminal_final_report",
      10,
      terminalLine == null
        ? "fail"
        : toolsAfterTerminal.length
          ? "fail"
          : "pass",
      terminalLine == null
        ? "No terminal finalReport found."
        : toolsAfterTerminal.length
          ? "Found tool calls after terminal finalReport."
          : "No tool calls after terminal finalReport.",
      toolsAfterTerminal,
    ),
    makeCheck(
      "verified_deploy_result_evidence",
      10,
      deploymentResultEvidence.length ? "pass" : "fail",
      "Claude log must contain deployment result and verification evidence.",
      deploymentResultEvidence,
    ),
    makeCheck(
      "stage_coverage",
      10,
      stageCoverage.status,
      stageCoverage.reason,
      stageCoverage.observedStages || [],
    ),
    makeCheck(
      "project_fit",
      10,
      mapProjectFitStatus(projectFit.status),
      projectFit.reason,
      projectFit.expected || projectFit.actual
        ? [{ expected: projectFit.expected, actual: projectFit.actual }]
        : [],
    ),
  ];

  const weighted = checks
    .map((check) => {
      const statusScore = scoreStatus(check.status);
      if (statusScore === null) return null;
      return {
        earned: statusScore * check.weight,
        total: check.weight,
      };
    })
    .filter(Boolean);
  const earned = weighted.reduce((sum, item) => sum + item.earned, 0);
  const total = weighted.reduce((sum, item) => sum + item.total, 0);
  const checklistScore = total ? (earned / total) * 100 : 0;
  const unexpectedActionLines = new Set(
    unexpectedAttempts
      .map((attempt) => attempt.line)
      .filter((line) => Number.isInteger(line)),
  );
  const actionSummary = {
    total: toolUses.length,
    unexpected: unexpectedActionLines.size,
    compliant: Math.max(0, toolUses.length - unexpectedActionLines.size),
  };
  const actionScore = actionSummary.total
    ? (actionSummary.compliant / actionSummary.total) * 100
    : 0;
  const score = Math.min(checklistScore, actionScore);

  return {
    score,
    checklistScore,
    actionScore,
    actionSummary,
    checks,
    unexpectedAttempts,
    stageCoverage,
    projectFit,
    terminalResult,
  };
}

function hasDeploymentResultEvidence(text) {
  const parsed = parseJsonText(text);
  if (parsed && Object.prototype.hasOwnProperty.call(parsed, "success")) {
    if (parsed.success === false && typeof parsed.finalReport === "string") {
      return true;
    }
    if (parsed.success === true) {
      return (
        typeof parsed.verificationStatus === "number" ||
        typeof parsed.usedDiagnosticRequest === "boolean" ||
        /Deployment Completed Successfully/i.test(parsed.finalReport || "")
      );
    }
  }
  return /Deployment Completed Successfully|Deployment Failed/i.test(text);
}

function isPluginWriteTool(tool) {
  if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool.name)) {
    return false;
  }
  return valueReferencesPluginPath(tool.input);
}

function isPluginMutationCommand(command) {
  if (!valueReferencesPluginPath(command)) {
    return false;
  }
  return (
    /(?:^|\s)(?:>|>>)\s*["']?[^&|;\n]*plugins\/glm-plan-deploy\//.test(
      command,
    ) ||
    /\b(?:cat|printf|echo)\b[\s\S]*(?:>|>>)[\s\S]*plugins\/glm-plan-deploy\//.test(
      command,
    ) ||
    /\btee\b(?:\s+-[A-Za-z0-9_-]+)*[\s\S]*plugins\/glm-plan-deploy\//.test(
      command,
    ) ||
    /\b(?:cp|mv|rm|mkdir|touch|install|rsync|truncate)\b[\s\S]*plugins\/glm-plan-deploy\//.test(
      command,
    ) ||
    /\b(?:sed|perl)\b[\s\S]*(?:-i|-pi)\b[\s\S]*plugins\/glm-plan-deploy\//.test(
      command,
    ) ||
    /\b(?:node|python|python3|perl|ruby)\b[\s\S]*\b(?:writeFileSync|writeFile|appendFile|copyFile|rename|unlink|open|Path)\b[\s\S]*plugins\/glm-plan-deploy\//.test(
      command,
    ) ||
    (PLUGIN_PATH_PATTERN.test(command.replaceAll("\\", "/")) &&
      /\b(?:chmod|chown)\b/.test(command)) ||
    /\bapply_patch\b/.test(command)
  );
}

function isRepoTestCommand(command) {
  return (
    /\bnpm(?:\s+(?:--prefix|-C|--workspace|-w)\s+\S+|\s+--[A-Za-z0-9_-]+(?:=\S+)?|\s+-[A-Za-z0-9_-]+)*\s+(?:run\s+)?(?:test|test:deploy)\b/.test(
      command,
    ) ||
    /\bnpm(?:\s+(?:--prefix|-C|--workspace|-w)\s+\S+|\s+--[A-Za-z0-9_-]+(?:=\S+)?|\s+-[A-Za-z0-9_-]+)*\s+(?:exec|x)(?:\s+--)?(?:\s+--[A-Za-z0-9_-]+(?:=\S+)?|\s+-[A-Za-z0-9_-]+)*\s+(?:jest|vitest)\b/.test(
      command,
    ) ||
    /\bnpx(?:\s+--[A-Za-z0-9_-]+(?:=\S+)?|\s+-[A-Za-z0-9_-]+)*\s+(?:jest|vitest)\b/.test(
      command,
    ) ||
    /\b(?:pnpm|yarn)(?:\s+(?:--dir|-C|--cwd)\s+\S+|\s+--[A-Za-z0-9_-]+(?:=\S+)?|\s+-[A-Za-z0-9_-]+)*\s+(?:run\s+)?(?:test|test:deploy)\b/.test(
      command,
    ) ||
    /\b(?:pnpm|yarn)(?:\s+(?:--dir|-C|--cwd)\s+\S+|\s+--[A-Za-z0-9_-]+(?:=\S+)?|\s+-[A-Za-z0-9_-]+)*\s+(?:exec\s+)?(?:jest|vitest)\b/.test(
      command,
    ) ||
    /\bnode\b[\s\S]*\bnode_modules\/(?:\.bin\/)?(?:jest|vitest|vitest\/vitest\.mjs)\b/.test(
      command,
    ) ||
    /\b(?:jest|vitest)\b/.test(command)
  );
}

function valueReferencesPluginPath(value) {
  if (typeof value === "string") {
    return PLUGIN_PATH_PATTERN.test(value.replaceAll("\\", "/"));
  }
  if (Array.isArray(value)) {
    return value.some((item) => valueReferencesPluginPath(item));
  }
  if (isObject(value)) {
    return Object.values(value).some((item) => valueReferencesPluginPath(item));
  }
  return false;
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

function extractTerminalStructuredResult(texts) {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const item = texts[index];
    const parsed = parseJsonText(item.text);
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, "success")) {
      return { result: parsed, line: item.line };
    }
  }
  return null;
}

const STACK_SIGNATURES = [
  { files: ["package.json"], language: "Node.js" },
  {
    files: ["requirements.txt", "Pipfile", "pyproject.toml"],
    language: "Python",
  },
  { files: ["go.mod"], language: "Go" },
  { files: ["Cargo.toml"], language: "Rust" },
  { files: ["pom.xml", "build.gradle", "build.gradle.kts"], language: "Java" },
  { files: ["composer.json"], language: "PHP" },
  { files: ["Gemfile"], language: "Ruby" },
  { files: ["index.html"], language: "Static" },
];

function detectProjectStack(projectDir) {
  if (!projectDir) return { language: null, indicator: null };
  let listing;
  try {
    listing = new Set(fs.readdirSync(projectDir));
  } catch (_) {
    return { language: null, indicator: null };
  }
  for (const signature of STACK_SIGNATURES) {
    const hit = signature.files.find((name) => listing.has(name));
    if (hit) return { language: signature.language, indicator: hit };
  }
  return { language: null, indicator: null };
}

function normalizeLanguage(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.\s]/g, "");
}

function languagesMatch(expected, reported) {
  const left = normalizeLanguage(expected);
  const right = normalizeLanguage(reported);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.startsWith(right) || right.startsWith(left);
}

function inferLanguageFromUploadedFiles(uploadedFiles) {
  if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) return null;
  const names = new Set(
    uploadedFiles.map((item) =>
      String(item || "")
        .split("/")
        .pop(),
    ),
  );
  for (const signature of STACK_SIGNATURES) {
    if (signature.files.some((name) => names.has(name))) {
      return signature.language;
    }
  }
  return null;
}

function evaluateProjectFit({ projectDir, terminalResult, task }) {
  const detected = detectProjectStack(projectDir);
  const terminalPayload =
    terminalResult && terminalResult.result ? terminalResult.result : null;
  const reportedFromConfig =
    terminalPayload && terminalPayload.detectedConfig
      ? terminalPayload.detectedConfig.language || null
      : null;
  const inferredFromUploads = terminalPayload
    ? inferLanguageFromUploadedFiles(terminalPayload.uploadedFiles)
    : null;
  const reported = reportedFromConfig || inferredFromUploads;

  if (!detected.language && !reported) {
    return {
      status: "n/a",
      expected: null,
      actual: null,
      reason: "Could not detect project stack and helper reported no language.",
    };
  }

  const failedBeforeAnalyze =
    task &&
    task.status === "failure" &&
    ["preflight", "analyze"].includes(task.stage || "");

  if (!reported) {
    if (failedBeforeAnalyze) {
      return {
        status: "n/a",
        expected: detected.language,
        actual: null,
        reason:
          "Deploy helper failed before analyze; no language was reported.",
      };
    }
    return {
      status: "fail",
      expected: detected.language,
      actual: null,
      reason: "Helper produced a terminal result without a detected language.",
    };
  }

  if (!detected.language) {
    return {
      status: "partial",
      expected: null,
      actual: reported,
      reason: `Helper reported ${reported} but no stack-signature file was detected in ${projectDir}.`,
    };
  }

  if (languagesMatch(detected.language, reported)) {
    return {
      status: "pass",
      expected: detected.language,
      actual: reported,
      reason: `Reported language ${reported} matches detected stack ${detected.language} (${detected.indicator}).`,
    };
  }

  return {
    status: "fail",
    expected: detected.language,
    actual: reported,
    reason: `Reported language ${reported} does not match detected stack ${detected.language} (signature: ${detected.indicator}).`,
  };
}

function evaluateStageCoverage({ terminalResult }) {
  if (!terminalResult || !terminalResult.result) {
    return {
      status: "fail",
      observedStages: [],
      missingStages: [],
      reason: "No terminal helper result with stage evidence was found.",
    };
  }
  const result = terminalResult.result;
  const observed = {
    preflight:
      result.projectId != null ||
      result.envStatus != null ||
      result.envReady != null,
    analyze: Boolean(result.detectedConfig && result.detectedConfig.language),
    package: Boolean(result.packageDir),
    controllerDeploy: Boolean(result.taskId),
    pollTask: Boolean(result.accessUrl || result.status),
    verifyAccessUrl: result.verificationStatus != null,
  };
  const observedStages = Object.entries(observed)
    .filter(([, value]) => value)
    .map(([key]) => key);
  const expectedStages = [
    "preflight",
    "analyze",
    "package",
    "controllerDeploy",
    "pollTask",
    "verifyAccessUrl",
  ];

  if (result.success === true && result.stage === "completed") {
    const missing = expectedStages.filter((stage) => !observed[stage]);
    const hasTerminalPair = observed.pollTask && observed.verifyAccessUrl;
    if (!hasTerminalPair) {
      return {
        status: "fail",
        observedStages,
        missingStages: missing,
        reason:
          "Success result lacks the terminal pollTask+verifyAccessUrl pair (accessUrl/status and verificationStatus).",
      };
    }
    return {
      status: "pass",
      observedStages,
      missingStages: missing,
      reason:
        missing.length === 0
          ? `Success result reported evidence for all stages: ${observedStages.join(", ")}.`
          : `Success result observed terminal stages ${observedStages.join(", ")}; intermediate stage evidence absent: ${missing.join(
              ", ",
            )}.`,
    };
  }

  const stoppedAt = result.stage || null;
  const hasStageEvidence = Boolean(stoppedAt || observedStages.length > 0);
  return {
    status: hasStageEvidence ? "pass" : "fail",
    observedStages,
    stoppedAt,
    reason: hasStageEvidence
      ? `Helper stopped at stage ${stoppedAt || "unknown"}; observed earlier stages: ${
          observedStages.join(", ") || "none"
        }.`
      : "Failure result did not report a stage or any intermediate evidence.",
  };
}

const SERVER_LIMIT_PATTERNS = [
  /\bcapacity\b/i,
  /\bquota\b/i,
  /rate[- ]?limit/i,
  /too many requests/i,
  /\b429\b/,
  /\b5\d{2}\b/,
  /temporarily unavailable/i,
  /service unavailable/i,
  /\bupstream\b/i,
  /throttl/i,
  /\btimeout\b/i,
  /server busy/i,
  /no available .*(?:worker|runner|slot)/i,
  /fetch failed/i,
  /socket hang up/i,
  /network (?:error|unreachable)/i,
  /connection (?:refused|reset|aborted|closed)/i,
  /getaddrinfo (?:ENOTFOUND|EAI_AGAIN)/i,
];

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_RESPONSE_STATUS_CODE",
]);

const PLATFORM_CLASSIFICATION_CATEGORIES = new Set([
  "REMOTE_HELPER_TERMINAL_FAILURE",
  "CONTROLLER_ENDPOINT_UNREACHABLE",
  "POLL_TASK_UNREACHABLE",
]);

const SERVER_LIMIT_STAGES = new Set([
  "initUpload",
  "upload",
  "createTask",
  "controllerDeploy",
  "pollTask",
  "verifyAccessUrl",
]);

function isServerLimitFailure(stage, reason, terminalResult = null) {
  const text = String(reason || "");
  if (
    SERVER_LIMIT_STAGES.has(stage) &&
    SERVER_LIMIT_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return true;
  }
  if (
    /capacity exceeded|quota exceeded|rate limit|too many requests/i.test(text)
  ) {
    return true;
  }

  const result =
    terminalResult &&
    typeof terminalResult === "object" &&
    terminalResult.result
      ? terminalResult.result
      : null;
  if (!result) return false;

  const category =
    result.classification && typeof result.classification.category === "string"
      ? result.classification.category
      : null;
  if (category && PLATFORM_CLASSIFICATION_CATEGORIES.has(category)) {
    return true;
  }

  const apiRecords = Array.isArray(result.apiRecords) ? result.apiRecords : [];
  const records = apiRecords.length
    ? apiRecords
    : result.apiRecord
      ? [result.apiRecord]
      : [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (record.causeCode && NETWORK_ERROR_CODES.has(String(record.causeCode)))
      return true;
    const errorText = `${record.errorMessage || ""} ${record.causeMessage || ""}`;
    if (
      errorText &&
      SERVER_LIMIT_PATTERNS.some((pattern) => pattern.test(errorText))
    ) {
      return true;
    }
  }
  return false;
}

function mapProjectFitStatus(status) {
  if (status === "fail") return "fail";
  if (status === "pass") return "pass";
  // "partial" and "n/a" do not penalise — we only flag confirmed mismatches.
  return "pass";
}

function classifyDeployOutcome({ task, processResult, terminalResult = null }) {
  const hasViolations =
    processResult &&
    Array.isArray(processResult.unexpectedAttempts) &&
    processResult.unexpectedAttempts.length > 0;

  if (hasViolations) {
    return {
      category: "agent_caused_failure",
      reason: "Agent took prohibited actions during deployment.",
      stage: task ? task.stage || null : null,
    };
  }

  const effectiveTerminal =
    terminalResult || (processResult && processResult.terminalResult) || null;

  if (!task) {
    return {
      category: "unknown",
      reason: "No deploy task evidence found.",
      stage: null,
    };
  }

  if (task.status === "success") {
    return {
      category: "success",
      reason: task.evidence || null,
      stage: task.stage || null,
    };
  }

  if (task.status === "failure") {
    const reason = task.reason || "";
    if (isServerLimitFailure(task.stage, reason, effectiveTerminal)) {
      return {
        category: "server_limit_failure",
        reason,
        stage: task.stage || null,
      };
    }
    return { category: "unknown", reason, stage: task.stage || null };
  }

  return {
    category: "unknown",
    reason: task.reason || null,
    stage: task.stage || null,
  };
}

function evaluateHeadlessAgentLog({
  logPath,
  entries,
  projectDir,
  minScore = DEFAULT_MIN_SCORE,
}) {
  const task = extractDeployTaskResult(entries);
  const processResult = evaluateProcess(entries, projectDir);
  const outcome = classifyDeployOutcome({ task, processResult });
  const session = collectSessionTimings(entries);
  const passed =
    processResult.score >= minScore &&
    outcome.category !== "agent_caused_failure";
  return {
    logPath,
    minScore,
    task,
    outcome,
    process: processResult,
    session,
    passed,
  };
}

function evaluateClaudeResult(result) {
  if (!result) {
    return {
      ok: true,
      status: "not-run",
      reason: "Claude Code was not run because --log-file was provided.",
    };
  }
  if (result.timedOut) {
    return {
      ok: false,
      status: "timed-out",
      reason: "Claude Code headless run timed out.",
    };
  }
  if (result.signal) {
    return {
      ok: false,
      status: "signal",
      reason: `Claude Code headless run exited from signal ${result.signal}.`,
    };
  }
  if (result.code !== 0) {
    return {
      ok: false,
      status: "non-zero-exit",
      reason: `Claude Code headless run exited with code ${result.code}.`,
    };
  }
  return {
    ok: true,
    status: "ok",
    reason: "Claude Code headless run exited successfully.",
  };
}

function splitCommandLine(commandLine) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const char of commandLine) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (quote) throw new Error(`Unterminated quote in command: ${commandLine}`);
  if (current) tokens.push(current);
  return tokens;
}

function runCommand(commandLine, args, options = {}) {
  const tokens = splitCommandLine(commandLine);
  if (!tokens.length) {
    return Promise.reject(new Error("Claude CLI command is empty."));
  }
  const [command, ...baseArgs] = tokens;
  const childArgs = [...baseArgs, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(command, childArgs, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBuffer = "";
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);

    const flushLines = (final = false) => {
      if (typeof options.onStdoutLine !== "function") return;
      const parts = stdoutBuffer.split(/\r?\n/);
      const lines = final ? parts : parts.slice(0, -1);
      stdoutBuffer = final ? "" : parts[parts.length - 1];
      for (const line of lines) {
        if (!line) continue;
        try {
          options.onStdoutLine(line);
        } catch (_) {
          // Never let an onStdoutLine handler break the child pipe.
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!options.quiet) process.stdout.write(chunk);
      if (typeof options.onStdoutLine === "function") {
        stdoutBuffer += text;
        flushLines(false);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (!options.quiet) process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      flushLines(true);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

function extractSessionIdFromStdoutLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.session_id === "string" && parsed.session_id) {
      return parsed.session_id;
    }
  } catch (_) {
    // Not NDJSON; ignore.
  }
  return null;
}

async function runHeadlessAgentTest(options) {
  const projectDir = path.resolve(options.projectDir);
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const sessionCwd = path.resolve(options.sessionCwd || projectDir);
  const claudeProjectsDir = path.resolve(
    options.claudeProjectsDir ||
      process.env.CLAUDE_PROJECTS_DIR ||
      defaultClaudeProjectsDir(),
  );
  const minScore =
    options.minScore == null ? DEFAULT_MIN_SCORE : Number(options.minScore);

  let logPath = options.logFile ? path.resolve(options.logFile) : null;
  let claudeResult = null;
  let capturedSessionId = null;

  if (!logPath) {
    const logDir = getClaudeProjectLogDir(sessionCwd, claudeProjectsDir);
    const beforeFiles = listJsonlFiles(logDir);
    const startedAtMs = Date.now();
    const prompt = buildAgentPrompt(projectDir, repoRoot, startedAtMs);
    const claudeArgs = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode=bypassPermissions",
    ];
    if (options.settingsFile) {
      claudeArgs.push("--settings", path.resolve(options.settingsFile));
    }
    if (options.model) {
      claudeArgs.push("--model", options.model);
    }
    claudeResult = await runCommand(
      options.claudeCli || process.env.CLAUDE_CLI || "claude",
      claudeArgs,
      {
        cwd: sessionCwd,
        env: {
          ...process.env,
          ...(options.env || {}),
          CLAUDE_PROJECTS_DIR: claudeProjectsDir,
        },
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        quiet: Boolean(options.json),
        onStdoutLine: (line) => {
          if (capturedSessionId) return;
          const sessionId = extractSessionIdFromStdoutLine(line);
          if (sessionId) capturedSessionId = sessionId;
        },
      },
    );
    const finishedAtMs = Date.now();
    if (claudeResult) {
      claudeResult.startedAtMs = startedAtMs;
      claudeResult.finishedAtMs = finishedAtMs;
      claudeResult.elapsedMs = Math.max(0, finishedAtMs - startedAtMs);
    }

    logPath = resolveHeadlessLogPath({
      logDir,
      sessionId: capturedSessionId,
      startedAtMs,
      beforeFiles,
    });
    if (!logPath) {
      throw new Error(
        `No Claude .jsonl log found in ${logDir}${
          capturedSessionId ? ` for session ${capturedSessionId}` : ""
        }`,
      );
    }
  }

  const entries = readJsonlWithSubagents(logPath);
  const report = evaluateHeadlessAgentLog({
    logPath,
    entries,
    projectDir,
    minScore,
  });
  report.claude = claudeResult;
  report.claudeStatus = evaluateClaudeResult(claudeResult);
  report.sessionId = capturedSessionId || null;
  report.passed = report.passed && report.claudeStatus.ok;
  return report;
}

function resolveHeadlessLogPath({
  logDir,
  sessionId,
  startedAtMs,
  beforeFiles,
}) {
  if (sessionId) {
    const candidate = path.join(logDir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  const newest = findNewestJsonlAfter(logDir, startedAtMs, beforeFiles);
  return newest ? newest.filePath : null;
}

function parseCliArgs(argv) {
  const options = {
    minScore: DEFAULT_MIN_SCORE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const valueOptions = new Set([
      "--project-dir",
      "--repo-root",
      "--session-cwd",
      "--claude-projects-dir",
      "--settings-file",
      "--model",
      "--log-file",
      "--min-score",
      "--timeout-ms",
    ]);
    if (valueOptions.has(arg)) {
      const next = argv[index + 1];
      if (next == null) throw new Error(`${arg} requires a value.`);
      const key = arg
        .slice(2)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function extractHelperTotalSeconds(report) {
  const terminal =
    report && report.process && report.process.terminalResult
      ? report.process.terminalResult
      : null;
  if (!terminal || !terminal.result) return null;
  const total = terminal.result.elapsedSeconds;
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  return total;
}

function printHumanReport(report) {
  console.log(`Log: ${report.logPath}`);
  if (report.sessionId) console.log(`Session id: ${report.sessionId}`);
  console.log(`Task result: ${report.task.status}`);
  if (report.outcome) {
    console.log(
      `Outcome: ${report.outcome.category}${report.outcome.stage ? ` (stage: ${report.outcome.stage})` : ""}`,
    );
    if (report.outcome.reason)
      console.log(`Outcome reason: ${report.outcome.reason}`);
  }
  if (report.claudeStatus && !report.claudeStatus.ok) {
    console.log(
      `Claude run: ${report.claudeStatus.status} (${report.claudeStatus.reason})`,
    );
  }
  if (report.task.accessUrl)
    console.log(`Access URL: ${report.task.accessUrl}`);
  if (report.task.reason) console.log(`Reason: ${report.task.reason}`);
  if (report.claude && Number.isFinite(report.claude.elapsedMs)) {
    const helperTotal = extractHelperTotalSeconds(report);
    const claudeSeconds = Math.round(report.claude.elapsedMs / 1000);
    const gapLine =
      helperTotal != null
        ? ` (helper Total: ${helperTotal}s, gap: ${claudeSeconds - helperTotal}s)`
        : "";
    console.log(`Claude CLI wall clock: ${claudeSeconds}s${gapLine}`);
  }
  if (report.process && report.process.projectFit) {
    const fit = report.process.projectFit;
    console.log(
      `Project fit: ${fit.status}${fit.expected ? ` (expected ${fit.expected}` : ""}${
        fit.actual ? `${fit.expected ? ", " : " ("}actual ${fit.actual}` : ""
      }${fit.expected || fit.actual ? ")" : ""}`,
    );
  }
  console.log(
    `Process score: ${report.process.score.toFixed(1)}/100 (minimum ${report.minScore})`,
  );
  console.log(
    `Action adherence: ${report.process.actionSummary.compliant}/${report.process.actionSummary.total} compliant (${report.process.actionScore.toFixed(1)}/100)`,
  );
  console.log(
    `Checklist score: ${report.process.checklistScore.toFixed(1)}/100`,
  );
  console.log(
    `Unexpected attempts: ${report.process.unexpectedAttempts.length}`,
  );
  for (const attempt of report.process.unexpectedAttempts) {
    console.log(
      `- ${attempt.kind} at line ${attempt.line}: ${attempt.command}`,
    );
  }
  if (report.session) printSessionTiming(report.session);
  console.log("");
  for (const check of report.process.checks) {
    console.log(
      `[${check.status.toUpperCase()}] (${check.weight}) ${check.id}: ${check.reason}`,
    );
  }
}

function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function printSessionTiming(session) {
  console.log("");
  console.log("Session timing:");
  console.log(`  Log span         : ${formatMs(session.totalMs)}`);
  console.log(
    `  LLM reasoning    : ${formatMs(session.llmReasoningMs)} (approx. = log span - tool time)`,
  );
  console.log(
    `  Tool total       : ${formatMs(session.tools.totalDurationMs)} across ${session.tools.totalCalls} call(s)`,
  );
  const sortedTools = Object.entries(session.tools.byName || {}).sort(
    (a, b) => b[1].durationMs - a[1].durationMs,
  );
  for (const [name, stats] of sortedTools) {
    console.log(
      `    - ${name.padEnd(12)} ${String(stats.calls).padStart(3)} call(s)  ${formatMs(stats.durationMs)}`,
    );
  }

  if (!Array.isArray(session.attempts) || session.attempts.length === 0) return;
  console.log("Deploy helper attempts:");
  session.attempts.forEach((attempt, index) => {
    const outcomeLabel =
      attempt.success === true
        ? "success"
        : attempt.success === false
          ? "failure"
          : "unknown";
    const stageLabel = attempt.stage ? ` @ ${attempt.stage}` : "";
    const durationLabel = formatMs(attempt.durationMs);
    const elapsedNote =
      attempt.elapsedSeconds != null && attempt.elapsedSeconds >= 0
        ? ` (helper-reported ${attempt.elapsedSeconds}s)`
        : "";
    console.log(
      `  #${index + 1} ${outcomeLabel}${stageLabel}: ${durationLabel}${elapsedNote}`,
    );
    if (attempt.reason) {
      console.log(`      reason: ${attempt.reason}`);
    }
    if (attempt.classificationCategory) {
      console.log(
        `      classification: ${attempt.classificationCategory}${
          attempt.retryable === true
            ? " (retryable)"
            : attempt.retryable === false
              ? " (terminal)"
              : ""
        }`,
      );
    }
  });
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(1);
  }

  if (options.help) {
    usage();
    process.exit(0);
  }
  if (!options.projectDir) {
    usage();
    process.exit(1);
  }

  try {
    const report = await runHeadlessAgentTest(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHumanReport(report);
    }
    if (!report.passed) {
      const isAgentCaused =
        report.outcome && report.outcome.category === "agent_caused_failure";
      process.exit(isAgentCaused ? 1 : 2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildAgentPrompt,
  classifyDeployOutcome,
  collectLogSurface,
  collectSessionTimings,
  detectProjectStack,
  evaluateHeadlessAgentLog,
  evaluateClaudeResult,
  evaluateProcess,
  evaluateProjectFit,
  evaluateStageCoverage,
  extractDeployAttempts,
  extractDeployTaskResult,
  extractSessionIdFromStdoutLine,
  extractTerminalStructuredResult,
  findNewestJsonlAfter,
  findTerminalFinalReportLine,
  getClaudeProjectLogDir,
  isServerLimitFailure,
  languagesMatch,
  readJsonl,
  readJsonlWithSubagents,
  resolveHeadlessLogPath,
  runHeadlessAgentTest,
  splitCommandLine,
};
