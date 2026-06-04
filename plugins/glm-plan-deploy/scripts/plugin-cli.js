"use strict";

const { runArbitraryAnalyze } = require("./arbitrary/analyze");
const { runArbitraryClassifyFailure } = require("./arbitrary/classifyFailure");
const {
  runArbitraryControllerDeploy,
} = require("./arbitrary/controllerDeploy");
const {
  runArbitraryDatabaseStatus,
  runArbitraryDatabaseSync,
} = require("./arbitrary/databaseMigrations");
const { runArbitraryDeploy } = require("./arbitrary/deploy");
const {
  runArbitraryExecuteRemoteDeploy,
} = require("./arbitrary/executeRemoteDeploy");
const {
  runFormatArbitraryDeployReport,
} = require("./arbitrary/formatDeployReport");
const { runArbitraryPrepareLocal } = require("./arbitrary/prepareLocal");
const { runArbitraryPreflight } = require("./arbitrary/preflight");
const { runArbitraryPollTask } = require("./arbitrary/pollTask");
const { runArbitraryPackageProject } = require("./arbitrary/packageProject");
const {
  runRenderArbitraryDockerfiles,
} = require("./arbitrary/renderDockerfiles");
const { runArbitraryValidateBuild } = require("./arbitrary/validateBuild");
const { runArbitraryVerifyAccessUrl } = require("./arbitrary/verifyAccessUrl");
const {
  runRecordArbitraryDeployment,
} = require("./arbitrary/recordDeployment");
const {
  previewDeleteProject,
  runDeleteProject,
} = require("./lifecycle/deleteProject");
const { runDestroy } = require("./lifecycle/destroy");
const { runInit } = require("./lifecycle/init");
const { runStatusArbitrary } = require("./lifecycle/statusArbitrary");
const { inspectProject } = require("./standard/inspectProject");
const { runDeployStaticWebsiteCli } = require("./deploy-static-website");

async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const jsonOutput = args.includes("--json");
  const command = args.shift();
  const filteredArgs = args.filter((item) => item !== "--json");

  let result;
  switch (command) {
    case "analyze-arbitrary":
      result = await runArbitraryAnalyze({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        path: readFlagValue(filteredArgs, "--path"),
      });
      break;
    case "classify-failure-arbitrary":
      result = await runArbitraryClassifyFailure({
        errorMessage: readFlagValue(filteredArgs, "--errorMessage"),
        stepMessage: readFlagValue(filteredArgs, "--stepMessage"),
        detailLog: readFlagValue(filteredArgs, "--detailLog"),
        verificationBody: readFlagValue(filteredArgs, "--verificationBody"),
      });
      break;
    case "controller-deploy-arbitrary":
      result = await runArbitraryControllerDeploy({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        packageDir: readFlagValue(filteredArgs, "--packageDir"),
        uploadSizeLimit: readFlagValue(filteredArgs, "--uploadSizeLimit"),
        appName: readFlagValue(filteredArgs, "--appName"),
        databaseBindings: readJsonFlagValue(
          filteredArgs,
          "--databaseBindingsJson",
        ),
      });
      break;
    case "deploy-arbitrary":
      result = await runArbitraryDeploy({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        path: readFlagValue(filteredArgs, "--path"),
        language: readFlagValue(filteredArgs, "--language"),
        version: readFlagValue(filteredArgs, "--version"),
        serviceRoot: readFlagValue(filteredArgs, "--serviceRoot"),
        buildCommand: readFlagValue(filteredArgs, "--buildCommand"),
        output: readFlagValue(filteredArgs, "--output"),
        startCommand: readFlagValue(filteredArgs, "--startCommand"),
        runtimeKind: readFlagValue(filteredArgs, "--runtimeKind"),
        framework: readFlagValue(filteredArgs, "--framework"),
        staticIndexFile: readFlagValue(filteredArgs, "--staticIndexFile"),
        databaseMode: readFlagValue(filteredArgs, "--databaseMode"),
        databaseType: readFlagValue(filteredArgs, "--databaseType"),
        databaseSync: readFlagValue(filteredArgs, "--databaseSync"),
        databaseSyncConfirm: filteredArgs.includes("--databaseSyncConfirm"),
        databaseBindingId: readFlagValue(filteredArgs, "--databaseBindingId"),
        databaseFramework: readFlagValue(filteredArgs, "--databaseFramework"),
        databaseMigrationCommand: readFlagValue(
          filteredArgs,
          "--databaseMigrationCommand",
        ),
        agentWorkDir: readFlagValue(filteredArgs, "--agentWorkDir"),
        appName: readFlagValue(filteredArgs, "--appName"),
        pollIntervalMs: readFlagValue(filteredArgs, "--pollIntervalMs"),
      });
      break;
    case "deploy-static-website":
      result = (await runDeployStaticWebsiteCli(filteredArgs)).result;
      break;
    case "db-status-arbitrary":
      result = await runArbitraryDatabaseStatus({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        appName: readFlagValue(filteredArgs, "--appName"),
        projectId: readFlagValue(filteredArgs, "--projectId"),
        bindingId: readFlagValue(filteredArgs, "--bindingId"),
        framework: readFlagValue(filteredArgs, "--framework"),
        migrationCommand: readFlagValue(filteredArgs, "--migrationCommand"),
        agentWorkDir: readFlagValue(filteredArgs, "--agentWorkDir"),
      });
      break;
    case "db-sync-arbitrary":
      result = await runArbitraryDatabaseSync({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        appName: readFlagValue(filteredArgs, "--appName"),
        projectId: readFlagValue(filteredArgs, "--projectId"),
        bindingId: readFlagValue(filteredArgs, "--bindingId"),
        framework: readFlagValue(filteredArgs, "--framework"),
        migrationCommand: readFlagValue(filteredArgs, "--migrationCommand"),
        agentWorkDir: readFlagValue(filteredArgs, "--agentWorkDir"),
        confirm: filteredArgs.includes("--confirm"),
      });
      break;
    case "remote-deploy-arbitrary":
      result = await runArbitraryExecuteRemoteDeploy({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        agentWorkDir: readFlagValue(filteredArgs, "--agentWorkDir"),
        serviceRoot: readFlagValue(filteredArgs, "--serviceRoot"),
        uploadSizeLimit: readFlagValue(filteredArgs, "--uploadSizeLimit"),
        timeoutSeconds: readFlagValue(filteredArgs, "--timeoutSeconds"),
        appName: readFlagValue(filteredArgs, "--appName"),
        localElapsedSeconds: readFlagValue(filteredArgs, "--localSeconds"),
        databaseBindings: readJsonFlagValue(
          filteredArgs,
          "--databaseBindingsJson",
        ),
      });
      break;
    case "format-deploy-arbitrary-report":
      result = await runFormatArbitraryDeployReport({
        outcome: readFlagValue(filteredArgs, "--outcome"),
        accessUrl: readFlagValue(filteredArgs, "--accessUrl"),
        stage: readFlagValue(filteredArgs, "--stage"),
        reason: readFlagValue(filteredArgs, "--reason"),
        action: readFlagValue(filteredArgs, "--action"),
        failedStatus: readFlagValue(filteredArgs, "--failedStatus"),
        currentStep: readFlagValue(filteredArgs, "--currentStep"),
        stepMessage: readFlagValue(filteredArgs, "--stepMessage"),
        localSeconds: readFlagValue(filteredArgs, "--localSeconds"),
        remoteSeconds: readFlagValue(filteredArgs, "--remoteSeconds"),
        pollSeconds: readFlagValue(filteredArgs, "--pollSeconds"),
        totalSeconds: readFlagValue(filteredArgs, "--totalSeconds"),
        expectedAccessDenied: filteredArgs.includes("--expectedAccessDenied"),
        verificationStatus: readFlagValue(filteredArgs, "--verificationStatus"),
      });
      break;
    case "poll-arbitrary-task":
      result = await runArbitraryPollTask({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        taskId: readFlagValue(filteredArgs, "--taskId"),
        timeoutSeconds: readFlagValue(filteredArgs, "--timeoutSeconds"),
        pollIntervalMs: readFlagValue(filteredArgs, "--pollIntervalMs"),
      });
      break;
    case "record-arbitrary-deployment":
      result = await runRecordArbitraryDeployment({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        taskId: readFlagValue(filteredArgs, "--taskId"),
        projectId: readFlagValue(filteredArgs, "--projectId"),
        area: readFlagValue(filteredArgs, "--area"),
      });
      break;
    case "preflight-arbitrary":
      result = await runArbitraryPreflight({
        cwd: readFlagValue(filteredArgs, "--cwd"),
      });
      break;
    case "prepare-local-arbitrary":
      result = await runArbitraryPrepareLocal({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        path: readFlagValue(filteredArgs, "--path"),
        language: readFlagValue(filteredArgs, "--language"),
        version: readFlagValue(filteredArgs, "--version"),
        serviceRoot: readFlagValue(filteredArgs, "--serviceRoot"),
        buildCommand: readFlagValue(filteredArgs, "--buildCommand"),
        output: readFlagValue(filteredArgs, "--output"),
        startCommand: readFlagValue(filteredArgs, "--startCommand"),
        runtimeKind: readFlagValue(filteredArgs, "--runtimeKind"),
        framework: readFlagValue(filteredArgs, "--framework"),
        staticIndexFile: readFlagValue(filteredArgs, "--staticIndexFile"),
        databaseMode: readFlagValue(filteredArgs, "--databaseMode"),
        databaseType: readFlagValue(filteredArgs, "--databaseType"),
        agentWorkDir: readFlagValue(filteredArgs, "--agentWorkDir"),
      });
      break;
    case "validate-build-arbitrary":
      result = await runArbitraryValidateBuild({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        buildCommand: readFlagValue(filteredArgs, "--buildCommand"),
      });
      break;
    case "verify-access-url-arbitrary":
      result = await runArbitraryVerifyAccessUrl({
        accessUrl: readFlagValue(filteredArgs, "--accessUrl"),
        accessControl: readJsonFlagValue(filteredArgs, "--accessControlJson"),
      });
      break;
    case "render-dockerfiles-arbitrary":
      result = await runRenderArbitraryDockerfiles({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        agentWorkDir: readFlagValue(filteredArgs, "--agentWorkDir"),
        language: readFlagValue(filteredArgs, "--language"),
        version: readFlagValue(filteredArgs, "--version"),
        serviceRoot: readFlagValue(filteredArgs, "--serviceRoot"),
        buildCommand: readFlagValue(filteredArgs, "--buildCommand"),
        output: readFlagValue(filteredArgs, "--output"),
        startCommand: readFlagValue(filteredArgs, "--startCommand"),
        runtimeKind: readFlagValue(filteredArgs, "--runtimeKind"),
        framework: readFlagValue(filteredArgs, "--framework"),
        staticIndexFile: readFlagValue(filteredArgs, "--staticIndexFile"),
      });
      break;
    case "package-project-arbitrary":
      result = await runArbitraryPackageProject({
        cwd: readFlagValue(filteredArgs, "--cwd"),
        agentWorkDir: readFlagValue(filteredArgs, "--agentWorkDir"),
        serviceRoot: readFlagValue(filteredArgs, "--serviceRoot"),
      });
      break;
    case "init":
      result = await runInit();
      break;
    case "destroy":
      result = await runDestroy();
      break;
    case "delete-project":
      if (filteredArgs.includes("--preview")) {
        result = await previewDeleteProject({
          projectId: readFlagValue(filteredArgs, "--projectId"),
        });
      } else {
        result = await runDeleteProject({
          projectId: readFlagValue(filteredArgs, "--projectId"),
          projectName: readFlagValue(filteredArgs, "--projectName"),
        });
      }
      break;
    case "status-arbitrary":
      result = await runStatusArbitrary();
      break;
    case "detect-standard":
      result = await inspectProject(process.cwd());
      break;
    default:
      result = {
        success: false,
        message:
          "Usage: node plugin-cli.js <analyze-arbitrary|classify-failure-arbitrary|controller-deploy-arbitrary|deploy-arbitrary|deploy-static-website|db-status-arbitrary|db-sync-arbitrary|remote-deploy-arbitrary|format-deploy-arbitrary-report|poll-arbitrary-task|record-arbitrary-deployment|preflight-arbitrary|prepare-local-arbitrary|validate-build-arbitrary|verify-access-url-arbitrary|render-dockerfiles-arbitrary|package-project-arbitrary|init|destroy|delete-project|status-arbitrary|detect-standard> [--json]",
        summary:
          "Usage: node plugin-cli.js <analyze-arbitrary|classify-failure-arbitrary|controller-deploy-arbitrary|deploy-arbitrary|deploy-static-website|db-status-arbitrary|db-sync-arbitrary|remote-deploy-arbitrary|format-deploy-arbitrary-report|poll-arbitrary-task|record-arbitrary-deployment|preflight-arbitrary|prepare-local-arbitrary|validate-build-arbitrary|verify-access-url-arbitrary|render-dockerfiles-arbitrary|package-project-arbitrary|init|destroy|delete-project|status-arbitrary|detect-standard> [--json]",
      };
      break;
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`${result.summary || result.message}\n`);
  }

  if (!result.success) {
    process.exitCode = 1;
  }
}

function readFlagValue(args, flagName) {
  const index = args.indexOf(flagName);
  if (index === -1 || index === args.length - 1) {
    return null;
  }

  return args[index + 1];
}

function readJsonFlagValue(args, flagName) {
  const raw = readFlagValue(args, flagName);
  if (raw == null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON for ${flagName}: ${error.message}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
};
