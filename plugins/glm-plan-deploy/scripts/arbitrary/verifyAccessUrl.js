"use strict";

const { execFile } = require("child_process");

const { retryNetworkConnection } = require("../common/http");
const { isExpectedAccessDeniedStatus } = require("./accessControl");

async function runArbitraryVerifyAccessUrl(options = {}) {
  try {
    const accessUrl = resolveAccessUrl(options.accessUrl);
    const requestImpl = options.fetchImpl
      ? (url, init) => fetchBody(options.fetchImpl, url, init)
      : (url, init) => retryNetworkConnection(() => defaultRequest(url, init));

    const initial = await requestImpl(accessUrl, { method: "GET" });
    if (isHealthyResponse(initial.status, initial.body)) {
      return success(initial, false);
    }
    if (isExpectedAccessDeniedStatus(options.accessControl, initial.status)) {
      return expectedAccessDenied(initial, false);
    }

    const diagnostic = await requestImpl(accessUrl, {
      method: "GET",
      body: "{}",
    });
    if (
      isExpectedAccessDeniedStatus(options.accessControl, diagnostic.status)
    ) {
      return expectedAccessDenied(diagnostic, true);
    }
    return success(diagnostic, true);
  } catch (error) {
    return failure(error.message);
  }
}

function resolveAccessUrl(accessUrl) {
  if (typeof accessUrl !== "string" || !accessUrl.trim()) {
    throw new Error("Missing required verification input: `accessUrl`.");
  }

  return accessUrl.trim();
}

async function fetchBody(fetchImpl, accessUrl, init) {
  return retryNetworkConnection(async () => {
    const response = await fetchImpl(accessUrl, init);
    return {
      status: response.status,
      body: await response.text(),
    };
  });
}

function defaultRequest(accessUrl, init = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-sS", "-X", init.method || "GET"];
    if (init.body != null) {
      args.push("-d", init.body);
    }
    args.push("-w", "\n__STATUS__:%{http_code}", accessUrl);

    execFile(
      "curl",
      args,
      { maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        const marker = "\n__STATUS__:";
        const index = stdout.lastIndexOf(marker);
        if (index === -1) {
          reject(
            new Error(
              "Verification request did not return an HTTP status code.",
            ),
          );
          return;
        }

        resolve({
          status: Number(stdout.slice(index + marker.length).trim()) || 0,
          body: stdout.slice(0, index),
        });
      },
    );
  });
}

function isHealthyResponse(status, body) {
  if (status !== 200) {
    return false;
  }

  return !/(bad gateway|cannot find module|module not found|command not found|syntax error|process exited|internal server error)/i.test(
    body || "",
  );
}

function expectedAccessDenied(response, usedDiagnosticRequest) {
  return {
    success: true,
    verified: true,
    expectedAccessDenied: true,
    status: response.status,
    body: response.body,
    usedDiagnosticRequest,
    summary:
      "Deployment access URL is restricted and returned the expected denied status from this IP.",
  };
}

function success(response, usedDiagnosticRequest) {
  const verified = isHealthyResponse(response.status, response.body);
  return {
    success: true,
    verified,
    status: response.status,
    body: response.body,
    usedDiagnosticRequest,
    summary: verified
      ? "Deployment access URL verification passed."
      : "Deployment access URL returned an unhealthy response.",
  };
}

function failure(message) {
  return {
    success: false,
    message,
    summary: message,
  };
}

module.exports = {
  runArbitraryVerifyAccessUrl,
};
