import { describe, expect, it } from "vitest";
import {
  createHostCheck,
  guardedFetch,
  GuardedFetchError,
  readCapped,
  readTextCapped,
} from "../src/net-guard";

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

function scripted(handler: (url: string) => Response) {
  const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return handler(url);
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

// IP-literal hosts only: createHostCheck never touches DNS for them.
const hostCheck = createHostCheck();
const PUBLIC = "https://93.184.216.34";

describe("guardedFetch", () => {
  it("refuses a redirect to a hex-mapped metadata address on the hop that points at it", async () => {
    const { seen, fetchImpl } = scripted((u) =>
      u.startsWith(PUBLIC)
        ? redirect("http://[::ffff:a9fe:a9fe]/latest/meta-data")
        : new Response("secret"),
    );
    await expect(
      guardedFetch(`${PUBLIC}/robots.txt`, { hostCheck, fetchImpl }),
    ).rejects.toMatchObject({
      name: "GuardedFetchError",
      reason: "blocked",
    });
    expect(seen.map((s) => s.url)).toEqual([`${PUBLIC}/robots.txt`]); // the private hop was never requested
  });

  it("refuses a first URL that is private, and non-http(s) Location targets", async () => {
    const { seen, fetchImpl } = scripted(() => redirect("file:///etc/passwd"));
    await expect(
      guardedFetch("http://127.0.0.1/", { hostCheck, fetchImpl }),
    ).rejects.toBeInstanceOf(GuardedFetchError);
    await expect(guardedFetch(`${PUBLIC}/x`, { hostCheck, fetchImpl })).rejects.toMatchObject({
      reason: "blocked",
    });
    expect(seen.map((s) => s.url)).toEqual([`${PUBLIC}/x`]);
  });

  it("follows safe redirects, resolves relative Location, reports the final URL", async () => {
    const { seen, fetchImpl } = scripted((u) =>
      u.endsWith("/a")
        ? redirect("/b")
        : u.endsWith("/b")
          ? redirect(`${PUBLIC}/c`, 301)
          : new Response("ok"),
    );
    const out = await guardedFetch(`${PUBLIC}/a`, { hostCheck, fetchImpl });
    expect(await out.res.text()).toBe("ok");
    expect(out.url).toBe(`${PUBLIC}/c`);
    expect(seen.map((s) => s.url)).toEqual([`${PUBLIC}/a`, `${PUBLIC}/b`, `${PUBLIC}/c`]);
    for (const s of seen) expect(s.init?.redirect).toBe("manual");
  });

  it("stops after maxHops redirects", async () => {
    const { seen, fetchImpl } = scripted(() => redirect("/loop"));
    await expect(
      guardedFetch(`${PUBLIC}/loop`, { hostCheck, fetchImpl, maxHops: 3 }),
    ).rejects.toMatchObject({ reason: "too_many_redirects" });
    expect(seen).toHaveLength(4); // the first request plus 3 followed redirects
  });

  it("passes headers through and one abort signal for every hop", async () => {
    const { seen, fetchImpl } = scripted((u) =>
      u.endsWith("/a") ? redirect("/b") : new Response("ok"),
    );
    await guardedFetch(`${PUBLIC}/a`, { hostCheck, fetchImpl, headers: { "user-agent": "t" } });
    expect(seen[0]!.init?.headers).toEqual({ "user-agent": "t" });
    expect(seen[1]!.init?.signal).toBe(seen[0]!.init?.signal);
  });

  it("lets network errors through untouched", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(guardedFetch(`${PUBLIC}/`, { hostCheck, fetchImpl })).rejects.toThrow(
      "fetch failed",
    );
  });
});

describe("readCapped", () => {
  it("stops reading an endless body at the cap and cancels the stream", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(64 * 1024).fill(97));
      },
      cancel() {
        cancelled = true;
      },
    });
    const out = await readCapped(new Response(body), 100_000);
    expect(out.truncated).toBe(true);
    expect(out.bytes.byteLength).toBe(100_000);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });

  it("returns small bodies whole", async () => {
    expect(await readTextCapped(new Response("hello"), 1000)).toBe("hello");
    const out = await readCapped(new Response("hello"), 5);
    expect(out).toMatchObject({ truncated: false });
    expect(out.bytes.byteLength).toBe(5);
  });

  it("handles a response without a body", async () => {
    expect(await readCapped(new Response(null, { status: 204 }), 10)).toMatchObject({
      truncated: false,
    });
  });
});
