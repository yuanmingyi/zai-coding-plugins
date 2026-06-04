# Node.js Real IP Probe

Minimal Node.js application for checking which visitor IP signals reach a
TCB arbitrary deployment behind the generated nginx runtime.

## Deploy

Run this from an authenticated shell with `ZAI_API_TOKEN` and
`ZAI_API_BASE_URL` configured:

```bash
node /Users/yuanmingyi/workspace/zai-cc/plugins/glm-plan-deploy/scripts/plugin-cli.js deploy-arbitrary --json \
  --cwd /Users/yuanmingyi/workspace/zai-cc/plugins/glm-plan-deploy/tests/nodejs-real-ip-probe \
  --databaseMode skip
```

Record the returned `accessUrl`.

## Probe

From a normal client network:

```bash
node /Users/yuanmingyi/workspace/zai-cc/plugins/glm-plan-deploy/tests/nodejs-real-ip-probe/probe.js "https://your-access-url.example.com/"
```

The script performs four requests:

- one normal request
- one request with spoofed `X-Forwarded-For: 203.0.113.250`
- one request with spoofed `Forwarded: for=2001:db8::250`
- one request with spoofed `X-Envoy-External-Address: 2001:db8::250`

Use the result to decide whether runtime nginx can safely trust
`X-Forwarded-For` without a configurable trusted proxy list.

## Interpretation

- `headers.x-real-ip` is what the generated nginx template passed from its own
  `$remote_addr`.
- `headers.x-forwarded-for` is what nginx passed through with
  `$proxy_add_x_forwarded_for`.
- If the spoofed `203.0.113.250` value appears in the second response, raw
  `X-Forwarded-For` is client-spoofable and must not be trusted globally.
- If the spoofed `2001:db8::250` value appears in forwarded headers, raw
  forwarded header values are client-spoofable for IPv6 as well.
- Use `parsed.realIpCandidates` and `parsed.allowlistCandidates` from the normal
  request to copy the VPN egress allowlist entry. IPv4 clients produce `/32`;
  IPv6 clients produce `/128`.
- If the normal response contains the real visitor IP in a stable position and
  the spoofed value is removed or moved behind a trusted edge hop, the Java
  server can reduce config to a fixed `real_ip_header` strategy.
