import { describe, expect, it } from "vitest";
import { manifestText } from "../src/texts";

const meta = { client: "Acme", content: "Come scegliere", version: 2 };

describe("manifestText", () => {
  it("lists files, the caption by channel, credits and the publishing tips", () => {
    const out = manifestText(
      ["slide-1.png", "manifest.txt"],
      meta,
      {
        caption: "Una didascalia.",
        hashtags: ["a"],
        channel: "instagram",
        credits: ["Foto: Mario / Unsplash"],
      },
      "en",
    );
    expect(out).toContain("Come scegliere · version 2");
    expect(out).toContain("- slide-1.png");
    expect(out).toContain("[instagram]\nUna didascalia.\n\n#a");
    expect(out).toContain("- Foto: Mario / Unsplash");
    expect(out).toContain("within 3 hours");
    expect(out).toContain("48-72 hours");
    expect(out).toContain("60 days or more, up to 3 runs");
  });

  it("is written in the language of the deliverable", () => {
    const out = manifestText(["a.png"], meta, {}, "it");
    expect(out).toContain("versione 2");
    expect(out).toContain("Nessuna didascalia.");
    expect(out).toContain("Nessuno.");
    expect(out).toContain("entro 3 ore");
    expect(out).toContain("fino a 3 volte");
  });
});
