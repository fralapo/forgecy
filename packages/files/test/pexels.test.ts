import { ForgecyError } from "@forgecy/core";
import { describe, expect, it, vi } from "vitest";
import {
  assertPexelsImageUrl,
  downloadPexelsImage,
  getPexelsPhoto,
  searchPexels,
} from "../src/pexels";

const FAKE_KEY = "fake-pexels-key-for-tests-0000";

const raw = (id: number) => ({
  id,
  url: `https://www.pexels.com/photo/${id}/`,
  photographer: "Ada Rossi",
  photographer_url: "https://www.pexels.com/@ada",
  alt: "A loaf of bread",
  width: 4000,
  height: 6000,
  avg_color: "#aa8855",
  src: {
    original: `https://images.pexels.com/photos/${id}/orig.jpeg`,
    large2x: `https://images.pexels.com/photos/${id}/l2.jpeg`,
    large: `https://images.pexels.com/photos/${id}/l.jpeg`,
    medium: `https://images.pexels.com/photos/${id}/m.jpeg`,
  },
});

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "200",
      "x-ratelimit-remaining": "187",
      "x-ratelimit-reset": "1800000000",
      ...(init.headers as Record<string, string> | undefined),
    },
    ...(init.status ? { status: init.status } : {}),
  });

const asFetch = (fn: unknown) => fn as typeof fetch;

async function rejection(p: Promise<unknown>): Promise<ForgecyError> {
  try {
    await p;
  } catch (e) {
    return e as ForgecyError;
  }
  throw new Error("expected a rejection");
}

describe("searchPexels", () => {
  it("normalises results and sends the key as a bare Authorization header", async () => {
    const f = vi.fn(async () =>
      json({ page: 1, per_page: 2, total_results: 99, photos: [raw(1), raw(2)] }),
    );
    const res = await searchPexels(
      { query: " bread ", orientation: "portrait", perPage: 2 },
      { apiKey: FAKE_KEY, fetch: asFetch(f) },
    );
    expect(res.configured).toBe(true);
    if (!res.configured) return;
    expect(res.total).toBe(99);
    expect(res.rateLimit).toEqual({ limit: 200, remaining: 187, reset: 1800000000 });
    expect(res.photos[0]).toEqual({
      id: 1,
      url: "https://www.pexels.com/photo/1/",
      photographer: "Ada Rossi",
      photographerUrl: "https://www.pexels.com/@ada",
      alt: "A loaf of bread",
      width: 4000,
      height: 6000,
      avgColor: "#aa8855",
      srcMedium: "https://images.pexels.com/photos/1/m.jpeg",
      srcLarge: "https://images.pexels.com/photos/1/l2.jpeg",
      srcOriginal: "https://images.pexels.com/photos/1/orig.jpeg",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.pexels.com/v1/search?");
    expect(url).toContain("query=bread");
    expect(url).toContain("orientation=portrait");
    expect(url).toContain("per_page=2");
    expect((init.headers as Record<string, string>).Authorization).toBe(FAKE_KEY);
    expect(url).not.toContain(FAKE_KEY);
  });

  it("drops malformed photos", async () => {
    const f = vi.fn(async () => json({ photos: [raw(1), { id: 2 }, null] }));
    const res = await searchPexels({ query: "x" }, { apiKey: FAKE_KEY, fetch: asFetch(f) });
    expect(res.configured && res.photos.map((p) => p.id)).toEqual([1]);
  });

  it("is not configured without a key and never calls the network", async () => {
    const f = vi.fn();
    for (const apiKey of [undefined, "", "   "]) {
      expect(await searchPexels({ query: "x" }, { apiKey, fetch: asFetch(f) })).toEqual({
        configured: false,
      });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("reads the key from the environment by default", async () => {
    vi.stubEnv("PEXELS_API_KEY", "");
    expect(await searchPexels({ query: "x" })).toEqual({ configured: false });
    vi.unstubAllEnvs();
  });

  it("reports a rate limit clearly", async () => {
    const f = vi.fn(async () =>
      json({}, { status: 429, headers: { "x-ratelimit-reset": "1800000123" } }),
    );
    const err = await rejection(
      searchPexels({ query: "x" }, { apiKey: FAKE_KEY, fetch: asFetch(f) }),
    );
    expect(err).toBeInstanceOf(ForgecyError);
    expect(err.ref?.key).toBe("content.errors.pexelsRateLimited");
    expect(err.details).toMatchObject({ rateLimited: true, reset: 1800000123 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries once on 5xx and gives up after that", async () => {
    const ok = vi
      .fn()
      .mockResolvedValueOnce(json({}, { status: 503 }))
      .mockResolvedValueOnce(json({ photos: [raw(1)] }));
    const res = await searchPexels({ query: "x" }, { apiKey: FAKE_KEY, fetch: asFetch(ok) });
    expect(res.configured && res.photos).toHaveLength(1);
    expect(ok).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => json({}, { status: 500 }));
    const err = await rejection(
      searchPexels({ query: "x" }, { apiKey: FAKE_KEY, fetch: asFetch(bad) }),
    );
    expect(err.code).toBe("provider_error");
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx and maps a rejected key", async () => {
    const f = vi.fn(async () => json({}, { status: 401 }));
    const err = await rejection(
      searchPexels({ query: "x" }, { apiKey: FAKE_KEY, fetch: asFetch(f) }),
    );
    expect(err.ref?.key).toBe("content.errors.pexelsKeyRejected");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("passes a timeout signal", async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ photos: [] }));
    await searchPexels({ query: "x" }, { apiKey: FAKE_KEY, fetch: asFetch(f) });
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never leaks the key in error messages, details or refs", async () => {
    const failures = [
      async () => json({}, { status: 429 }),
      async () => json({}, { status: 401 }),
      async () => json({}, { status: 404 }),
      async () => json({}, { status: 500 }),
      async () => new Response("not json", { status: 200 }),
      async () => {
        throw new Error(`socket hang up (Authorization: ${FAKE_KEY})`);
      },
    ];
    for (const fn of failures) {
      const err = await rejection(
        searchPexels({ query: "x" }, { apiKey: FAKE_KEY, fetch: asFetch(vi.fn(fn)) }),
      );
      const dump = JSON.stringify({ m: err.message, d: err.details, r: err.ref, s: String(err) });
      expect(dump).not.toContain(FAKE_KEY);
      expect(err.cause).toBeUndefined();
    }
  });

  it("does not log the key", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    await searchPexels(
      { query: "x" },
      { apiKey: FAKE_KEY, fetch: asFetch(vi.fn(async () => json({ photos: [] }))) },
    );
    await rejection(
      searchPexels(
        { query: "x" },
        { apiKey: FAKE_KEY, fetch: asFetch(vi.fn(async () => json({}, { status: 401 }))) },
      ),
    );
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(FAKE_KEY);
      s.mockRestore();
    }
  });
});

describe("getPexelsPhoto", () => {
  it("fetches one photo by id", async () => {
    const f = vi.fn(async () => json(raw(7)));
    const p = await getPexelsPhoto(7, { apiKey: FAKE_KEY, fetch: asFetch(f) });
    expect(p?.id).toBe(7);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://api.pexels.com/v1/photos/7");
  });
  it("rejects a bad id before calling out", async () => {
    const f = vi.fn();
    await expect(
      getPexelsPhoto(-1, { apiKey: FAKE_KEY, fetch: asFetch(f) }),
    ).rejects.toBeInstanceOf(ForgecyError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("image host allow-list", () => {
  it("accepts only https://images.pexels.com", () => {
    expect(assertPexelsImageUrl("https://images.pexels.com/photos/1/a.jpeg").hostname).toBe(
      "images.pexels.com",
    );
    for (const bad of [
      "http://images.pexels.com/a.jpeg",
      "https://evil.example/a.jpeg",
      "https://images.pexels.com.evil.example/a.jpeg",
      "https://user:pw@images.pexels.com/a.jpeg",
      "https://images.pexels.com:8443/a.jpeg",
      "https://127.0.0.1/a.jpeg",
      "https://api.pexels.com/v1/search",
      "not a url",
    ])
      expect(() => assertPexelsImageUrl(bad), bad).toThrow(ForgecyError);
  });

  it("refuses to download from another host without fetching", async () => {
    const f = vi.fn();
    await expect(
      downloadPexelsImage("https://evil.example/a.jpeg", { fetch: asFetch(f) }),
    ).rejects.toMatchObject({ ref: { key: "content.errors.pexelsHostNotAllowed" } });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("downloadPexelsImage caps", () => {
  const url = "https://images.pexels.com/photos/1/l2.jpeg";
  const img = (
    body: ConstructorParameters<typeof Response>[0],
    headers: Record<string, string> = {},
  ) => new Response(body, { status: 200, headers: { "content-type": "image/jpeg", ...headers } });

  it("returns the bytes and the declared type", async () => {
    const f = vi.fn(async () => img(new Uint8Array([0xff, 0xd8, 0xff, 1])));
    const r = await downloadPexelsImage(url, { fetch: asFetch(f) });
    expect(r.mime).toBe("image/jpeg");
    expect([...r.bytes]).toEqual([0xff, 0xd8, 0xff, 1]);
  });
  it("refuses a non-image content type", async () => {
    const f = vi.fn(async () => img("<html>", { "content-type": "text/html" }));
    await expect(downloadPexelsImage(url, { fetch: asFetch(f) })).rejects.toMatchObject({
      ref: { key: "content.errors.pexelsNotImage" },
    });
  });
  it("refuses a declared size over 20 MB", async () => {
    const f = vi.fn(async () => img("x", { "content-length": String(21 * 1024 * 1024) }));
    await expect(downloadPexelsImage(url, { fetch: asFetch(f) })).rejects.toMatchObject({
      ref: { key: "content.errors.pexelsTooLarge" },
    });
  });
  it("stops a stream that outgrows the cap", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(chunk);
      },
    });
    const f = vi.fn(async () => img(body));
    await expect(downloadPexelsImage(url, { fetch: asFetch(f) })).rejects.toMatchObject({
      ref: { key: "content.errors.pexelsTooLarge" },
    });
  });
});
