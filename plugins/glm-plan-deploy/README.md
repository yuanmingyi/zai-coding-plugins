# GLM Plan Quick Deployment

Quick deploy for GLM Coding Plan users.

Attention:

- This plugin is designed to work specifically with the GLM Coding Plan in Claude Code.
- This plugin requires Node.js to be installed in your environment.

## How to use

In Claude Code, run:
```
/glm-plan-deploy:deploy-arbitrary
```
to deploy projects with arbitrary languages and tech stacks using Docker containerization,
```
/glm-plan-deploy:status
```
to check the result of the last deployment

## Command overview

### /deploy-arbitrary

Deploy projects of any programming language or framework by creating Docker-based deployments.

In the command forms below, `PLUGIN_ROOT` is the absolute path to the installed plugin directory. The command turn captures it from `$CLAUDE_PLUGIN_ROOT` (the env var Claude Code injects for every tool call) and forwards it to the subagent — there is no requirement that the deployed project be a checkout of the plugin source repo.

**Execution flow:**
1. Command `/deploy-arbitrary` captures `PLUGIN_ROOT` from `$CLAUDE_PLUGIN_ROOT` and forwards it to `@deploy-arbitrary` together with the target project path
2. The agent runs `node "${PLUGIN_ROOT}/scripts/plugin-cli.js" deploy-arbitrary --json --cwd "${TARGET_PROJECT_DIR}" [--path "<entry-path>"]` to resolve auth, retry budget, upload limit, runtime/build/start/output settings, local build validation, Docker artifact generation, package assembly, upload, task creation, polling, access URL verification, embedded retry classification, and final report formatting in one deterministic helper flow
3. If `deploy-arbitrary` returns `needsUserInput: true`, the agent asks once, applies a concrete fix or override, and reruns the same helper with the corresponding override flag instead of manually chaining the lower-level scripts
4. On terminal outcomes, `deploy-arbitrary` returns `finalReport`, and the agent relays exactly that string as the final user-facing report without wrapping or extra commentary
5. Lower-level helper modules are internal to `deploy-arbitrary`; the plugin CLI exposes the consolidated helper instead of split deployment steps

The final `Time Cost` table reports Local Prep, Remote Deploy, Status Polling (when polling time is available), and Total wall-clock seconds anchored to the helper's start.

You can pass an optional path argument to `/deploy-arbitrary`. Directory paths
select the deployed service root. For raw static folders, an HTML file path is
used as the runtime `index.html` even when the source file is named
`landing.html`, `home.html`, or similar.

**Important constraint:** Deployment-task retries must stay within `config.retryTimes` from `/client/tcb/status`, and are allowed only when the previous task failed due to Dockerfile/packaging/runtime-containerization issues the agent can fix.

**Supported languages:** Python, Node.js, Go, Java, Ruby, PHP, Rust, C/C++, and any other language that can run in a Linux Docker container.

### /status

Query the result of the last deployment of current project.

**Execution flow:**
1. Command `/status` invokes `@status-skill`
2. The skill checks the Node.js environment and executes the nodejs script with the appropriate method
3. The skill returns either the successful response or the failure reason

**Important constraint:** Run the query exactly once and return immediately whether it succeeds or fails.

## Verification

Run the maintained deploy-script suite with:

```bash
cd plugins/glm-plan-deploy/scripts
npm run test:deploy
```

This scoped command covers the active `common`, `lifecycle`, `standard`, and `arbitrary` modules. Some older legacy tests in `scripts/__tests__` still target removed handler modules and are intentionally excluded from the deploy-script verification path.

To run the full deploy-arbitrary agent through Claude Code headless mode and score the resulting process transcript:

```bash
cd plugins/glm-plan-deploy/scripts
npm run test:agent-headless -- \
  --project-dir "$(pwd)/../tests/python-flask" \
  --repo-root "$(cd ../../.. && pwd)" \
  --session-cwd "$(pwd)/../tests/python-flask"
```

The headless runner inspects the generated Claude `.jsonl` file, verifies the deployment result, flags unexpected attempts such as split-helper retries, prompt-level diagnostics, local Docker builds, or tool calls after a terminal final report, and requires a 90+ process score by default. The score is capped by the percentage of compliant tool actions, so unexpected attempts directly reduce the pass/fail gate.
