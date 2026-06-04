"use strict";

// Tool names that, when reported as `not found`, indicate the build image
// is missing a build-time tool (NOT a runtime dependency). Order matters
// for the captured-name in the regex: list the longest names first so
// `pipenv` doesn't get swallowed by a generic `pip` match.
const BUILD_TOOL_NAMES = [
  "pnpm",
  "yarn",
  "corepack",
  "python3",
  "poetry",
  "pipenv",
  "cargo",
  "mvn",
  "gradle",
];
// Matches lines like:
//   /bin/sh: 1: pnpm: not found
//   sh: yarn: command not found
//   bash: poetry: command not found
const MISSING_BUILD_TOOL_PATTERN = new RegExp(
  `\\b(${BUILD_TOOL_NAMES.join("|")}):?\\s+(?:command\\s+)?not found`,
  "i",
);

function buildMissingToolSuggestedFix(tool) {
  return [
    `Build tool \`${tool}\` is not present in the build image. `,
    `Re-render Dockerfile.build so it installs the tool before the build step `,
    `(for Node.js, the scripted renderer now emits `,
    `\`RUN npm install --global ${tool}@<version>\` automatically when `,
    `packageManager / lockfile signals are detected). Do NOT hand-patch the `,
    `generated Dockerfile — the renderer overwrites it on the next deploy. `,
    `File a plugin issue if the detector missed the project signal.`,
  ].join("");
}

const CLASSIFIERS = [
  {
    category: "REMOTE_FUNCTION_CREATING",
    retryable: false,
    pattern:
      /FailedOperation\.UpdateFunctionCode|处于Creating状态|function (?:is )?(?:currently )?(?:in )?Creating state/i,
    suggestedFix:
      "Wait for the platform-side SCF function creation to finish, then rerun the deployment.",
  },
  {
    // Must come BEFORE the generic RUNTIME_DEPENDENCY_MISSING classifier
    // because that one matches the bare `command not found` substring.
    // Missing a BUILD tool is not retryable: the same Dockerfile would
    // re-execute and fail identically.
    category: "MISSING_BUILD_TOOL",
    retryable: false,
    pattern: MISSING_BUILD_TOOL_PATTERN,
    suggestedFix: null,
    captureTool: true,
  },
  {
    category: "BASE_IMAGE_PACKAGE_MANAGER_MISMATCH",
    retryable: true,
    pattern: /\bapk: not found\b|\bapt-get: not found\b/i,
    suggestedFix:
      "Align the base image family with the package manager command, then rerender the Dockerfiles.",
  },
  {
    category: "PACKAGE_MISSING_FILE",
    retryable: true,
    pattern:
      /COPY failed: file not found|ADD failed: file not found|missing path/i,
    suggestedFix:
      "Rebuild the deployment package with parity copying and validate Dockerfile COPY paths again.",
  },
  {
    category: "RUNTIME_DEPENDENCY_MISSING",
    retryable: true,
    pattern:
      /cannot find module|module not found|no module named|command not found/i,
    suggestedFix:
      "Ensure the runtime dependencies are installed or copied into the package before retrying.",
  },
  {
    category: "PORT_CONFIGURATION",
    retryable: true,
    pattern:
      /port 9000|accepting connections|listen .*9000|health check failed/i,
    suggestedFix:
      "Update the container startup flow so the app binds to the runtime PORT environment variable.",
  },
];

async function runArbitraryClassifyFailure(options = {}) {
  const evidence = [
    options.errorMessage,
    options.stepMessage,
    options.detailLog,
    options.verificationBody,
  ]
    .filter(Boolean)
    .join("\n");

  for (const classifier of CLASSIFIERS) {
    const match = evidence.match(classifier.pattern);
    if (!match) continue;
    let suggestedFix = classifier.suggestedFix;
    if (classifier.captureTool) {
      const tool = (match[1] || "").toLowerCase();
      suggestedFix = buildMissingToolSuggestedFix(tool);
    }
    return {
      success: true,
      retryable: classifier.retryable,
      category: classifier.category,
      suggestedFix,
      summary: `${classifier.category}: ${suggestedFix}`,
    };
  }

  return {
    success: true,
    retryable: false,
    category: "UNKNOWN_FAILURE",
    suggestedFix:
      "The failure is not in the scripted retry catalog. Inspect the logs and decide whether manual intervention is required.",
    summary:
      "UNKNOWN_FAILURE: The failure is not in the scripted retry catalog. Inspect the logs and decide whether manual intervention is required.",
  };
}

module.exports = {
  runArbitraryClassifyFailure,
};
