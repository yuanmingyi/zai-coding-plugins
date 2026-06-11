"use strict";

const fs = require("fs");
const path = require("path");

const { renderTemplate } = require("./renderTemplate");

const LEFT_CELL_WIDTH = 28;
const RIGHT_CELL_WIDTH = 29;
const NO_VALUE = "—";

const TEMPLATES = loadTemplates();

async function runFormatArbitraryDeployReport(options = {}) {
  try {
    const outcome = resolveOutcome(options.outcome);
    const localSeconds = normalizeDuration(options.localSeconds);
    const remoteSeconds = normalizeDuration(options.remoteSeconds);
    const pollSeconds = normalizeBoundedDuration(
      options.pollSeconds,
      remoteSeconds,
    );
    const totalSeconds = normalizeRequiredDuration(
      options.totalSeconds,
      "totalSeconds",
    );
    const local = formatNormalizedDuration(localSeconds);
    const remote = formatNormalizedDuration(
      remoteDisplaySeconds(remoteSeconds, pollSeconds),
    );
    const poll = pollSeconds == null ? null : renderDuration(pollSeconds);
    const total = renderDuration(totalSeconds);
    const projectIdLine = renderProjectIdLine(
      options.projectId,
      outcome === "success",
    );
    const taskIdLine = renderTaskIdLine(options.taskId, outcome === "success");

    const debugLogsBlock = renderDebugLogsBlock(options.claudeLogPaths);

    const report =
      outcome === "success"
        ? buildSuccessReport({
            accessUrl: resolveRequiredText(options.accessUrl, "accessUrl"),
            accessControlNoticeBlock: renderAccessControlNoticeBlock(options),
            projectIdLine,
            taskIdLine,
            local,
            remote,
            poll,
            total,
            debugLogsBlock,
          })
        : buildFailureReport({
            stageLabel: mapStageLabel(
              resolveRequiredText(options.stage, "stage"),
            ),
            reason: resolveRequiredText(options.reason, "reason"),
            action: resolveRequiredText(options.action, "action"),
            projectIdLine,
            taskIdLine,
            local,
            remote,
            poll,
            total,
            debugLogsBlock,
          });

    return {
      success: true,
      report,
      summary: report,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      summary: error.message,
    };
  }
}

function loadTemplates() {
  const dir = path.join(__dirname, "templates");
  const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
  return {
    success: read("success.tmpl"),
    failure: read("failure.tmpl"),
    projectIdLine: read("project-id-line.tmpl"),
    taskIdLine: read("task-id-line.tmpl"),
    timeCost: read("time-cost.tmpl"),
    timeCostRow: read("time-cost-row.tmpl"),
    debugLogs: read("debug-logs.tmpl"),
  };
}

function renderProjectIdLine(value, isSuccess) {
  if (isTruthyId(value)) {
    return renderTemplate(TEMPLATES.projectIdLine, {
      projectId: String(value),
    });
  }
  if (isSuccess) {
    console.warn(
      "formatDeployReport: projectId is missing on a successful deployment; omitting Project ID line.",
    );
  }
  return "";
}

function renderTaskIdLine(value, isSuccess) {
  if (isTruthyId(value)) {
    return renderTemplate(TEMPLATES.taskIdLine, { taskId: String(value) });
  }
  if (isSuccess) {
    console.warn(
      "formatDeployReport: taskId is missing on a successful deployment; omitting Task ID line.",
    );
  }
  return "";
}

function isTruthyId(value) {
  if (value == null) return false;
  const trimmed = String(value).trim();
  return trimmed.length > 0;
}

function resolveOutcome(value) {
  if (value !== "success" && value !== "failure") {
    throw new Error(
      "Missing required report input: `outcome` must be `success` or `failure`.",
    );
  }
  return value;
}

function resolveRequiredText(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required report input: \`${fieldName}\`.`);
  }
  return value.trim();
}

function normalizeRequiredDuration(value, fieldName) {
  const normalized = normalizeDuration(value);
  if (normalized == null) {
    throw new Error(
      `Missing required report input: \`${fieldName}\` must be a non-negative number.`,
    );
  }
  return normalized;
}

function formatNormalizedDuration(normalized) {
  return normalized == null ? NO_VALUE : renderDuration(normalized);
}

function normalizeDuration(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.floor(number);
}

function normalizeBoundedDuration(value, maximum) {
  const normalized = normalizeDuration(value);
  if (normalized == null) return null;
  const normalizedMaximum = normalizeDuration(maximum);
  if (normalizedMaximum == null) return normalized;
  return Math.min(normalized, normalizedMaximum);
}

function remoteDisplaySeconds(remoteSeconds, pollSeconds) {
  if (remoteSeconds == null) return null;
  if (pollSeconds == null) return remoteSeconds;
  return Math.max(0, remoteSeconds - pollSeconds);
}

function renderDuration(seconds) {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}m ${remaining}s`;
  }
  return `${seconds}s`;
}

function buildSuccessReport(values) {
  return trimFinalNewline(
    renderTemplate(TEMPLATES.success, {
      accessUrl: values.accessUrl,
      accessControlNoticeBlock: values.accessControlNoticeBlock || "",
      projectIdLine: values.projectIdLine,
      taskIdLine: values.taskIdLine,
      timeCostBlock: renderTimeCostBlock(values),
      debugLogsBlock: values.debugLogsBlock || "",
    }),
  );
}

function renderAccessControlNoticeBlock(options) {
  if (options.expectedAccessDenied === true) {
    const status = normalizeHttpStatus(options.verificationStatus) || 403;
    return `\n  Access    : Restricted; verification got expected HTTP ${status}`;
  }

  if (options.verificationError) {
    return `\n  Access    : Verification inconclusive; ${truncateLine(
      options.verificationError,
      120,
    )}`;
  }

  return "";
}

function normalizeHttpStatus(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 100 || number > 599) {
    return null;
  }
  return number;
}

function truncateLine(value, maxLength) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function trimFinalNewline(value) {
  return String(value).replace(/\n$/, "");
}

function buildFailureReport(values) {
  return renderTemplate(TEMPLATES.failure, {
    stageLabel: values.stageLabel,
    reason: values.reason,
    action: values.action,
    projectIdLine: values.projectIdLine,
    taskIdLine: values.taskIdLine,
    timeCostBlock: renderTimeCostBlock(values),
    debugLogsBlock: values.debugLogsBlock || "",
  });
}

function renderDebugLogsBlock(claudeLogPaths) {
  if (!claudeLogPaths || typeof claudeLogPaths !== "object") return "";
  const projectLogDir =
    typeof claudeLogPaths.projectLogDir === "string"
      ? claudeLogPaths.projectLogDir
      : "";
  if (!projectLogDir) return "";
  const files = Array.isArray(claudeLogPaths.jsonlFiles)
    ? claudeLogPaths.jsonlFiles.filter(
        (item) => typeof item === "string" && item.length > 0,
      )
    : [];
  const sessions = files.length === 0 ? "(none)" : formatSessionList(files);
  return renderTemplate(TEMPLATES.debugLogs, {
    projectLogDir,
    sessions,
  });
}

function formatSessionList(files) {
  const indent = "                ";
  return files.join(`\n${indent}`);
}

function renderTimeCostBlock(values) {
  const rows = [];
  rows.push(renderTimeCostRow("Local Prep", values.local));
  rows.push(renderTimeCostRow("Remote Deploy", values.remote));
  if (values.poll != null) {
    rows.push(renderTimeCostRow("Status Polling", values.poll));
  }

  return renderTemplate(TEMPLATES.timeCost, {
    rows: rows.join(""),
    totalRow: renderTimeCostRow("Total", values.total),
  });
}

function renderTimeCostRow(label, value) {
  return renderTemplate(TEMPLATES.timeCostRow, {
    label: String(label).padEnd(LEFT_CELL_WIDTH),
    value: String(value).padEnd(RIGHT_CELL_WIDTH),
  });
}

function mapStageLabel(stage) {
  const localPrepStages = [
    "preflight",
    "analyze",
    "validateBuild",
    "renderDockerfiles",
  ];
  const remoteDeployStages = [
    "packageProject",
    "controllerDeploy",
    "initUpload",
    "upload",
    "createTask",
    "recordDeployment",
    "pollTask",
    "verifyAccessUrl",
  ];

  if (localPrepStages.includes(stage)) return "Local Prep";
  if (remoteDeployStages.includes(stage)) return "Remote Deploy";
  throw new Error(`Unknown report stage: ${stage}`);
}

module.exports = {
  runFormatArbitraryDeployReport,
};
