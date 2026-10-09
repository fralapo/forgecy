import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectSocialProfiles } from "../src/crawl";
import { parseSocialMeta, readSocialProfile, socialKindOf } from "../src/import/social";

const page = (head: string) => `<!doctype html><html><head>${head}</head><body>x</body></html>`;

describe("socialKindOf", () => {
  it("recognizes profiles on the four platforms and normalizes them", () => {
    expect(socialKindOf("https://www.instagram.com/deodue.it/")).toBe("instagram");
    expect(socialKindOf("https://instagram.com/DeoDue.it/?hl=it#x")).toBe("instagram");
    expect(socialKindOf("https://m.facebook.com/deodue")).toBe("facebook");
    expect(socialKindOf("https://fb.com/deodue")).toBe("facebook");
    expect(socialKindOf("https://www.facebook.com/profile.php?id=1000")).toBe("facebook");
    expect(socialKindOf("https://it.linkedin.com/company/deodue/")).toBe("linkedin");
    expect(socialKindOf("https://www.tiktok.com/@deodue")).toBe("tiktok");
  });

  it("refuses posts, share and intent links, feature pages and other sites", () => {
    expect(socialKindOf("https://www.instagram.com/p/Cabc123/")).toBeNull();
    expect(socialKindOf("https://www.instagram.com/explore/")).toBeNull();
    expect(socialKindOf("https://www.instagram.com/accounts/login/")).toBeNull();
    expect(socialKindOf("https://www.facebook.com/sharer/sharer.php?u=https://x.it")).toBeNull();
    expect(socialKindOf("https://www.facebook.com/sharer.php?u=x")).toBeNull();
    expect(socialKindOf("https://www.facebook.com/share/abc")).toBeNull();
    expect(socialKindOf("https://www.linkedin.com/shareArticle?url=x")).toBeNull();
    expect(socialKindOf("https://www.linkedin.com/feed/")).toBeNull();
    expect(socialKindOf("https://www.tiktok.com/@deodue/video/123")).toBeNull();
    expect(socialKindOf("https://www.tiktok.com/share?url=x")).toBeNull();
    expect(socialKindOf("https://example.com")).toBeNull();
    expect(socialKindOf("not a url")).toBeNull();
  });
});

describe("collectSocialProfiles", () => {
  it("dedupes by canonical address, drops non-profiles and keeps at most four", () => {
    const out = collectSocialProfiles([
      "https://www.instagram.com/deodue/",
      "https://instagram.com/DeoDue?hl=it",
      "https://www.instagram.com/p/abc/",
      "https://www.facebook.com/sharer/sharer.php?u=x",
      "https://www.facebook.com/deodue",
      "https://www.linkedin.com/company/deodue",
      "https://www.tiktok.com/@deodue",
      "https://www.linkedin.com/in/someone",
      "https://example.com/",
    ]);
    expect(out.map((p) => p.url)).toEqual([
      "https://www.instagram.com/deodue",
      "https://www.facebook.com/deodue",
      "https://www.linkedin.com/company/deodue",
      "https://www.tiktok.com/@deodue",
    ]);
  });
});

describe("collectSocialProfiles and people", () => {
  it("collects company, school and showcase pages but never a person's /in/ profile", () => {
    expect(
      collectSocialProfiles([
        "https://www.linkedin.com/in/jane-doe",
        "https://it.linkedin.com/in/john",
        "https://www.linkedin.com/company/deodue",
        "https://www.linkedin.com/school/uni",
        "https://www.linkedin.com/showcase/line",
      ]).map((p) => p.url),
    ).toEqual([
      "https://www.linkedin.com/company/deodue",
      "https://www.linkedin.com/school/uni",
      "https://www.linkedin.com/showcase/line",
    ]);
  });
});

describe("parseSocialMeta", () => {
  it("reads the open graph tags, decoding entities", () => {
    const meta = parseSocialMeta(
      page(`<title>DeoDue (@deodue.it) • Instagram</title>
        <meta property="og:title" content="DeoDue &amp; Co (@deodue.it)">
        <meta property="og:description" content='Deodoranti bifase &#8212; dal 1998'>
        <meta content="https://cdn.example/pic.jpg" property="og:image">`),
    );
    expect(meta).toEqual({
      title: "DeoDue & Co (@deodue.it)",
      description: "Deodoranti bifase — dal 1998",
      image: "https://cdn.example/pic.jpg",
      loginWall: false,
    });
  });

  it("falls back to the title, the meta description and the JSON-LD description", () => {
    expect(
      parseSocialMeta(
        page(`<title>Acme | LinkedIn</title><meta name="description" content="Bio">`),
      ),
    ).toMatchObject({ title: "Acme | LinkedIn", description: "Bio", loginWall: false });
    const ld = parseSocialMeta(
      page(`<title>Acme</title><script type="application/ld+json">
        {"@graph":[{"@type":"Person","name":"A","description":"Sono un fornaio"}]}</script>`),
    );
    expect(ld.description).toBe("Sono un fornaio");
  });

  it("detects a login wall in the description, in English and Italian", () => {
    const wall = (title: string, description: string) =>
      parseSocialMeta(
        page(`<title>${title}</title><meta property="og:description" content="${description}">`),
      ).loginWall;
    expect(
      wall("Instagram", "Create an account or log in to Instagram - Share what you love"),
    ).toBe(true);
    expect(wall("TikTok - Make Your Day", "Sign up to watch")).toBe(true);
    expect(wall("Facebook", "Crea un account o accedi a Facebook")).toBe(true);
    expect(wall("Forno", "Registrati o iscriviti per vedere i contenuti")).toBe(true);
    expect(wall("Forno Rossi (@forno)", "Panificio artigianale a Napoli dal 1998")).toBe(false);
  });

  it("treats a title that is only the platform, with no distinct description, as a wall", () => {
    expect(parseSocialMeta(page(`<title>Instagram</title>`)).loginWall).toBe(true);
    expect(parseSocialMeta(page(`<title>TikTok - Make Your Day</title>`)).loginWall).toBe(true);
    expect(
      parseSocialMeta(
        page(`<title>Instagram</title><meta property="og:description" content="Instagram">`),
      ).loginWall,
    ).toBe(true);
    // The platform in a title with a profile's own bio is a profile.
    expect(
      parseSocialMeta(
        page(`<title>Instagram</title><meta property="og:description" content="Forno dal 1998">`),
      ).loginWall,
    ).toBe(false);
  });

  it("detects a login wall in English and Italian titles", () => {
    expect(
      parseSocialMeta(page(`<meta property="og:title" content="Log in to Facebook">`)),
    ).toMatchObject({
      loginWall: true,
    });
    expect(parseSocialMeta(page(`<title>Accedi o registrati a Facebook</title>`)).loginWall).toBe(
      true,
    );
    expect(parseSocialMeta(page(`<title>Sign in | LinkedIn</title>`)).loginWall).toBe(true);
    expect(parseSocialMeta(page(`<title>Login • Instagram</title>`)).loginWall).toBe(true);
    expect(parseSocialMeta(page(`<title>Acme | LinkedIn</title>`)).loginWall).toBe(false);
  });
});

describe("readSocialProfile", () => {
  let server: Server;
  let base: string;
  const hits: string[] = [];
  const hostHits: string[] = [];

  const html = (res: ServerResponse, body: string, status = 200) => {
    res.writeHead(status, { "content-type": "text/html" });
    res.end(body);
  };
  const profile = (name: string) =>
    page(`<meta property="og:title" content="${name} (@${name})">
      <meta property="og:description" content="Bio of ${name}, a bakery in Naples">
      <meta property="og:image" content="/pic.jpg">`);

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const path = req.url ?? "/";
      hits.push(path);
      const host = req.headers.host ?? "";
      hostHits.push(`${host.split(":")[0]}${path}`);
      if (path === "/robots.txt")
        return html(
          res,
          host.startsWith("localhost")
            ? "User-agent: *\nDisallow: /\n"
            : "User-agent: *\nDisallow: /private\n",
        );
      if (path === "/off" || path === "/hop") {
        res.writeHead(302, { location: `http://localhost:${req.socket.localPort}/ok` });
        return res.end();
      }
      if (path === "/walltext")
        return html(
          res,
          page(
            `<title>Instagram</title><meta property="og:description" content="Create an account or log in to Instagram">`,
          ),
        );
      if (path === "/generic") return html(res, page(`<title>TikTok - Make Your Day</title>`));
      if (path === "/login-group" || path === "/company/checkpoint-systems")
        return html(res, profile("checkpoint"));
      if (path === "/ok") return html(res, profile("deodue"));
      if (path === "/private/x") return html(res, profile("hidden"));
      if (path === "/wall") return html(res, page(`<title>Log in to Facebook</title>`));
      if (path === "/to-login") {
        res.writeHead(302, { location: "/accounts/login/?next=/to-login" });
        return res.end();
      }
      if (path.startsWith("/accounts/login")) return html(res, profile("login-form-bio"));
      if (path === "/linkedin") return html(res, "Request denied", 999);
      if (path === "/missing") return html(res, "no", 404);
      if (path === "/empty") return html(res, page(``));
      if (path === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.write(`<head><meta property="og:description" content="early"></head>`);
        res.write("<!-- -->".repeat(3 * 128 * 1024));
        res.end(
          `<meta property="og:title" content="LATE"><meta name="description" content="LATE">`,
        );
        return;
      }
      if (path === "/slow") return; // never answers
      html(res, "nope", 404);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  // The test server is not a social host: only this predicate stands in for the platform check.
  const local = (u: string) => new URL(u).hostname === "127.0.0.1";
  const read = (path: string, net: Parameters<typeof readSocialProfile>[2] = {}) =>
    readSocialProfile(`${base}${path}`, undefined, {
      allowPrivate: true,
      allowHost: local,
      ...net,
    });

  it("reads title and bio as one Profile page, and resolves the picture address", async () => {
    const out = await read("/ok");
    expect(out).toEqual({
      pages: [{ locator: "Profile", text: "deodue (@deodue)\nBio of deodue, a bakery in Naples" }],
      image: `${base}/pic.jpg`,
    });
  });

  it("reads nothing a robots.txt disallows, and never requests the page", async () => {
    hits.length = 0;
    expect(await read("/private/x")).toEqual({ pages: [], partial: "robots" });
    expect(hits).toEqual(["/robots.txt"]);
  });

  it("makes one request for the profile itself", async () => {
    hits.length = 0;
    await read("/ok");
    expect(hits.filter((h) => h === "/ok")).toHaveLength(1);
  });

  it("reports a login wall from the title, a redirect to the login page, or a 999", async () => {
    expect(await read("/wall")).toEqual({ pages: [], partial: "login_wall" });
    expect(await read("/to-login")).toEqual({ pages: [], partial: "login_wall" });
    expect(await read("/linkedin")).toEqual({ pages: [], partial: "login_wall" });
  });

  it("reports an unreachable profile for an error status or a page with nothing to read", async () => {
    expect(await read("/missing")).toEqual({ pages: [], partial: "unreachable" });
    expect(await read("/empty")).toEqual({ pages: [], partial: "unreachable" });
  });

  it("reads at most 1 MB of the page", async () => {
    const out = await read("/big");
    expect(out.pages[0]!.text).toBe("early");
  });

  it("gives up on a page that never answers", async () => {
    const started = Date.now();
    expect(await read("/slow", { timeoutMs: 300 })).toEqual({ pages: [], partial: "unreachable" });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("refuses a private host unless private hosts are allowed", async () => {
    hits.length = 0;
    const out = await readSocialProfile(`${base}/ok`, undefined, {
      allowPrivate: false,
      allowHost: local,
    });
    expect(out).toEqual({ pages: [], partial: "unreachable" });
    expect(hits).toEqual([]);
  });

  it("does not take a login or checkpoint segment for a wall unless it is the whole segment", async () => {
    expect((await read("/login-group")).pages).toHaveLength(1);
    expect((await read("/company/checkpoint-systems")).pages).toHaveLength(1);
    hits.length = 0;
    expect(await read("/authwall")).toEqual({ pages: [], partial: "login_wall" });
    expect(hits).toEqual([]); // the wall is never requested
  });

  it("reports the wording of a door page, or a bare platform title, as a login wall", async () => {
    expect(await read("/walltext")).toEqual({ pages: [], partial: "login_wall" });
    expect(await read("/generic")).toEqual({ pages: [], partial: "login_wall" });
  });

  it("refuses a redirect to a host the platform check does not allow, before requesting it", async () => {
    hostHits.length = 0;
    expect(await read("/off")).toEqual({ pages: [], partial: "unreachable" });
    expect(hostHits.some((h) => h.startsWith("localhost"))).toBe(false);
  });

  it("consults robots.txt of a redirect target before requesting it", async () => {
    hostHits.length = 0;
    const out = await read("/hop", { allowHost: () => true });
    expect(out).toEqual({ pages: [], partial: "robots" });
    expect(hostHits).toContain("localhost/robots.txt");
    expect(hostHits).not.toContain("localhost/ok");
  });

  it("refuses an address that is not a profile of the source's platform, with no request", async () => {
    const requested: string[] = [];
    const stub = (async (input: string | URL) => {
      requested.push(String(input));
      return new Response("<title>x</title>");
    }) as typeof fetch;
    const hostCheck = async () => true;
    for (const [url, kind] of [
      ["https://example.com/x", "instagram"],
      ["https://www.facebook.com/x", "instagram"],
      ["https://www.instagram.com/p/abc/", "instagram"],
      ["https://www.instagram.com/deodue", "facebook"],
    ] as const)
      expect(await readSocialProfile(url, stub, { kind, hostCheck })).toEqual({
        pages: [],
        partial: "unreachable",
      });
    expect(requested).toEqual([]);
  });

  it("asks the canonical profile address, and refuses a redirect off the platform unrequested", async () => {
    const requested: string[] = [];
    const answer: Record<string, Response> = {
      "https://www.instagram.com/robots.txt": new Response("", { status: 404 }),
      "https://www.instagram.com/deodue": new Response(
        page(
          `<meta property="og:title" content="Forno"><meta property="og:description" content="Bio di un forno">`,
        ),
      ),
    };
    const stub = (async (input: string | URL) => {
      const u = String(input);
      requested.push(u);
      if (u === "https://www.instagram.com/redirect")
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/evil" },
        });
      return answer[u] ?? new Response("", { status: 404 });
    }) as typeof fetch;
    const hostCheck = async () => true;
    const ok = await readSocialProfile("https://instagram.com/DeoDue/?hl=it", stub, {
      kind: "instagram",
      hostCheck,
    });
    expect(ok.pages[0]!.text).toContain("Bio di un forno");
    expect(requested).toEqual([
      "https://www.instagram.com/robots.txt",
      "https://www.instagram.com/deodue",
    ]);

    requested.length = 0;
    expect(
      await readSocialProfile("https://www.instagram.com/redirect", stub, { hostCheck }),
    ).toEqual({
      pages: [],
      partial: "unreachable",
    });
    expect(requested.some((u) => u.includes("example.com"))).toBe(false);
  });

  it("refuses an address with credentials and other protocols", async () => {
    expect((await readSocialProfile("ftp://x.it/y")).partial).toBe("unreachable");
    expect(
      (
        await readSocialProfile(`${base.replace("http://", "http://u:p@")}/ok`, undefined, {
          allowPrivate: true,
          allowHost: local,
        })
      ).partial,
    ).toBe("unreachable");
  });
});
