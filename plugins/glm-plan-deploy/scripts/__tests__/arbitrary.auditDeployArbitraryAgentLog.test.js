import { createRequire } from "module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { analyze } = require("../auditDeployArbitraryAgentLog.js");

function assistantBash(line, command) {
  return {
    __line: line,
    type: "progress",
    data: {
      message: {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command },
            },
          ],
        },
      },
    },
  };
}

function topLevelAssistantBash(line, command) {
  return {
    __line: line,
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Bash",
          input: { command },
        },
      ],
    },
  };
}

function userToolResult(line, content) {
  return {
    __line: line,
    type: "progress",
    data: {
      message: {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              content,
            },
          ],
        },
      },
    },
  };
}

function assistantRead(line, filePath) {
  return {
    __line: line,
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Read", input: { file_path: filePath } },
      ],
    },
  };
}

function assistantText(line, text) {
  return {
    __line: line,
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  };
}

function promptEntry(line, text) {
  return { __line: line, type: "user", prompt: text };
}

const SUCCESS_BANNER =
  "╔══════════════════════════════════════════════════════════════╗\n" +
  "║  [OK]   Deployment Completed Successfully                    ║\n" +
  "╚══════════════════════════════════════════════════════════════╝\n" +
  "  Access URL : https://demo.example.com";

function findCheck(report, id) {
  return report.checks.find((check) => check.id === id);
}

describe("auditDeployArbitraryAgentLog", () => {
  it("flags diagnostics, secret exposure, and retries after a terminal finalReport", () => {
    const entries = [
      assistantBash(
        1,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" remote-deploy-arbitrary --json --cwd "/app"',
      ),
      userToolResult(
        2,
        JSON.stringify({
          success: false,
          stage: "initUpload",
          message: "fetch failed",
          classification: { retryable: false },
          finalReport: "Deployment Failed",
        }),
      ),
      topLevelAssistantBash(3, "env | grep TOKEN"),
      userToolResult(4, "ZAI_API_TOKEN=synthetic-token-value"),
      topLevelAssistantBash(
        5,
        'curl -H "Authorization: Bearer synthetic-token-value" https://example.invalid/client/tcb/initUpload',
      ),
      topLevelAssistantBash(
        6,
        'node -e "fetch(\\"https://example.invalid\\")"',
      ),
      topLevelAssistantBash(
        7,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/app"',
      ),
    ];

    const report = analyze("synthetic.jsonl", entries);

    expect(
      findCheck(report, "no_tools_after_terminal_final_report"),
    ).toMatchObject({
      status: "fail",
    });
    expect(findCheck(report, "no_terminal_final_report_retry")).toMatchObject({
      status: "fail",
    });
    expect(
      findCheck(report, "no_prompt_remote_diagnostics_after_terminal"),
    ).toMatchObject({
      status: "fail",
    });
    expect(findCheck(report, "no_secret_exposure")).toMatchObject({
      status: "fail",
    });
    expect(JSON.stringify(report)).not.toContain("synthetic-token-value");
  });

  it("passes terminal-result checks when the agent relays and stops", () => {
    const entries = [
      assistantBash(
        1,
        'node "/repo/plugins/glm-plan-deploy/scripts/plugin-cli.js" remote-deploy-arbitrary --json --cwd "/app"',
      ),
      userToolResult(
        2,
        JSON.stringify({
          success: false,
          stage: "initUpload",
          message: "fetch failed",
          classification: { retryable: false },
          finalReport: "Deployment Failed",
        }),
      ),
    ];

    const report = analyze("synthetic.jsonl", entries);

    expect(
      findCheck(report, "no_tools_after_terminal_final_report"),
    ).toMatchObject({
      status: "pass",
    });
    expect(findCheck(report, "no_terminal_final_report_retry")).toMatchObject({
      status: "pass",
    });
    expect(
      findCheck(report, "no_prompt_remote_diagnostics_after_terminal"),
    ).toMatchObject({
      status: "pass",
    });
    expect(findCheck(report, "no_secret_exposure")).toMatchObject({
      status: "pass",
    });
  });

  it("scores a compliant consolidated one-call deploy >= 70 with the new checks passing", () => {
    const entries = [
      promptEntry(
        1,
        "Deploy the project located at /abs/project. PLUGIN_ROOT=/cache/glm-plan-deploy",
      ),
      assistantBash(
        2,
        'node "${PLUGIN_ROOT}/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "/abs/project"',
      ),
      userToolResult(
        3,
        JSON.stringify({
          success: true,
          stage: "completed",
          accessUrl: "https://demo.example.com",
          detectedConfig: { language: "Python", framework: "flask" },
          finalReport: SUCCESS_BANNER,
        }),
      ),
      assistantText(4, SUCCESS_BANNER),
    ];

    const report = analyze("synthetic.jsonl", entries);

    expect(findCheck(report, "consolidated_helper_invoked")).toMatchObject({
      status: "pass",
    });
    expect(findCheck(report, "helper_required_flags")).toMatchObject({
      status: "pass",
    });
    expect(findCheck(report, "plugin_root_resolution")).toMatchObject({
      status: "pass",
    });
    expect(findCheck(report, "final_report_relayed_verbatim")).toMatchObject({
      status: "pass",
    });
    expect(findCheck(report, "no_manual_subhelper_chaining")).toMatchObject({
      status: "pass",
    });
    // Removed legacy checks must no longer exist.
    expect(findCheck(report, "local_build_validation")).toBeUndefined();
    expect(findCheck(report, "build_script_copy")).toBeUndefined();
    expect(findCheck(report, "post_deploy_verification")).toBeUndefined();
    expect(findCheck(report, "timing_anchored_before_helper")).toBeUndefined();
    expect(findCheck(report, "read_local_prep_before_action")).toBeUndefined();
    expect(report.score).toBeGreaterThanOrEqual(70);
  });

  it("fails the consolidated checks when the agent manually chains sub-helpers and never relays the report", () => {
    const entries = [
      promptEntry(1, "Deploy the project located at /abs/project."),
      assistantBash(
        2,
        'node "plugins/glm-plan-deploy/scripts/plugin-cli.js" prepare-local-arbitrary --cwd "/abs/project"',
      ),
      userToolResult(3, JSON.stringify({ success: true, stage: "completed" })),
      assistantBash(
        4,
        'node "plugins/glm-plan-deploy/scripts/plugin-cli.js" remote-deploy-arbitrary --cwd "/abs/project"',
      ),
      userToolResult(5, JSON.stringify({ success: true, stage: "completed" })),
      assistantBash(
        6,
        'node "plugins/glm-plan-deploy/scripts/plugin-cli.js" classify-failure-arbitrary --detailLog "failed"',
      ),
      assistantBash(
        7,
        'node "plugins/glm-plan-deploy/scripts/plugin-cli.js" format-deploy-arbitrary-report --outcome failed',
      ),
      assistantBash(
        8,
        'node "plugins/glm-plan-deploy/scripts/plugin-cli.js" record-arbitrary-deployment --taskId task-1',
      ),
    ];

    const report = analyze("synthetic.jsonl", entries);

    expect(findCheck(report, "consolidated_helper_invoked")).toMatchObject({
      status: "fail",
    });
    expect(findCheck(report, "no_manual_subhelper_chaining")).toMatchObject({
      status: "fail",
    });
    expect(
      findCheck(report, "no_manual_subhelper_chaining").evidence.map(
        (item) => item.command,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("classify-failure-arbitrary"),
        expect.stringContaining("format-deploy-arbitrary-report"),
        expect.stringContaining("record-arbitrary-deployment"),
      ]),
    );
    expect(findCheck(report, "final_report_relayed_verbatim")).toMatchObject({
      status: "n/a",
    });
    expect(report.score).toBeLessThan(70);
  });
});
