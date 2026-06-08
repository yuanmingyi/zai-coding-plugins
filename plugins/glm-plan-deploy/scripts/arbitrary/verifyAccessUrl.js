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
      return await verifySuccessResponse({
        accessUrl,
        response: initial,
        requestImpl,
        usedDiagnosticRequest: false,
      });
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
    if (isHealthyResponse(diagnostic.status, diagnostic.body)) {
      return await verifySuccessResponse({
        accessUrl,
        response: diagnostic,
        requestImpl,
        usedDiagnosticRequest: true,
      });
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
    const maxBodyBytes = normalizeMaxBodyBytes(init.maxBodyBytes);
    if (maxBodyBytes) {
      args.push("--range", `0-${maxBodyBytes - 1}`);
    }
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

function normalizeMaxBodyBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.floor(number);
}

function isHealthyResponse(status, body) {
  if (status !== 200) {
    return false;
  }

  return !/(bad gateway|cannot find module|module not found|command not found|syntax error|process exited|internal server error)/i.test(
    body || "",
  );
}

async function verifySuccessResponse({
  accessUrl,
  response,
  requestImpl,
  usedDiagnosticRequest,
}) {
  const linkedAssets = collectSameOriginLinkedAssets(accessUrl, response.body);
  const assetChecks = [];

  for (const asset of linkedAssets) {
    const assetResponse = await requestImpl(asset.url, {
      method: "GET",
      maxBodyBytes: 65536,
    });
    const check = {
      ...asset,
      status: assetResponse.status,
    };
    assetChecks.push(check);

    if (!isHealthyAssetResponse(assetResponse.status, assetResponse.body)) {
      return unhealthyLinkedAsset({
        response,
        usedDiagnosticRequest,
        asset,
        assetResponse,
        assetChecks,
      });
    }
  }

  return success(response, usedDiagnosticRequest, { assetChecks });
}

const MAX_LINKED_ASSETS_TO_VERIFY = 12;

function collectSameOriginLinkedAssets(accessUrl, body) {
  if (!looksLikeHtml(body)) {
    return [];
  }

  let documentUrl;
  try {
    documentUrl = new URL(accessUrl);
  } catch (_) {
    return [];
  }

  const baseUrl = resolveDocumentBaseUrl(documentUrl, body);
  const assets = [];
  const seen = new Set();

  for (const candidate of extractHtmlAssetCandidates(body)) {
    const resolved = resolveAssetUrl(candidate.url, baseUrl, documentUrl);
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    assets.push({ ...candidate, url: resolved });
    if (assets.length >= MAX_LINKED_ASSETS_TO_VERIFY) {
      break;
    }
  }

  return assets;
}

function looksLikeHtml(body) {
  return /<!doctype\s+html\b|<html\b|<head\b|<script\b|<link\b/i.test(
    body || "",
  );
}

function resolveDocumentBaseUrl(documentUrl, body) {
  const baseHref = extractFirstAttribute(body, "base", "href");
  if (!baseHref) {
    return documentUrl;
  }

  try {
    return new URL(baseHref, documentUrl);
  } catch (_) {
    return documentUrl;
  }
}

function extractHtmlAssetCandidates(body) {
  const candidates = [];
  for (const tag of body.match(/<script\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    if (attrs.src) {
      candidates.push({ type: "script", source: attrs.src, url: attrs.src });
    }
  }

  for (const tag of body.match(/<link\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    if (!attrs.href || !/\bstylesheet\b/i.test(attrs.rel || "")) {
      continue;
    }
    candidates.push({
      type: "stylesheet",
      source: attrs.href,
      url: attrs.href,
    });
  }
  return candidates;
}

function extractFirstAttribute(body, tagName, attributeName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "i");
  const match = pattern.exec(body || "");
  if (!match) {
    return null;
  }
  return parseHtmlAttributes(match[0])[attributeName] || null;
}

function parseHtmlAttributes(tag) {
  const attrs = {};
  const attrPattern =
    /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let match;
  while ((match = attrPattern.exec(tag))) {
    const name = match[1].toLowerCase();
    if (name.startsWith("<") || name === "script" || name === "link") {
      continue;
    }
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function resolveAssetUrl(assetUrl, baseUrl, documentUrl) {
  const value = String(assetUrl || "").trim();
  if (
    !value ||
    value.startsWith("#") ||
    /^(?:data|blob|javascript|mailto):/i.test(value)
  ) {
    return null;
  }

  let resolved;
  try {
    resolved = new URL(value, baseUrl);
  } catch (_) {
    return null;
  }

  if (resolved.origin !== documentUrl.origin) {
    return null;
  }
  return resolved.href;
}

function isHealthyAssetResponse(status, body) {
  return status >= 200 && status < 300 && !looksLikeHtmlDocument(body);
}

function looksLikeHtmlDocument(body) {
  return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(body || "");
}

function unhealthyLinkedAsset({
  response,
  usedDiagnosticRequest,
  asset,
  assetResponse,
  assetChecks,
}) {
  const htmlFallback = looksLikeHtmlDocument(assetResponse.body);
  const reason = htmlFallback
    ? "returned an HTML document instead of the asset body"
    : `returned HTTP ${assetResponse.status}`;
  const message = `Deployment access URL linked ${asset.type} asset failed verification: ${asset.url} ${reason}.`;
  return {
    success: true,
    verified: false,
    status: response.status,
    body: message,
    usedDiagnosticRequest,
    assetChecks,
    summary: message,
  };
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

function success(response, usedDiagnosticRequest, extra = {}) {
  const verified = isHealthyResponse(response.status, response.body);
  return {
    success: true,
    verified,
    status: response.status,
    body: response.body,
    usedDiagnosticRequest,
    ...extra,
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
