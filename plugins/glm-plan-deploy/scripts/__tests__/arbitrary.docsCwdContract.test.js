import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..", "..");

function readPluginFile(relativePath) {
  return fs.readFileSync(path.join(pluginRoot, relativePath), "utf8");
}

describe("deploy-arbitrary scripted contract docs", () => {
  it("invokes the consolidated helper with --json and absolute --cwd in agent + command + README", () => {
    const orchestrator = readPluginFile("agents/deploy-arbitrary.md");
    const commandDoc = readPluginFile("commands/deploy-arbitrary.md");
    const readme = readPluginFile("README.md");

    expect(orchestrator).toContain(
      'deploy-arbitrary --json \\\n  --cwd "${TARGET_PROJECT_DIR}"',
    );
    expect(commandDoc).toContain(
      "Plugin scripts are invoked via `${PLUGIN_ROOT}/scripts/...`",
    );
    expect(readme).toContain(
      'deploy-arbitrary --json --cwd "${TARGET_PROJECT_DIR}"',
    );
  });

  it("resolves plugin paths from $CLAUDE_PLUGIN_ROOT (no REPO_ROOT, no project-relative paths)", () => {
    const orchestrator = readPluginFile("agents/deploy-arbitrary.md");
    const commandDoc = readPluginFile("commands/deploy-arbitrary.md");
    const combined = [orchestrator, commandDoc].join("\n");

    expect(commandDoc).toContain("$CLAUDE_PLUGIN_ROOT");
    expect(combined).not.toContain("REPO_ROOT");
    expect(combined).not.toContain(
      "node plugins/glm-plan-deploy/scripts/plugin-cli.js",
    );
  });

  it("does not require the agent to capture or forward SESSION_STARTED_AT_MS / --agentStartedAtMs", () => {
    const orchestrator = readPluginFile("agents/deploy-arbitrary.md");
    const commandDoc = readPluginFile("commands/deploy-arbitrary.md");
    const combined = [orchestrator, commandDoc].join("\n");

    expect(combined).not.toContain("SESSION_STARTED_AT_MS");
    expect(combined).not.toContain("--agentStartedAtMs");
    expect(combined).not.toContain("AGENT_STARTED_AT_MS");
  });

  it("does not advertise previous-attempts forwarding or outside-script timing rows", () => {
    const orchestrator = readPluginFile("agents/deploy-arbitrary.md");
    const commandDoc = readPluginFile("commands/deploy-arbitrary.md");
    const combined = [orchestrator, commandDoc].join("\n");

    expect(combined).not.toContain("--previousAttempts");
    expect(combined).not.toContain("Outside Scripts");
    expect(combined).not.toContain("Previous Failed Attempts");
    expect(combined).not.toContain("LLM Reasoning");
    expect(combined).not.toContain("Tool Calling");
  });

  it("keeps the supporting-doc directory deleted; the agent prompt is self-contained", () => {
    const supportingDir = path.join(pluginRoot, "agents", "deploy-arbitrary");
    expect(fs.existsSync(supportingDir)).toBe(false);
  });

  it("keeps lifecycle command literals out of deploy-arbitrary prompts", () => {
    const deployPromptDocs = [
      "agents/deploy-arbitrary.md",
      "commands/deploy-arbitrary.md",
    ]
      .map(readPluginFile)
      .join("\n");
    const commandDoc = readPluginFile("commands/deploy-arbitrary.md");

    expect(deployPromptDocs).not.toMatch(
      /\/(?:glm-plan-deploy:)?(?:init|destroy)\b/,
    );
    expect(commandDoc).toContain(
      "Environment lifecycle operations are out of scope for this command",
    );
  });

  it("forbids plugin maintenance, repo test commands, and source edits during a deploy", () => {
    const orchestrator = readPluginFile("agents/deploy-arbitrary.md");

    expect(orchestrator).toContain(
      "Do not modify files under `${PLUGIN_ROOT}`",
    );
    expect(orchestrator).toContain("Do not modify user source");
    expect(orchestrator).toMatch(/Do not run `docker build`, `npm test`/);
    expect(orchestrator).toMatch(
      /Do not probe the remote API with `curl`, `node -e`/,
    );
  });

  it("describes only the consolidated helper command; sub-helpers are not advertised in the agent prompt", () => {
    const orchestrator = readPluginFile("agents/deploy-arbitrary.md");

    expect(orchestrator).not.toContain(
      "node ${PLUGIN_ROOT}/scripts/plugin-cli.js prepare-local-arbitrary",
    );
    expect(orchestrator).not.toContain(
      "node ${PLUGIN_ROOT}/scripts/plugin-cli.js remote-deploy-arbitrary",
    );
    expect(orchestrator).toContain("The lower-level helpers");
    expect(orchestrator).toContain("debug/fallback");
  });

  it("documents the three routing branches: success, needsUserInput, retryable failure", () => {
    const orchestrator = readPluginFile("agents/deploy-arbitrary.md");

    expect(orchestrator).toContain("needsUserInput");
    expect(orchestrator).toContain('stage: "analyze"');
    expect(orchestrator).toContain('stage: "validateBuild"');
    expect(orchestrator).toContain("classification.retryable === true");
    expect(orchestrator).toContain("finalReport");
  });
});
