"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLog = getLog;
const service_1 = require("./src/service");
const utils_1 = require("./src/utils");
async function getLog() {
  try {
    // 1. find or create .deploy/settings.json, if package.json is not found, return error
    const { deploySettings } = await (0, utils_1.loadDeploySettings)();
    deploySettings.projectId;
    if (
      !deploySettings.projectId ||
      (deploySettings.deployments && deploySettings.deployments.length === 0)
    ) {
      return {
        success: false,
        error: "Project ID not found in deploy settings. Please deploy first.",
      };
    }
    return await (0, service_1.getDeployLog)(
      deploySettings.projectId,
      deploySettings.deployments[0].deployId,
    );
  } catch (error) {
    return (0, utils_1.handleUncaughtError)(error);
  }
}
//# sourceMappingURL=getLog.js.map
