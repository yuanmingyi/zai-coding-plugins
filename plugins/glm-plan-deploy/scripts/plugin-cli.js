"use strict";

const {
  runArbitraryDatabaseStatus,
  runArbitraryDatabaseSync,
} = require("./arbitrary/databaseMigrations");
const { runArbitraryDeploy } = require("./arbitrary/deploy");
const {
  previewDeleteProject,
  runDeleteProject,
} = require("./lifecycle/deleteProject");
const { runStatusArbitrary } = require("./lifecycle/statusArbitrary");
const { runDeployStaticWebsiteCli } = require("./deploy-static-website");

async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const jsonOutput = args.includes("--json");
  const command = args.shift();
  const filteredArgs = args.filter((item) => item !== "--json");

  let result;
  switch (command) {
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
    default:
      result = {
        success: false,
        message:
          "Usage: node plugin-cli.js <deploy-arbitrary|deploy-static-website|db-status-arbitrary|db-sync-arbitrary|delete-project|status-arbitrary> [--json]",
        summary:
          "Usage: node plugin-cli.js <deploy-arbitrary|deploy-static-website|db-status-arbitrary|db-sync-arbitrary|delete-project|status-arbitrary> [--json]",
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

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
};
