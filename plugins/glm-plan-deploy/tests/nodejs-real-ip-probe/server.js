"use strict";

const http = require("http");
const net = require("net");

const PORT = Number(process.env.PORT || 3000);
const HEADER_NAMES = [
  "host",
  "user-agent",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-envoy-external-address",
];

function selectedHeaders(headers) {
  const selected = {};
  for (const name of HEADER_NAMES) {
    if (headers[name] != null) {
      selected[name] = headers[name];
    }
  }
  return selected;
}

function splitForwardedFor(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripIpDecorations(value) {
  let normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("[") && normalized.includes("]")) {
    normalized = normalized.slice(1, normalized.indexOf("]"));
  }

  const ipv4WithPort = normalized.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort) {
    normalized = ipv4WithPort[1];
  }

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) {
      normalized = mapped;
    }
  }

  return normalized || null;
}

function ipCandidate(source, value) {
  const ip = stripIpDecorations(value);
  const version = net.isIP(ip);
  if (!version) {
    return null;
  }
  return {
    source,
    value: String(value || ""),
    ip,
    family: version === 6 ? "IPv6" : "IPv4",
    allowlistCidr: `${ip}/${version === 6 ? 128 : 32}`,
  };
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) {
      return false;
    }
    const key = `${candidate.source}:${candidate.ip}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const server = http.createServer((req, res) => {
  const xForwardedFor = splitForwardedFor(req.headers["x-forwarded-for"]);
  const realIpCandidates = uniqueCandidates([
    ipCandidate("x-envoy-external-address", req.headers["x-envoy-external-address"]),
    ipCandidate("x-real-ip", req.headers["x-real-ip"]),
    ipCandidate("socket-remote-address", req.socket.remoteAddress),
    ipCandidate("first-x-forwarded-for", xForwardedFor[0]),
    ipCandidate("last-x-forwarded-for", xForwardedFor[xForwardedFor.length - 1]),
  ]);
  const payload = {
    ok: true,
    purpose: "tcb-real-ip-probe",
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    socketRemoteAddress: req.socket.remoteAddress,
    socketRemotePort: req.socket.remotePort,
    headers: selectedHeaders(req.headers),
    parsed: {
      xForwardedFor,
      firstXForwardedFor: xForwardedFor[0] || null,
      lastXForwardedFor: xForwardedFor[xForwardedFor.length - 1] || null,
      xEnvoyExternalAddress: req.headers["x-envoy-external-address"] || null,
      xEnvoyExternalAddressVersion: net.isIP(
        stripIpDecorations(req.headers["x-envoy-external-address"]),
      ),
      realIpCandidates,
      allowlistCandidates: realIpCandidates.map(
        (candidate) => candidate.allowlistCidr,
      ),
    },
  };

  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
});

server.listen(PORT, "0.0.0.0", () => {
  console.error(`real-ip probe listening on ${PORT}`);
});
