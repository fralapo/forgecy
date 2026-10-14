import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeRequestHost, validateTailscaleOrigin } from "../../lib/tailscale-access";

test("loopback remains available locally without Tailscale configuration", () => {
  for (const hostname of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    assert.deepEqual(authorizeRequestHost({ hostname }), { allowed: true, mode: "loopback" });
  }
});

test("Tailscale Serve access requires the exact configured user identity", () => {
  const allowed = { hostname: "forgecy.tailnet.ts.net", allowedTailscaleUser: "owner@example.com", allowedTailscaleHost: "forgecy.tailnet.ts.net" };
  assert.equal(authorizeRequestHost({ ...allowed, tailscaleLogin: "OWNER@example.com" }).allowed, true);
  assert.deepEqual(authorizeRequestHost({ ...allowed }), {
    allowed: false, status: 401, error: "Accedi a Forgecy tramite Tailscale Serve.",
  });
  assert.equal(authorizeRequestHost({ ...allowed, tailscaleLogin: "other@example.com" }).allowed, false);
  assert.equal(authorizeRequestHost({ hostname: "forgecy.tailnet.ts.net", tailscaleLogin: "owner@example.com" }).allowed, false);
  assert.equal(authorizeRequestHost({ ...allowed, hostname: "other.tailnet.ts.net" }).allowed, false);
  assert.equal(authorizeRequestHost({ ...allowed, hostname: "127.0.0.1", tailscaleLogin: "owner@example.com" }).allowed, true);
});

test("only Tailscale DNS names are accepted as remote hosts", () => {
  for (const hostname of ["forgecy.example.com", "forgecy.ts.net.evil.example", "100.64.0.1"]) {
    assert.equal(authorizeRequestHost({
      hostname, tailscaleLogin: "owner@example.com", allowedTailscaleUser: "owner@example.com",
    allowedTailscaleHost: "forgecy.tailnet.ts.net",
    }).allowed, false);
  }
  assert.equal(authorizeRequestHost({
    hostname: "forgecy.tailnet.ts.net.", tailscaleLogin: "owner@example.com",
    allowedTailscaleUser: "owner@example.com", allowedTailscaleHost: "forgecy.tailnet.ts.net",
  }).allowed, true);
});

test("remote API writes accept only the same HTTPS Tailscale origin", () => {
  const host = "forgecy.tailnet.ts.net";
  assert.equal(validateTailscaleOrigin("https://" + host, host), "https://" + host);
  for (const origin of [
    "http://" + host, "https://attacker." + host, "https://" + host + ":444",
    "https://" + host + ".evil.example", "https://" + host + "/path", "null",
  ]) assert.equal(validateTailscaleOrigin(origin, host), null, origin);
});
