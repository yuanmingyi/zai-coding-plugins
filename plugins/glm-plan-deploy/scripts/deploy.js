"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deploy = deploy;
const path_1 = require("path");
const filterFiles_1 = require("./src/filterFiles");
const fs_1 = require("fs");
const utils_1 = require("./src/utils");
const service_1 = require("./src/service");
async function deploy(ignoreFilePath, extraParam) {
  let finalStatus = null;
  try {
    // 1. find or create .deploy/settings.json, if package.json is not found, return error
    console.info("Load settings...");
    const { deploySettings, env } = await (0, utils_1.loadDeploySettings)();
    const { node, outdir } = extraParam;
    if (deploySettings.area) {
      console.info("Area: ", deploySettings.area);
    }
    console.log("Deploy settings:", deploySettings);
    console.log("Environment variables:", env);
    // 2. zip folder
    console.info("Filter and zip src files...");
    const localFolder = process.cwd();
    const files = await (0, filterFiles_1.filterDirectoryFiles)(
      localFolder,
      ignoreFilePath,
      !!outdir ? [outdir] : [],
    );
    console.log(`Filtered files count: ${files.length}`);
    // zip the files
    const tmpDir = (0, path_1.join)(localFolder, ".tmp");
    if (!(0, fs_1.existsSync)(tmpDir)) {
      (0, fs_1.mkdirSync)(tmpDir, { recursive: true });
    }
    // Create temporary zip file path
    const tmpZipFn = (0, path_1.join)(tmpDir, `${Date.now()}_upload.zip`);
    const file = await (0, utils_1.zipFiles)(tmpZipFn, files);
    // 3. upload and deploy
    let projectId = null;
    let deployId = null;
    let area = "overseas";
    try {
      console.info("Start to upload file...");
      const uploadParams = await (0, service_1.getUploadParamsForDeploy)(
        deploySettings.projectId,
      );
      area = uploadParams.area;
      if (area) {
        console.info("Project Area:", area);
      }
      await (0, service_1.putObjectForDeploy)(
        uploadParams.presignedUploadUrl,
        file,
      );
      console.info("Start to deploy...");
      let deployParams = {
        projectId: deploySettings.projectId,
        path: uploadParams.path,
        env,
        extraParams: {},
      };
      if (!!outdir) {
        deployParams.extraParams.outputDir = outdir;
      }
      if (!!node) {
        deployParams.extraParams.nodejs = node;
      }
      const deploymentResult = await (0, service_1.deployProject)(deployParams);
      projectId = deploymentResult.projectId;
      deployId = deploymentResult.deployId;
      console.info(
        `Deploy initiated: ProjectId=${projectId}, DeployId=${deployId}`,
      );
    } catch (error) {
      if ((0, utils_1.isInvalidProjectIdError)(error)) {
        // reset deploy settings
        (0, utils_1.resetDeploySettings)(deploySettings);
        // save deploy settings
        await (0, utils_1.updateDeploySettings)(deploySettings);
      }
      throw error;
    } finally {
      (0, fs_1.rmSync)(tmpZipFn);
    }
    if (projectId !== deploySettings.projectId) {
      deploySettings.projectId = projectId;
      deploySettings.createTime = new Date().toISOString();
    }
    deploySettings.area = area;
    deploySettings.deployments = deploySettings.deployments || [];
    deploySettings.deployments.unshift({
      deployId: deployId,
      date: new Date().toISOString(),
    });
    // save deploy settings
    await (0, utils_1.updateDeploySettings)(deploySettings);
    // Poll for deployment status
    console.info("Waiting for deployment to complete...");
    const pollInterval = 2000; // 2 seconds
    const maxPollAttempts = 150; // 5 minutes max
    let pollAttempts = 0;
    while (pollAttempts < maxPollAttempts) {
      try {
        const statusResult = await (0, service_1.getDeployStatus)(
          projectId,
          deployId,
        );
        console.info(`Deployment status: ${statusResult.status}`);
        if (
          statusResult.status === "Success" ||
          statusResult.status === "Failed"
        ) {
          finalStatus = statusResult;
          break;
        }
        pollAttempts++;
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error("Failed to poll deploy status:", errorMessage);
        return {
          success: false,
          projectId: projectId,
          deployId: deployId,
          message: `Failed to poll deploy status: ${errorMessage}`,
        };
      }
    }
    if (!finalStatus) {
      return {
        success: false,
        projectId: projectId,
        deployId: deployId,
        message: "Deployment timed out after 5 minutes",
      };
    }
    // Return final deployment result
    const isSuccess = finalStatus.status === "Success";
    const message =
      finalStatus.result?.message ||
      (isSuccess ? "Deployment completed successfully" : "Deployment failed");
    return {
      success: isSuccess,
      status: finalStatus.status,
      projectId: projectId,
      deployId: deployId,
      url: finalStatus.result?.previewUrl,
      message: message,
      log: finalStatus.result?.deployLog,
      audit: finalStatus.result?.auditDetail,
    };
  } catch (error) {
    return (0, utils_1.handleUncaughtError)(error);
  }
}
//# sourceMappingURL=deploy.js.map
