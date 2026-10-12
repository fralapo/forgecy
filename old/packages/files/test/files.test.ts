import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LocalDiskDriver,
  assertValidKey,
  contentKey,
  createStorageFromEnv,
  resolveMediaRoot,
  sha256,
  sha256Stream,
  signFileUrl,
  validateUpload,
  verifySignedFileUrl,
} from "../src";

const SECRET = "test-secret-test-secret-test-secret";

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

describe("keys", () => {
  it("rejects traversal and odd keys", () => {
    for (const bad of [
      "../x",
      "a/../b",
      "/abs",
      "a//b",
      "a/./b",
      "a\\b",
      "",
      "a/b/",
      ".hidden",
      "a/b..c",
    ]) {
      expect(() => assertValidKey(bad), bad).toThrow();
    }
    expect(() => assertValidKey("clients/123e4567/assets/abc.png")).not.toThrow();
  });

  it("builds deterministic content keys", () => {
    const sha = sha256("hello");
    expect(sha).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(contentKey({ clientId: "c1", scope: "assets", sha256: sha, ext: "png" })).toBe(
      `clients/c1/assets/${sha}.png`,
    );
    expect(contentKey({ scope: "exports", sha256: sha, ext: "zip" })).toBe(
      `system/exports/${sha}.zip`,
    );
    expect(() => contentKey({ scope: "assets", sha256: "nothex", ext: "png" })).toThrow();
    expect(() =>
      contentKey({ clientId: "../x", scope: "assets", sha256: sha, ext: "png" }),
    ).toThrow();
  });

  it("hashes streams", async () => {
    expect(await sha256Stream(Readable.from([Buffer.from("hel"), Buffer.from("lo")]))).toBe(
      sha256("hello"),
    );
  });
});

describe("LocalDiskDriver", () => {
  let root: string;
  let driver: LocalDiskDriver;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "forgecy-files-"));
    driver = new LocalDiskDriver({ root, baseUrl: "http://localhost:3000/", secret: SECRET });
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("puts, reads, heads and deletes", async () => {
    const key = "clients/c1/assets/a.txt";
    expect(await driver.exists(key)).toBe(false);
    expect(await driver.head(key)).toBeNull();
    await driver.put(key, new TextEncoder().encode("hello"), { contentType: "text/plain" });
    expect(await readFile(path.join(root, "clients/c1/assets/a.txt"), "utf8")).toBe("hello");
    expect(await readAll(await driver.get(key))).toBe("hello");
    const info = await driver.head(key);
    expect(info?.size).toBe(5);
    expect(info?.contentType).toContain("text/plain");
    await driver.put(key, Readable.from([Buffer.from("stream")]), { contentType: "text/plain" });
    expect(await readAll(await driver.get(key))).toBe("stream");
    await driver.delete(key);
    await driver.delete(key);
    expect(await driver.exists(key)).toBe(false);
    await expect(driver.get(key)).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses traversal", async () => {
    await expect(
      driver.put("../evil", new Uint8Array([1]), { contentType: "x" }),
    ).rejects.toThrow();
    expect(() => driver.resolve("a/../../etc/passwd")).toThrow();
  });

  it("signs URLs the file route can verify", async () => {
    const key = "clients/c1/exports/report.pdf";
    const url = new URL(
      await driver.signedUrl(key, {
        expiresInSeconds: 60,
        disposition: "attachment",
        filename: "Report.pdf",
      }),
    );
    expect(url.origin + url.pathname).toBe(`http://localhost:3000/api/files/${key}`);
    const p = url.searchParams;
    const opts = { disposition: p.get("disp"), filename: p.get("fn") };
    expect(verifySignedFileUrl(key, p.get("exp"), p.get("sig"), SECRET, opts)).toEqual({
      ok: true,
    });
    // tamper: other key, other secret, changed disposition, changed exp
    expect(
      verifySignedFileUrl("clients/c2/exports/report.pdf", p.get("exp"), p.get("sig"), SECRET, opts)
        .ok,
    ).toBe(false);
    expect(
      verifySignedFileUrl(key, p.get("exp"), p.get("sig"), "other-secret-other-secret", opts),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(
      verifySignedFileUrl(key, p.get("exp"), p.get("sig"), SECRET, {
        ...opts,
        disposition: "inline",
      }).ok,
    ).toBe(false);
    expect(
      verifySignedFileUrl(key, Number(p.get("exp")) + 1000, p.get("sig"), SECRET, opts).ok,
    ).toBe(false);
    expect(verifySignedFileUrl(key, null, p.get("sig"), SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects expired signatures", () => {
    const key = "system/a.png";
    const exp = Math.floor(Date.now() / 1000) - 1;
    const sig = signFileUrl(key, exp, SECRET);
    expect(verifySignedFileUrl(key, exp, sig, SECRET)).toEqual({ ok: false, reason: "expired" });
    expect(
      verifySignedFileUrl(key, exp, sig, SECRET, { now: new Date((exp - 10) * 1000) }),
    ).toEqual({ ok: true });
  });
});

describe("createStorageFromEnv", () => {
  const base = {
    MEDIA_ROOT: "/tmp/x",
    FORGECY_BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(32),
    S3_REGION: "us-east-1",
    S3_BUCKET: "forgecy",
    S3_ENDPOINT: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
    S3_FORCE_PATH_STYLE: false,
  };
  it("selects the driver", () => {
    expect(createStorageFromEnv({ ...base, STORAGE_DRIVER: "local" }).name).toBe("local");
    expect(
      createStorageFromEnv({ ...base, STORAGE_DRIVER: "s3", S3_ENDPOINT: "http://localhost:9000" })
        .name,
    ).toBe("s3");
  });
});

describe("resolveMediaRoot", () => {
  const repo = path.resolve(import.meta.dirname, "../../..");
  it("reads a relative root from the repository root, whatever the cwd", () => {
    const fromWeb = resolveMediaRoot("./data/media", path.join(repo, "apps/web"));
    const fromWorker = resolveMediaRoot("./data/media", path.join(repo, "apps/worker"));
    expect(fromWeb).toBe(path.join(repo, "data/media"));
    expect(fromWorker).toBe(fromWeb);
  });
  it("keeps absolute roots and falls back to the cwd outside a checkout", () => {
    expect(resolveMediaRoot("/data/media")).toBe("/data/media");
    // path.resolve: "/media" on Linux, "<drive>:\media" on Windows.
    expect(resolveMediaRoot("media", "/")).toBe(path.resolve("/media"));
  });
});

describe("validateUpload", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  const gif = new TextEncoder().encode("GIF89a....");
  const pdf = new TextEncoder().encode("%PDF-1.7\n");
  const ttf = new Uint8Array([0, 1, 0, 0, 0, 0x10]);
  const otf = new TextEncoder().encode("OTTO....");
  const woff2 = new TextEncoder().encode("wOF2....");
  const woff = new TextEncoder().encode("wOFF....");
  const svg = new TextEncoder().encode(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
  );

  it("accepts known images", () => {
    expect(
      validateUpload({ kind: "image", mime: "image/png", size: 100, firstBytes: png }),
    ).toMatchObject({ ok: true, ext: "png" });
    expect(
      validateUpload({ kind: "image", mime: "image/jpg", size: 100, firstBytes: jpeg }),
    ).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(
      validateUpload({ kind: "image", mime: "image/webp", size: 100, firstBytes: webp }),
    ).toMatchObject({ ok: true, ext: "webp" });
    expect(
      validateUpload({
        kind: "image",
        mime: "application/octet-stream",
        size: 100,
        firstBytes: gif,
      }),
    ).toMatchObject({ ok: true, ext: "gif" });
  });

  it("enforces the 20 MB image limit", () => {
    expect(
      validateUpload({ kind: "image", mime: "image/png", size: 20 * 1024 * 1024, firstBytes: png })
        .ok,
    ).toBe(true);
    expect(
      validateUpload({
        kind: "image",
        mime: "image/png",
        size: 20 * 1024 * 1024 + 1,
        firstBytes: png,
      }),
    ).toMatchObject({ ok: false, reason: "too_large" });
    expect(
      validateUpload({ kind: "image", mime: "image/png", size: 0, firstBytes: png }),
    ).toMatchObject({ ok: false, reason: "empty" });
  });

  it("rejects disguised files", () => {
    expect(
      validateUpload({ kind: "image", mime: "image/jpeg", size: 10, firstBytes: png }),
    ).toMatchObject({ ok: false, reason: "mime_mismatch" });
    expect(
      validateUpload({ kind: "image", mime: "image/png", size: 10, firstBytes: pdf }),
    ).toMatchObject({ ok: false, reason: "unsupported_type" });
  });

  it("allows SVG only when opted in", () => {
    expect(
      validateUpload({ kind: "image", mime: "image/svg+xml", size: 10, firstBytes: svg }).ok,
    ).toBe(false);
    expect(
      validateUpload({
        kind: "image",
        mime: "image/svg+xml",
        size: 10,
        firstBytes: svg,
        allowSvg: true,
      }),
    ).toMatchObject({ ok: true, ext: "svg" });
  });

  it("accepts only TTF, OTF, WOFF2 fonts", () => {
    expect(
      validateUpload({ kind: "font", mime: "font/ttf", size: 10, firstBytes: ttf }),
    ).toMatchObject({ ok: true, ext: "ttf" });
    expect(
      validateUpload({ kind: "font", mime: "application/octet-stream", size: 10, firstBytes: otf }),
    ).toMatchObject({ ok: true, ext: "otf" });
    expect(
      validateUpload({ kind: "font", mime: "font/woff2", size: 10, firstBytes: woff2 }),
    ).toMatchObject({ ok: true, ext: "woff2" });
    expect(
      validateUpload({ kind: "font", mime: "font/woff", size: 10, firstBytes: woff }),
    ).toMatchObject({ ok: false, reason: "unsupported_type" });
    expect(validateUpload({ kind: "font", mime: "image/png", size: 10, firstBytes: png }).ok).toBe(
      false,
    );
  });

  it("handles documents", () => {
    expect(
      validateUpload({ kind: "document", mime: "application/pdf", size: 10, firstBytes: pdf }),
    ).toMatchObject({ ok: true, ext: "pdf" });
    expect(
      validateUpload({
        kind: "document",
        mime: "text/csv; charset=utf-8",
        size: 10,
        firstBytes: new TextEncoder().encode("a,b\n1,2"),
      }),
    ).toMatchObject({ ok: true, ext: "csv" });
    expect(
      validateUpload({
        kind: "document",
        mime: "text/csv",
        size: 10,
        firstBytes: new Uint8Array([0x41, 0, 0x42]),
      }).ok,
    ).toBe(false);
  });
});
