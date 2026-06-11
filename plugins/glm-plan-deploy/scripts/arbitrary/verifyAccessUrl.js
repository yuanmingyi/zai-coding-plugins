"use strict";

const http = require("http");
const https = require("https");

const { retryNetworkConnection } = require("../common/http");
const { isExpectedAccessDeniedStatus } = require("./accessControl");

async function runArbitraryVerifyAccessUrl(options = {}) {
  let accessUrl;
  try {
    accessUrl = resolveAccessUrl(options.accessUrl);
  } catch (error) {
    return failure(error.message, { requestAttempted: false });
  }

  try {
    const requestImpl = options.fetchImpl
      ? (url, init) => fetchStatus(options.fetchImpl, url, init)
      : (url, init) => retryNetworkConnection(() => defaultRequest(url, init));

    const response = await requestImpl(accessUrl, {
      method: "GET",
      redirect: "manual",
      statusOnly: true,
    });

    if (isExpectedAccessDeniedStatus(options.accessControl, response.status)) {
      return expectedAccessDenied(response, false);
    }

    return success(response, false);
  } catch (error) {
    return failure(error.message, { requestAttempted: true });
  }
}

function resolveAccessUrl(accessUrl) {
  if (typeof accessUrl !== "string" || !accessUrl.trim()) {
    throw new Error("Missing required verification input: `accessUrl`.");
  }

  return accessUrl.trim();
}

async function fetchStatus(fetchImpl, accessUrl, init) {
  return retryNetworkConnection(async () => {
    const response = await fetchImpl(accessUrl, init);
    return {
      status: response.status,
      body: "",
    };
  });
}

function defaultRequest(accessUrl, init = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(accessUrl);
    } catch (_) {
      reject(new Error(`Invalid access URL: ${accessUrl}`));
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error(`Unsupported access URL protocol: ${url.protocol}`));
      return;
    }

    const transport = url.protocol === "https:" ? https : http;
    const body = init.body == null ? null : String(init.body);
    const headers = { ...(init.headers || {}) };
    if (body != null && !hasHeader(headers, "content-length")) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const request = transport.request(
      url,
      {
        method: init.method || "GET",
        headers,
      },
      (response) => {
        if (init.statusOnly) {
          resolve({
            status: response.statusCode || 0,
            body: "",
          });
          response.destroy();
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );

    request.on("error", reject);
    if (body != null) {
      request.write(body);
    }
    request.end();
  });
}

function hasHeader(headers, name) {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}

function success(response, usedDiagnosticRequest) {
  const verified = isSuccessfulAccessStatus(response.status);
  return {
    success: true,
    verified,
    status: response.status,
    body: response.body || "",
    usedDiagnosticRequest,
    summary: `Deployment access URL returned HTTP ${response.status}.`,
  };
}

function expectedAccessDenied(response, usedDiagnosticRequest) {
  return {
    success: true,
    verified: true,
    expectedAccessDenied: true,
    status: response.status,
    body: response.body || "",
    usedDiagnosticRequest,
    summary: `Deployment access URL is restricted and returned expected HTTP ${response.status}.`,
  };
}

function failure(message, extra = {}) {
  return {
    success: false,
    message,
    summary: message,
    ...extra,
  };
}

function isSuccessfulAccessStatus(status) {
  const number = Number(status);
  return (
    Number.isInteger(number) && number >= 200 && number < 500 && number !== 404
  );
}

module.exports = {
  isSuccessfulAccessStatus,
  runArbitraryVerifyAccessUrl,
};
