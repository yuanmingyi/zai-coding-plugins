"use strict";

function bulletLines(lines) {
  return lines.filter(Boolean).join("\n");
}

function formatInitResult(result) {
  if (!result.success) {
    return result.summary || result.message;
  }

  return bulletLines([
    "✅ **Deployment environment initialized**",
    "- Environment is ready for deployments",
    "- Next step: run `/glm-plan-deploy:deploy-arbitrary`",
  ]);
}

function formatDestroyResult(result) {
  if (!result.success) {
    return result.summary || result.message;
  }

  return bulletLines([
    "⚠️ **Deployment environment destroyed**",
    "- All projects have been permanently deleted",
    "- This action is NOT recoverable",
  ]);
}

function formatDeleteProjectResult(result) {
  if (!result.success) {
    return result.summary || result.message;
  }

  const lines = ["✅ **Project deleted**", `- Project: ${result.projectName}`];

  if (result.cleanupWarning) {
    lines.push(`- Warning: ${result.cleanupWarning}`);
  } else if (result.localCleanupApplied) {
    lines.push("- Local settings have been cleaned up");
  }

  return bulletLines(lines);
}

function formatArbitraryStatusResult(result) {
  if (!result.success) {
    return result.summary || result.message;
  }

  if (result.noDeployment) {
    return bulletLines([
      "ℹ️ **No arbitrary deployment found**",
      "- No deployment record was found in the current directory.",
    ]);
  }

  const lines = [
    "📦 **Arbitrary Deploy Status**",
    `- Status: ${result.status}`,
  ];

  if (result.currentStep) {
    lines.push(`- Current step: ${result.currentStep}`);
  }

  if (result.stepMessage) {
    lines.push(`- Detail: ${result.stepMessage}`);
  }

  if (result.accessUrl) {
    lines.push(`- Access URL: ${result.accessUrl}`);
  }

  if (result.errorMessage) {
    lines.push(`- Error: ${result.errorMessage}`);
  }

  return bulletLines(lines);
}

function formatArbitraryPreflightResult(result) {
  if (!result.success) {
    return result.summary || result.message;
  }

  return bulletLines([
    "✅ **Pre-flight checks passed**",
    result.projectId
      ? `- Project ID: ${result.projectId}`
      : "- Project ID: new project",
    result.envStatus ? `- Env status: ${result.envStatus}` : null,
    `- Timeout: ${result.timeoutSeconds}s`,
    `- Retry budget: ${result.maxRetries}`,
    `- Upload size limit: ${result.uploadSizeLimit} bytes`,
    result.firstDeployNotice ? `- ${result.firstDeployNotice}` : null,
  ]);
}

function formatArbitraryAnalyzeResult(result) {
  if (!result.success) {
    return result.summary || result.message;
  }

  if (result.needsUserInput) {
    return result.message;
  }

  return bulletLines([
    "**Detected Configuration:**",
    `- Language: ${result.detectedConfig.language} ${result.detectedConfig.version}`,
    `- Build: \`${result.detectedConfig.buildCommand}\``,
    `- Output: \`${result.detectedConfig.output}\``,
    result.detectedConfig.runtimeKind === "static"
      ? "- Runtime: static nginx"
      : `- Start: \`${result.detectedConfig.startCommand}\``,
    result.detectedConfig.database
      ? `- Database: ${formatDatabaseSummary(result.detectedConfig.database)}`
      : null,
    "",
    "Proceeding with detected settings...",
  ]);
}

function formatDatabaseSummary(database) {
  const parts = [database.type || "unknown"];
  if (database.orm) {
    parts.push(database.orm);
  }
  if (database.requiredEnv && database.requiredEnv.length) {
    parts.push(`env ${database.requiredEnv.join(", ")}`);
  }
  return parts.join(" / ");
}

function formatArbitraryBuildValidationResult(result) {
  if (!result.success) {
    return result.summary || result.message;
  }

  if (result.skipped) {
    return bulletLines([
      "⏭️ **Local build validation skipped**",
      `- Command (not run): \`${result.buildCommand}\``,
      `- Reason: ${result.skipReason}`,
      "- Proceeding to Dockerfile generation; the remote container build is the source of truth.",
    ]);
  }

  if (!result.buildSucceeded) {
    return bulletLines([
      "❌ **Local build validation failed**",
      `- Command: \`${result.buildCommand}\``,
      result.exitCode != null ? `- Exit code: ${result.exitCode}` : null,
      result.recovery
        ? `- Auto-recovery via \`${result.recovery.command}\`: ${describeRecoveryOutcome(result.recovery)}.`
        : null,
      "- Review the captured stdout/stderr before retrying.",
    ]);
  }

  return bulletLines([
    "✅ **Local build validation passed**",
    `- Command: \`${result.buildCommand}\``,
    result.recovery && result.recovery.succeeded
      ? "- Note: auto-recovered from an unsatisfiable `Cargo.lock` by running `cargo update`; the regenerated lock file is written to the project."
      : null,
    "- Proceeding to Dockerfile generation.",
  ]);
}

function describeRecoveryOutcome(recovery) {
  if (!recovery.retried) return "command itself failed";
  if (recovery.succeeded) return "succeeded";
  return "ran, but the retried build still failed";
}

module.exports = {
  formatArbitraryAnalyzeResult,
  formatArbitraryBuildValidationResult,
  formatArbitraryPreflightResult,
  formatArbitraryStatusResult,
  formatDeleteProjectResult,
  formatDestroyResult,
  formatInitResult,
};
