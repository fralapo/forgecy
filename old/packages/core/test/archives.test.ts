import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pdfWithPages, tarGz, zipArchive } from "../src/testing/archives";

describe("zipArchive", () => {
  it("writes a central directory with the declared (lying) size and the symlink mode", () => {
    const zip = zipArchive([
      { name: "a.txt", data: "hello", declaredSize: 99 },
      { name: "link", data: "/etc/passwd", unixMode: 0o120777 },
    ]);
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
    const cd = zip.readUInt32LE(eocd + 16);
    expect(zip.readUInt32LE(cd)).toBe(0x02014b50);
    expect(zip.readUInt32LE(cd + 24)).toBe(99);
    expect(zip.subarray(cd + 46, cd + 51).toString()).toBe("a.txt");
    const second = cd + 46 + 5;
    expect((zip.readUInt32LE(second + 38) >>> 16) & 0o170000).toBe(0o120000);
  });
});

describe("tarGz", () => {
  it("writes ustar headers with a valid checksum and the right type flags", () => {
    const tar = gunzipSync(
      tarGz([
        { name: "manifest.json", data: "{}" },
        { name: "media/evil", type: "symlink", linkName: "/etc/passwd" },
      ]),
    );
    expect(tar.length % 512).toBe(0);
    const header = tar.subarray(0, 512);
    expect(header.subarray(0, 13).toString()).toBe("manifest.json");
    expect(String.fromCharCode(header[156]!)).toBe("0");
    const stored = parseInt(header.subarray(148, 154).toString(), 8);
    const copy = Buffer.from(header);
    copy.fill(" ", 148, 156);
    expect(copy.reduce((n, b) => n + b, 0)).toBe(stored);
    const link = tar.subarray(1024, 1536);
    expect(String.fromCharCode(link[156]!)).toBe("2");
    expect(link.subarray(157, 157 + 11).toString()).toBe("/etc/passwd");
  });
});

describe("pdfWithPages", () => {
  it("claims the requested page count", () => {
    const pdf = pdfWithPages(3).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Count 3");
  });
});
