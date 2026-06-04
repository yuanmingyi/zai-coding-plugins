"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const init_1 = require("./src/init");
const log_1 = require("./src/log");
const deploy_1 = require("./deploy");
const getLog_1 = require("./getLog");
const getNodeVersions_1 = require("./getNodeVersions");
const getStatus_1 = require("./getStatus");
const zip_1 = require("./zip");
/**
 * Main entry point that routes to the appropriate function based on command
 * Usage: node index.ts <command> [args...]
 * Commands:
 *   deploy [json]   - Deploy the project
 *   status          - Get deployment status
 *   log             - Get deployment log
 *   node            - Get available Node.js versions
 *   zip <target> <outdir> - Zip files
 */
async function main() {
  const command = init_1.args[0];
  (0, log_1.overrideConsole)(["LOG", "DEBUG"]);
  try {
    switch (command) {
      case "deploy": {
        const extraParams = JSON.parse(init_1.args[1] || "{}");
        const result = await (0, deploy_1.deploy)(
          `${init_1.programDir}/.ignore`,
          extraParams,
        );
        if (result.projectId) {
          console.info("📍 ProjectId:", result.projectId);
        }
        if (result.deployId) {
          console.info("📍 DeployId:", result.deployId);
        }
        if (result.status) {
          console.info("📍 Status:", result.status);
        }
        if (result.success) {
          console.info("✅", result.message);
          if (result.url) {
            console.info("📍 URL:", result.url);
          }
        } else {
          console.error("❌", result.message);
          if (result.log) {
            console.error("📍 Deploy log:", result.log);
          }
          if (result.audit) {
            console.error("📍 Audit result:", result.audit);
          }
          process.exit(1);
        }
        break;
      }
      case "status": {
        const result = await (0, getStatus_1.getStatus)();
        if (result.status) {
          console.info("📍 Status:", result.status);
        }
        if (result.success) {
          console.info("✅ Get status successful!");
          if (result.url) {
            console.info("📍 URL:", result.url);
          }
          console.info("📍 Message:", result.message);
        } else {
          console.error("❌ Get status failed:", result.message);
          if (result.log) {
            console.error("📍 Deploy log:", result.log);
          }
          if (result.audit) {
            console.error("📍 Audit result:", result.audit);
          }
          process.exit(1);
        }
        break;
      }
      case "log": {
        const result = await (0, getLog_1.getLog)();
        if (result) {
          console.info("📍 Deploy log:", result);
        } else {
          console.error("❌ No deploy log found!");
          process.exit(1);
        }
        break;
      }
      case "node": {
        const result = await (0, getNodeVersions_1.getNodeVersions)();
        console.info(result);
        break;
      }
      case "zip": {
        if (init_1.args.length < 2) {
          console.info("Usage: node index.ts zip <targetfile> [outdir]");
          process.exit(1);
        }
        const targetPath = init_1.args[1];
        const outDir = init_1.args?.[2];
        const result = await (0, zip_1.zip)(
          targetPath,
          `${init_1.programDir}/.ignore`,
          outDir,
        );
        if (result.success) {
          console.info("✅ Zip successful!");
          console.info("📍 Status:", result.status);
        } else {
          console.error("❌ Zip failed:", result.message);
          process.exit(1);
        }
        break;
      }
      default:
        console.info("Usage: node index.ts <command> [args...]");
        console.info("");
        console.info("Commands:");
        console.info("  deploy [params]    - Deploy the project");
        console.info("  status          - Get deployment status");
        console.info("  log             - Get deployment log");
        console.info("  node            - Get available Node.js versions");
        console.info("  zip <target> [outdir] - Zip files");
        break;
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    (0, log_1.restoreConsole)();
  }
}
main();
//# sourceMappingURL=index.js.map
