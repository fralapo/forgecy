import { describe, expect, it } from "vitest";
import { createHostCheck } from "@forgecy/core/net-guard";
import { downloadImages } from "../src/mcp/client";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const image = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const hostCheck = createHostCheck(); // IP literals below: no DNS involved

function scripted(handler: (url: string) => Response) {
  const seen: string[] = [];
  const fetchImpl = (async (u: string) => {
    seen.push(u);
    return handler(u);
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe("downloadImages (MCP tool output is untrusted)", () => {
  it("never requests a URL on the local network or the metadata address", async () => {
    const { seen, fetchImpl } = scripted(() => image());
    const out = await downloadImages(
      [
        "http://169.254.169.254/latest/meta-data",
        "http://[::ffff:a9fe:a9fe]/",
        "http://127.0.0.1:3000/x.png",
      ],
      "higgsfield",
      1000,
      fetchImpl,
      hostCheck,
    );
    expect(out).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("refuses a public URL that redirects to the local network, then keeps going", async () => {
    const { seen, fetchImpl } = scripted((u) =>
      u.includes("/bounce") ? redirect("http://10.0.0.1/secret.png") : image(),
    );
    const out = await downloadImages(
      ["https://93.184.216.34/bounce.png", "https://93.184.216.34/ok.png"],
      "higgsfield",
      1000,
      fetchImpl,
      hostCheck,
    );
    expect(out).toHaveLength(1);
    expect(seen).toEqual(["https://93.184.216.34/bounce.png", "https://93.184.216.34/ok.png"]);
  });

  it("follows a safe redirect to the image", async () => {
    const { fetchImpl } = scripted((u) =>
      u.endsWith("/a") ? redirect("https://93.184.216.34/b.png") : image(),
    );
    const out = await downloadImages(
      ["https://93.184.216.34/a"],
      "higgsfield",
      1000,
      fetchImpl,
      hostCheck,
    );
    expect(out[0]?.mimeType).toBe("image/png");
  });

  it("skips non-images and bodies over the cap without buffering them", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const { fetchImpl } = scripted((u) =>
      u.endsWith("/page.html")
        ? new Response("<html>", { headers: { "content-type": "text/html" } })
        : new Response(endless, { status: 200, headers: { "content-type": "image/png" } }),
    );
    const out = await downloadImages(
      ["https://93.184.216.34/page.html", "https://93.184.216.34/huge.png"],
      "higgsfield",
      1000,
      fetchImpl,
      hostCheck,
    );
    expect(out).toEqual([]);
    expect(pulls).toBeLessThan(40); // 30 MiB cap, not the endless stream
  });

  it("skips a declared oversize body from Content-Length alone", async () => {
    const { fetchImpl } = scripted(
      () =>
        new Response(PNG, {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(31 * 1024 * 1024) },
        }),
    );
    expect(
      await downloadImages(
        ["https://93.184.216.34/x.png"],
        "higgsfield",
        1000,
        fetchImpl,
        hostCheck,
      ),
    ).toEqual([]);
  });

  it("still surfaces network errors as provider errors", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      downloadImages(["https://93.184.216.34/x.png"], "higgsfield", 1000, fetchImpl, hostCheck),
    ).rejects.toBeTruthy();
  });
});
