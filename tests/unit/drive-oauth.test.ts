import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("desktop Drive OAuth uses loopback PKCE and rejects a mismatched callback state", async () => {
  const previousClientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const previousDataDir = process.env.FORGECY_DATA_DIR;
  const directory = mkdtempSync(join(tmpdir(), "forgecy-drive-oauth-"));
  process.env.GOOGLE_DRIVE_CLIENT_ID = "test-project.apps.googleusercontent.com";
  process.env.FORGECY_DATA_DIR = directory;
  try {
    const { beginGoogleDriveOAuth, googleDriveFlow } = await import("../../lib/sync/drive");
    const flow = await beginGoogleDriveOAuth();
    const authorization = new URL(flow.authorizationUrl);
    const redirect = new URL(authorization.searchParams.get("redirect_uri") || "");
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.equal(authorization.searchParams.get("response_type"), "code");
    assert.equal(authorization.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
    assert.equal(authorization.searchParams.get("access_type"), "offline");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.match(authorization.searchParams.get("code_challenge") || "", /^[A-Za-z0-9_-]{43}$/);
    assert.equal(redirect.hostname, "127.0.0.1");
    assert.match(redirect.port, /^\d+$/);

    const callback = await fetch(`${redirect.origin}/?state=mismatched&code=synthetic-code`);
    assert.equal(callback.status, 400);
    assert.match(await callback.text(), /Collegamento non riuscito/);
    assert.deepEqual(googleDriveFlow(flow.flowId), { status: "error", message: "Verifica OAuth non riuscita" });
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    else process.env.GOOGLE_DRIVE_CLIENT_ID = previousClientId;
    if (previousDataDir === undefined) delete process.env.FORGECY_DATA_DIR;
    else process.env.FORGECY_DATA_DIR = previousDataDir;
    rmSync(directory, { recursive: true, force: true });
  }
});
