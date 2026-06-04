"use strict";

const target = process.argv[2];
const SPOOFED_IPV4 = "203.0.113.250";
const SPOOFED_IPV6 = "2001:db8::250";

if (!target) {
  console.error("Usage: node probe.js <access-url>");
  process.exit(1);
}

async function request(label, headers = {}) {
  const response = await fetch(target, { headers });
  const body = await response.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    // Keep the raw body below.
  }
  return {
    label,
    status: response.status,
    json,
    body: json ? undefined : body.slice(0, 1000),
  };
}

function pick(result) {
  const payload = result.json || {};
  const headers = payload.headers || {};
  const serialized = JSON.stringify(payload);
  return {
    label: result.label,
    status: result.status,
    socketRemoteAddress: payload.socketRemoteAddress,
    xRealIp: headers["x-real-ip"] || null,
    xForwardedFor: headers["x-forwarded-for"] || null,
    forwarded: headers.forwarded || null,
    xForwardedProto: headers["x-forwarded-proto"] || null,
    xForwardedHost: headers["x-forwarded-host"] || null,
    xEnvoyExternalAddress: headers["x-envoy-external-address"] || null,
    xEnvoyExternalAddressVersion:
      payload.parsed && payload.parsed.xEnvoyExternalAddressVersion,
    realIpCandidates: (payload.parsed && payload.parsed.realIpCandidates) || [],
    allowlistCandidates:
      (payload.parsed && payload.parsed.allowlistCandidates) || [],
    spoofedIpv4Present: serialized.includes(SPOOFED_IPV4),
    spoofedIpv6Present: serialized.includes(SPOOFED_IPV6),
  };
}

async function main() {
  const results = [
    await request("normal"),
    await request("spoofed-x-forwarded-for", {
      "X-Forwarded-For": SPOOFED_IPV4,
    }),
    await request("spoofed-forwarded", {
      Forwarded: `for=${SPOOFED_IPV6};proto=https`,
    }),
    await request("spoofed-x-envoy-external-address", {
      "X-Envoy-External-Address": SPOOFED_IPV6,
    }),
  ];

  const summary = results.map(pick);
  console.log(JSON.stringify(summary, null, 2));
  const normal = summary.find((item) => item.label === "normal");
  if (normal && normal.allowlistCandidates.length) {
    console.log("\nAllowlist candidates from normal request:");
    for (const cidr of normal.allowlistCandidates) {
      console.log(`- ${cidr}`);
    }
  }
  console.log("\nFull responses:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
