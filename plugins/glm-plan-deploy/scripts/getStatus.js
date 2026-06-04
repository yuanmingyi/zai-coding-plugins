"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatus = getStatus;
const service_1 = require("./src/service");
const utils_1 = require("./src/utils");
async function getStatus() {
  try {
    // 1. find or create ${ZAI_EO_SETTINGS_PATH} (default .zai/deploy/settings.json), if not found, return error
    const { deploySettings } = await (0, utils_1.loadDeploySettings)();
    if (
      !deploySettings.projectId ||
      (deploySettings.deployments && deploySettings.deployments.length === 0)
    ) {
      return {
        success: false,
        message: "Project ID not found. Please deploy first.",
      };
    }
    if (deploySettings.area) {
      console.info("Area: ", deploySettings.area);
    }
    try {
      const status = await (0, service_1.getDeployStatus)(
        deploySettings.projectId,
        deploySettings.deployments[0].deployId,
      );
      return {
        success: true,
        status: status.status,
        url:
          status.status === "Success" ? status.result?.previewUrl : undefined,
        message: status.result?.message || "",
        log: status.result?.deployLog,
        audit: status.result?.auditDetail,
      };
    } catch (err) {
      if ((0, utils_1.isInvalidProjectIdError)(err)) {
        // reset deploy settings
        (0, utils_1.resetDeploySettings)(deploySettings);
        // save deploy settings
        await (0, utils_1.updateDeploySettings)(deploySettings);
      }
      return (0, utils_1.handleUncaughtError)(err);
    }
  } catch (error) {
    return (0, utils_1.handleUncaughtError)(error);
  }
}
//# sourceMappingURL=getStatus.js.map
