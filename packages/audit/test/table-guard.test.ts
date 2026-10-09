import { overlappingZip, zipArchive } from "@forgecy/core/testing/archives";
import { beforeEach, describe, expect, it, vi } from "vitest";

const parser = vi.hoisted(() => ({
  read: vi.fn(async () => [{ sheet: "Sheet1", data: [["Date"], ["2026-01-01"]] }]),
}));
vi.mock("read-excel-file/node", () => ({ default: parser.read }));

import { readTable } from "../src/social/table";

const MB = 1024 * 1024;
const rejectsUnreadable = (bytes: Uint8Array) =>
  expect(readTable(bytes, "xlsx")).rejects.toMatchObject({ message: expect.any(String) });

describe("readTable xlsx guard", { timeout: 30_000 }, () => {
  beforeEach(() => parser.read.mockClear());

  it("refuses a lying size before the parser runs", async () => {
    await rejectsUnreadable(
      zipArchive([{ name: "xl/sharedStrings.xml", data: Buffer.alloc(8 * MB), declaredSize: 10 }]),
    );
    expect(parser.read).not.toHaveBeenCalled();
  });

  it("refuses overlapping entries before the parser runs", async () => {
    await rejectsUnreadable(
      overlappingZip({
        data: Buffer.alloc(MB, 65),
        entries: 30,
        store: true,
        declaredSize: MB,
        name: (i) => `xl/worksheets/sheet${i}.xml`,
      }),
    );
    expect(parser.read).not.toHaveBeenCalled();
  });

  it("refuses a deflate bomb before the parser runs", async () => {
    await rejectsUnreadable(
      zipArchive([{ name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(21 * MB) }]),
    );
    expect(parser.read).not.toHaveBeenCalled();
  });

  it("refuses something that is not a ZIP before the parser runs", async () => {
    await rejectsUnreadable(new Uint8Array([1, 2, 3]));
    expect(parser.read).not.toHaveBeenCalled();
  });

  it("hands a legit archive to the parser", async () => {
    const xlsx = zipArchive([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "xl/workbook.xml", data: "<workbook/>" },
      { name: "xl/media/photo.png", data: Buffer.alloc(30 * MB) },
    ]);
    const table = await readTable(xlsx, "xlsx");
    expect(parser.read).toHaveBeenCalledOnce();
    expect(table.headers).toEqual(["Date"]);
  });
});
