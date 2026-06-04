"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeployLog =
  exports.getDeployStatus =
  exports.deployProject =
  exports.getAvailableNodejsVersions =
  exports.getUploadParamsForDeploy =
  exports.putObjectForDeploy =
  exports.api_base_url =
    void 0;
const urls = {
  getUploadParamsForDeploy: `/cc-deploy/client/getUploadParameters`,
  deployProject: "/cc-deploy/client/createDeployment",
  getDeployStatus: "/cc-deploy/client/getDeployStatus",
  getDeployLog: "/cc-deploy/client/getDeployLog",
  getAvailableNodejsVersions: "/cc-deploy/client/getAvailableNodejsVersions",
};
function removeAnthropicPath(url) {
  if (url.endsWith("/anthropic")) {
    return url.slice(0, url.length - "/anthropic".length);
  }
  return url;
}
exports.api_base_url = removeAnthropicPath(
  process.env.API_BASE_URL || process.env.ANTHROPIC_BASE_URL || "",
);
const putObjectForDeploy = async (url, file) => {
  if (file.size > 100 * 1024 * 1024) {
    throw new Error("file too large! file size must be less than 100MB");
  }
  console.log(
    `putObjectForDeploy url: ${url}, file: ${file.name}, type: ${file.type}, size: ${file.size}`,
  );
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    console.debug(`putObjectForDeploy response: (${response.status})`);
    if (!response.ok) {
      throw new Error(
        `Upload failed with status: ${response.status} ${response.statusText}`,
      );
    }
    return await response.text();
  } catch (error) {
    console.error("Failed to upload file:", error);
    throw error;
  }
};
exports.putObjectForDeploy = putObjectForDeploy;
const getUploadParamsForDeploy = async (projectId) => {
  const url = exports.api_base_url + urls.getUploadParamsForDeploy;
  console.log(
    `getUploadParamsForDeploy url: ${url}, projectId=${projectId || ""}`,
  );
  try {
    const response = await fetch(url + `?projectId=${projectId || ""}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN || ""}`,
      },
    });
    return handleHttpResponse(response);
  } catch (error) {
    console.error("Failed to get upload params:", error);
    throw error;
  }
};
exports.getUploadParamsForDeploy = getUploadParamsForDeploy;
const getAvailableNodejsVersions = async () => {
  const url = exports.api_base_url + urls.getAvailableNodejsVersions;
  console.log("getAvailableNodejsVersions:", url);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN || ""}`,
      },
    });
    return handleHttpResponse(response);
  } catch (error) {
    console.error("Failed to deploy project:", error);
    throw error;
  }
};
exports.getAvailableNodejsVersions = getAvailableNodejsVersions;
const deployProject = async (arg) => {
  const url = exports.api_base_url + urls.deployProject;
  console.log("deployProject url:", url);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN || ""}`,
      },
      body: JSON.stringify(arg),
    });
    return handleHttpResponse(response);
  } catch (error) {
    console.error("Failed to deploy project:", error);
    throw error;
  }
};
exports.deployProject = deployProject;
const getDeployStatus = async (projectId, deployId) => {
  const url = exports.api_base_url + urls.getDeployStatus;
  console.log(
    `getDeployStatus url: ${url}, projectId=${projectId || ""}, deployId=${deployId || ""}`,
  );
  try {
    const response = await fetch(
      url + `?projectId=${projectId || ""}&deployId=${deployId || ""}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN || ""}`,
        },
      },
    );
    return handleHttpResponse(response);
  } catch (error) {
    console.error("Failed to get deploy status:", error);
    throw error;
  }
};
exports.getDeployStatus = getDeployStatus;
const getDeployLog = async (projectId, deployId) => {
  const url = exports.api_base_url + urls.getDeployLog;
  console.log(
    `getDeployLog url: ${url}, projectId=${projectId || ""}, deployId=${deployId || ""}`,
  );
  try {
    const response = await fetch(
      url + `?projectId=${projectId || ""}&deployId=${deployId || ""}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN || ""}`,
        },
      },
    );
    console.debug(`API request result: (${response.status})`);
    if (!response.ok) {
      throw new Error(`API request failed`);
    }
    return handleHttpResponse(response);
  } catch (error) {
    console.error("Failed to get deploy status:", error);
    throw error;
  }
};
exports.getDeployLog = getDeployLog;
const handleHttpResponse = async (response) => {
  const text = await response.text();
  console.debug(`API request result: (${response.status}): ${text}`);
  if (!response.ok) {
    throw new Error(`API request failed`);
  }
  const resp = JSON.parse(text);
  if (resp.code !== 200) {
    throw new AggregateError(
      [resp],
      `API error: ${resp.msg || "Unknown error"}`,
    );
  }
  return resp.data;
};
//# sourceMappingURL=service.js.map
