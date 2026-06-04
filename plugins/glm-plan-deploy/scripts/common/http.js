"use strict";

const { assertDeployToken } = require("./auth");

class DeployApiError extends Error {
  constructor(message, details = {}) {
    super(sanitizeDiagnosticString(message));
    this.name = "DeployApiError";
    this.httpStatus = details.httpStatus || null;
    this.responseStatus = details.responseStatus || details.httpStatus || null;
    this.apiCode = details.apiCode || null;
    this.apiMessage = details.apiMessage
      ? sanitizeDiagnosticString(details.apiMessage)
      : null;
    this.requestBody = cloneDiagnosticValue(details.requestBody);
    this.responseBody = cloneDiagnosticValue(
      details.responseBody !== undefined ? details.responseBody : details.body,
    );
    this.body = this.responseBody;
    this.url = details.url;
    this.method = details.method;
    this.causeName = details.cause ? details.cause.name || null : null;
    this.causeMessage = details.cause
      ? sanitizeDiagnosticString(details.cause.message || String(details.cause))
      : null;
    this.causeCode = details.cause
      ? collectErrorCodes(details.cause)[0] || null
      : null;
    if (details.cause) {
      Object.defineProperty(this, "cause", {
        value: details.cause,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
    this.apiRecord = buildApiRecord({
      url: this.url,
      method: this.method,
      requestBody: this.requestBody,
      responseStatus: this.responseStatus,
      responseBody: this.responseBody,
      errorMessage: this.message,
      causeName: this.causeName,
      causeMessage: this.causeMessage,
      causeCode: this.causeCode,
    });
  }
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const MAX_DIAGNOSTIC_STRING_LENGTH = 4096;
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 200;
const MAX_DIAGNOSTIC_OBJECT_KEYS = 100;
const MAX_DIAGNOSTIC_DEPTH = 8;
const SENSITIVE_FIELD_PATTERN =
  /(?:authorization|token|secret|password|credential|presignedUploadUrl|signedUrl|uploadUrl|signature)/i;

function isInvalidProjectIdError(error) {
  return (
    error instanceof DeployApiError &&
    error.apiCode === 1220 &&
    (error.apiMessage === "Invalid projectId" ||
      error.apiMessage === "Project disabled")
  );
}

function isProjectNotFoundError(error) {
  return (
    error instanceof DeployApiError &&
    error.apiCode === 3012 &&
    error.apiMessage === "PROJECT_NOT_FOUND"
  );
}

function isDeploymentNotFoundError(error) {
  return (
    error instanceof DeployApiError &&
    error.apiCode === 3011 &&
    error.apiMessage === "DEPLOYMENT_NOT_FOUND"
  );
}

function isNetworkConnectionError(error) {
  if (!error || error instanceof DeployApiError) return false;
  if (error.name === "AbortError") return true;

  for (const code of collectErrorCodes(error)) {
    if (NETWORK_ERROR_CODES.has(code)) return true;
  }

  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network error") ||
    message.includes("socket hang up") ||
    message.includes("connection reset") ||
    message.includes("connection refused") ||
    message.includes("connection timeout") ||
    message.includes("connection timed out") ||
    message.includes("failed to connect") ||
    message.includes("could not connect") ||
    message.includes("couldn't connect") ||
    message.includes("could not resolve host") ||
    message.includes("couldn't resolve host") ||
    message.includes("timed out") ||
    message.includes("getaddrinfo") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("eai_again")
  );
}

// True when the error represents a pre-response connectivity failure —
// either a raw network error, or a DeployApiError that requestJson produced
// after its own internal retry budget was exhausted on such an error (no
// HTTP status and no API code were ever received). Callers that poll a
// long-running server-side operation should treat this as transient and
// keep retrying within their own time budget rather than aborting, since
// the operation continues server-side regardless of client connectivity.
function isTransientConnectivityError(error) {
  if (isNetworkConnectionError(error)) {
    return true;
  }
  if (
    error instanceof DeployApiError &&
    error.responseStatus == null &&
    error.apiCode == null
  ) {
    if (error.causeCode && NETWORK_ERROR_CODES.has(error.causeCode)) {
      return true;
    }
    return isNetworkConnectionError(error.cause);
  }
  return false;
}

function collectErrorCodes(error) {
  const codes = [];
  const visited = new Set();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    for (const key of ["code", "errno"]) {
      if (typeof current[key] === "string" && current[key]) {
        codes.push(current[key]);
      }
    }
    current = current.cause;
  }
  return codes;
}

async function retryNetworkConnection(operation, options = {}) {
  const retries = options.retries == null ? 1 : Number(options.retries);
  const maxRetries = Number.isInteger(retries) && retries > 0 ? retries : 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isNetworkConnectionError(error)) {
        throw error;
      }
    }
  }
}

async function fetchWithNetworkRetry(fetchImpl, url, init, options = {}) {
  return retryNetworkConnection(() => fetchImpl(url, init), options);
}

async function requestJson(options) {
  const {
    url,
    method = "GET",
    token,
    body,
    headers = {},
    fetchImpl = fetch,
  } = options;

  assertDeployToken(token);

  const requestBody = cloneDiagnosticValue(body === undefined ? null : body);
  const requestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  let response;
  let text;
  try {
    ({ response, text } = await retryNetworkConnection(async () => {
      const response = await fetchImpl(url, requestInit);
      return {
        response,
        text: await response.text(),
      };
    }));
  } catch (error) {
    throw new DeployApiError(
      error.message || "Deploy API request failed before response",
      {
        cause: error,
        method,
        url,
        requestBody,
        responseStatus: null,
        responseBody: null,
      },
    );
  }

  let parsedBody = null;
  if (text) {
    try {
      parsedBody = JSON.parse(text);
    } catch (error) {
      throw new DeployApiError("Invalid JSON response from deploy API", {
        httpStatus: response.status,
        body: text,
        requestBody,
        responseStatus: response.status,
        responseBody: text,
        method,
        url,
      });
    }
  }

  if (!response.ok) {
    throw new DeployApiError(
      `Deploy API request failed with status ${response.status}`,
      {
        httpStatus: response.status,
        body: parsedBody || text,
        requestBody,
        responseStatus: response.status,
        responseBody: parsedBody || text,
        method,
        url,
      },
    );
  }

  if (!parsedBody || typeof parsedBody !== "object") {
    throw new DeployApiError("Deploy API returned an empty response body", {
      httpStatus: response.status,
      body: parsedBody,
      requestBody,
      responseStatus: response.status,
      responseBody: parsedBody,
      method,
      url,
    });
  }

  if (parsedBody.code !== 200) {
    throw new DeployApiError(
      `Deploy API error: ${parsedBody.msg || "Unknown error"}`,
      {
        httpStatus: response.status,
        apiCode: parsedBody.code,
        apiMessage: parsedBody.msg || null,
        body: parsedBody,
        requestBody,
        responseStatus: response.status,
        responseBody: parsedBody,
        method,
        url,
      },
    );
  }

  return {
    envelope: parsedBody,
    data: parsedBody.data,
    apiRecord: buildApiRecord({
      url,
      method,
      requestBody,
      responseStatus: response.status,
      responseBody: parsedBody,
    }),
  };
}

function buildApiRecord(record) {
  return {
    url: record.url || null,
    method: record.method || "GET",
    requestBody: cloneDiagnosticValue(
      record.requestBody === undefined ? null : record.requestBody,
    ),
    responseStatus:
      record.responseStatus == null ? null : record.responseStatus,
    responseBody: cloneDiagnosticValue(
      record.responseBody === undefined ? null : record.responseBody,
    ),
    ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
    ...(record.causeName ? { causeName: record.causeName } : {}),
    ...(record.causeMessage ? { causeMessage: record.causeMessage } : {}),
    ...(record.causeCode ? { causeCode: record.causeCode } : {}),
  };
}

function cloneDiagnosticValue(value) {
  return sanitizeDiagnosticValue(value);
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (typeof value === "string") return sanitizeDiagnosticString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DIAGNOSTIC_DEPTH) return "[Truncated: max depth exceeded]";

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DIAGNOSTIC_ARRAY_ITEMS)
      .map((item) => sanitizeDiagnosticValue(item, depth + 1));
    if (value.length > MAX_DIAGNOSTIC_ARRAY_ITEMS) {
      items.push({ truncatedItems: value.length - MAX_DIAGNOSTIC_ARRAY_ITEMS });
    }
    return items;
  }

  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value);
    for (const [key, nested] of entries.slice(0, MAX_DIAGNOSTIC_OBJECT_KEYS)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizeDiagnosticValue(nested, depth + 1);
      }
    }
    if (entries.length > MAX_DIAGNOSTIC_OBJECT_KEYS) {
      output.truncatedKeys = entries.length - MAX_DIAGNOSTIC_OBJECT_KEYS;
    }
    return output;
  }

  return String(value);
}

function sanitizeDiagnosticString(value) {
  const redacted = value
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(
      /([?&](?:token|signature|x-cos-signature|x-amz-signature|access_token|secret)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:token|secret|password|credential)\s*[:=]\s*)[^\s,}]+/gi,
      "$1[REDACTED]",
    );

  if (redacted.length <= MAX_DIAGNOSTIC_STRING_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...[truncated ${redacted.length - MAX_DIAGNOSTIC_STRING_LENGTH} chars]`;
}

module.exports = {
  buildApiRecord,
  DeployApiError,
  fetchWithNetworkRetry,
  isDeploymentNotFoundError,
  isInvalidProjectIdError,
  isNetworkConnectionError,
  isProjectNotFoundError,
  isTransientConnectivityError,
  requestJson,
  retryNetworkConnection,
};
