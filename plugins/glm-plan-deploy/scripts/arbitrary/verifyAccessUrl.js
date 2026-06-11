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
      ? (url, init) => fetchBody(options.fetchImpl, url, init)
      : (url, init) => retryNetworkConnection(() => defaultRequest(url, init));

    const initial = await requestImpl(accessUrl, {
      method: "GET",
      maxBodyBytes: MAX_VERIFICATION_BODY_BYTES,
    });
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
      maxBodyBytes: MAX_VERIFICATION_BODY_BYTES,
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
    return failure(error.message, { requestAttempted: true });
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
    let url;
    try {
      url = new URL(accessUrl);
    } catch (_) {
      reject(new Error(`Invalid access URL: ${accessUrl}`));
      return;
    }

    const transport = url.protocol === "https:" ? https : http;
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error(`Unsupported access URL protocol: ${url.protocol}`));
      return;
    }

    const maxBodyBytes = normalizeMaxBodyBytes(init.maxBodyBytes);
    const headers = { ...(init.headers || {}) };
    if (maxBodyBytes) {
      headers.Range = `bytes=0-${maxBodyBytes - 1}`;
    }

    const body = init.body == null ? null : String(init.body);
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
        const chunks = [];
        let totalBytes = 0;
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            status: response.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        };

        response.on("data", (chunk) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (maxBodyBytes && totalBytes + buffer.length > maxBodyBytes) {
            const remaining = maxBodyBytes - totalBytes;
            if (remaining > 0) {
              chunks.push(buffer.subarray(0, remaining));
            }
            finish();
            response.destroy();
            return;
          }
          chunks.push(buffer);
          totalBytes += buffer.length;
        });
        response.on("end", finish);
        response.on("error", (error) => {
          if (!settled) reject(error);
        });
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

function normalizeMaxBodyBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.floor(number);
}

function isHealthyResponse(status, body) {
  if (status < 200 || status >= 300) {
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
  redirectDepth = 0,
  seenRedirectUrls,
}) {
  const seenUrls = seenRedirectUrls || new Set([accessUrl]);
  const htmlRedirect = collectSameOriginHtmlRedirect(accessUrl, response.body);
  if (htmlRedirect) {
    if (seenUrls.has(htmlRedirect.url)) {
      return unhealthyHtmlRedirectLoop({
        response,
        usedDiagnosticRequest,
        redirect: htmlRedirect,
      });
    }
    if (redirectDepth >= MAX_HTML_REDIRECTS_TO_VERIFY) {
      return unhealthyHtmlRedirectDepth({
        response,
        usedDiagnosticRequest,
        redirect: htmlRedirect,
      });
    }

    const redirectResponse = await requestImpl(htmlRedirect.url, {
      method: "GET",
      maxBodyBytes: MAX_VERIFICATION_BODY_BYTES,
    });
    if (!isHealthyResponse(redirectResponse.status, redirectResponse.body)) {
      return unhealthyHtmlRedirect({
        response,
        usedDiagnosticRequest,
        redirect: htmlRedirect,
        redirectResponse,
      });
    }
    const nextSeenUrls = new Set(seenUrls);
    nextSeenUrls.add(htmlRedirect.url);
    return verifySuccessResponse({
      accessUrl: htmlRedirect.url,
      response: redirectResponse,
      requestImpl,
      usedDiagnosticRequest,
      redirectDepth: redirectDepth + 1,
      seenRedirectUrls: nextSeenUrls,
    });
  }

  const linkedAssets = collectSameOriginLinkedAssets(accessUrl, response.body);
  const assetChecks = [];

  for (const asset of linkedAssets) {
    const assetResponse = await requestImpl(asset.url, {
      method: "GET",
      maxBodyBytes: MAX_VERIFICATION_BODY_BYTES,
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
const MAX_HTML_REDIRECTS_TO_VERIFY = 2;
const MAX_VERIFICATION_BODY_BYTES = 65536;

function collectSameOriginHtmlRedirect(accessUrl, body) {
  if (!looksLikeHtml(body)) {
    return null;
  }

  let documentUrl;
  try {
    documentUrl = new URL(accessUrl);
  } catch (_) {
    return null;
  }

  const baseUrl = resolveDocumentBaseUrl(documentUrl, body);
  const redirectTarget = extractHtmlRedirectTarget(body);
  if (!redirectTarget) {
    return null;
  }

  const resolved = resolveAssetUrl(redirectTarget.url, baseUrl, documentUrl);
  return resolved
    ? { ...redirectTarget, url: resolved, source: redirectTarget.url }
    : null;
}

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

function extractHtmlRedirectTarget(body) {
  for (const tag of body.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    if (!/^refresh$/i.test(attrs["http-equiv"] || "") || !attrs.content) {
      continue;
    }
    const target = extractImmediateMetaRefreshTarget(attrs.content);
    if (target) {
      return { type: "meta-refresh", url: target };
    }
  }

  for (const script of extractInlineScripts(body)) {
    const target = extractJavaScriptRedirectTarget(script);
    if (target) {
      return target;
    }
  }

  return null;
}

function extractInlineScripts(body) {
  const scripts = [];
  const pattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(body || ""))) {
    scripts.push(match[1] || "");
  }
  return scripts;
}

function extractImmediateMetaRefreshTarget(content) {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)?\s*;\s*url\s*=\s*(.+?)\s*$/i.exec(
    String(content || ""),
  );
  if (!match) {
    return null;
  }
  const delay = match[1] == null || match[1] === "" ? 0 : Number(match[1]);
  if (!Number.isFinite(delay) || delay > 1) {
    return null;
  }
  return stripWrappingQuotes(match[2]);
}

function extractJavaScriptRedirectTarget(script) {
  const trimmed = String(script || "").trim();
  if (!trimmed || /\b(function|=>|addEventListener|onclick)\b/i.test(trimmed)) {
    return null;
  }

  const newUrlCall =
    /^\s*(?:window\.)?location\.(?:assign|replace)\(\s*new\s+URL\(\s*["']([^"']+)["']\s*,\s*location\.href\s*\)\.href\s*\)\s*;?\s*$/i.exec(
      trimmed,
    );
  if (newUrlCall) {
    return { type: "script-redirect", url: newUrlCall[1] };
  }

  const methodCall =
    /^\s*(?:window\.)?location\.(?:assign|replace)\(\s*["']([^"']+)["']\s*\)\s*;?\s*$/i.exec(
      trimmed,
    );
  if (methodCall) {
    return { type: "script-redirect", url: methodCall[1] };
  }

  const assignment =
    /^\s*(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']\s*;?\s*$/i.exec(
      trimmed,
    );
  if (assignment) {
    return { type: "script-redirect", url: assignment[1] };
  }

  return null;
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

function stripWrappingQuotes(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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

function unhealthyHtmlRedirect({
  response,
  usedDiagnosticRequest,
  redirect,
  redirectResponse,
}) {
  const htmlFallback = looksLikeHtmlDocument(redirectResponse.body);
  const reason =
    redirectResponse.status >= 200 &&
    redirectResponse.status < 300 &&
    htmlFallback
      ? "returned an HTML fallback document instead of the redirect target"
      : `returned HTTP ${redirectResponse.status}`;
  const message = `Deployment access URL HTML redirect target failed verification: ${redirect.url} ${reason}.`;
  return {
    success: true,
    verified: false,
    status: response.status,
    body: message,
    usedDiagnosticRequest,
    redirectCheck: {
      type: redirect.type,
      source: redirect.source,
      url: redirect.url,
      status: redirectResponse.status,
    },
    summary: message,
  };
}

function unhealthyHtmlRedirectLoop({
  response,
  usedDiagnosticRequest,
  redirect,
}) {
  const message = `Deployment access URL HTML redirect loop detected while verifying: ${redirect.url}.`;
  return {
    success: true,
    verified: false,
    status: response.status,
    body: message,
    usedDiagnosticRequest,
    redirectCheck: {
      type: redirect.type,
      source: redirect.source,
      url: redirect.url,
      status: null,
    },
    summary: message,
  };
}

function unhealthyHtmlRedirectDepth({
  response,
  usedDiagnosticRequest,
  redirect,
}) {
  const message = `Deployment access URL HTML redirect verification exceeded ${MAX_HTML_REDIRECTS_TO_VERIFY} redirects before reaching: ${redirect.url}.`;
  return {
    success: true,
    verified: false,
    status: response.status,
    body: message,
    usedDiagnosticRequest,
    redirectCheck: {
      type: redirect.type,
      source: redirect.source,
      url: redirect.url,
      status: null,
    },
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

function failure(message, extra = {}) {
  return {
    success: false,
    message,
    summary: message,
    ...extra,
  };
}

module.exports = {
  runArbitraryVerifyAccessUrl,
};
