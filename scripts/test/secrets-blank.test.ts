import { describe, expect, it } from "vitest";
import { parseDotenv } from "../lib/dotenv";
import { checkSecrets, confirmedKeys, emptyKeys, fillEnv, generateSecrets } from "../lib/secrets";
import type { GeneratedSecrets } from "../lib/secrets";
import { read } from "./helpers";

// Node's util.parseEnv reads `KEY= \nNEXT=x` as KEY="NEXT=x"; Compose reads KEY as empty. These
// tests pin fillEnv to the Compose reading (see lib/dotenv.ts) and to its own safety guard.
const fill = (text: string, only: Partial<GeneratedSecrets> = generateSecrets()) =>
  fillEnv(text, only);

describe("fillEnv with values Node's parser misreads", () => {
  it.each([
    ["trailing space", "POSTGRES_PASSWORD= \nPOSTGRES_DB=forgecy\n"],
    ["trailing tab", "POSTGRES_PASSWORD=\t\nPOSTGRES_DB=forgecy\n"],
    ["blank line after", "POSTGRES_PASSWORD= \n\nPOSTGRES_DB=forgecy\n"],
    ["CRLF", "POSTGRES_PASSWORD= \r\nPOSTGRES_DB=forgecy\r\n"],
  ])("fills an empty-with-whitespace value and keeps the next line: %s", (_n, text) => {
    expect(emptyKeys(text)).toContain("POSTGRES_PASSWORD");
    const env = parseDotenv(fill(text));
    expect(env.POSTGRES_DB).toBe("forgecy");
    expect(env.POSTGRES_PASSWORD).toHaveLength(32);
  });

  it("the stock template with a trailing space is not 'nothing to fill'", () => {
    const stock = read(".env.example").replace(/^POSTGRES_PASSWORD=$/m, "POSTGRES_PASSWORD= ");
    expect(emptyKeys(stock)).toContain("POSTGRES_PASSWORD");
    const env = parseDotenv(fill(stock));
    expect(checkSecrets(env, { existingDatabase: false })).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    [
      "trailing space",
      "BETTER_AUTH_SECRET= \nFORGECY_ENCRYPTION_KEY=realkey\n",
      "FORGECY_ENCRYPTION_KEY=realkey",
    ],
    [
      "blank line",
      "BETTER_AUTH_SECRET=\t\n\nFORGECY_ENCRYPTION_KEY=realkey\n",
      "FORGECY_ENCRYPTION_KEY=realkey",
    ],
    ["hand-set password", "BETTER_AUTH_SECRET= \nPOSTGRES_PASSWORD=x\n", "POSTGRES_PASSWORD=x"],
  ])("never overwrites the key after a blank-valued one: %s", (_n, text, kept) => {
    const out = fill(text);
    expect(out).toContain(kept);
    expect(out.split(kept.split("=")[0]!).length).toBe(2); // that key is not duplicated
    expect(parseDotenv(out)[kept.split("=")[0]!]).toBe(kept.split("=")[1]);
    expect(parseDotenv(out).BETTER_AUTH_SECRET).toHaveLength(43);
  });

  it("throws instead of returning text whose parse does not match the fill", () => {
    // The key exists only inside a multi-line quoted value: editing that line would change the
    // quoted text, not the key, so the guard must refuse.
    const text = 'NOTE="a\nBETTER_AUTH_SECRET=\nb"\n';
    expect(() => fill(text, { BETTER_AUTH_SECRET: "x".repeat(40) })).toThrow(
      /Cannot edit .env safely/,
    );
  });

  it("leaves a BETTER_AUTH_SECRET= line inside a quoted value alone when the key is set", () => {
    const text = 'NOTE="a\nBETTER_AUTH_SECRET=\nb"\nBETTER_AUTH_SECRET=realsecret\n';
    const out = fill(text);
    expect(out).toContain('NOTE="a\nBETTER_AUTH_SECRET=\nb"');
    expect(parseDotenv(out).BETTER_AUTH_SECRET).toBe("realsecret");
  });

  it("export<TAB>KEY= is read as a set key and left alone", () => {
    const text = "export\tFORGECY_ENCRYPTION_KEY=real\n";
    expect(emptyKeys(text)).not.toContain("FORGECY_ENCRYPTION_KEY");
    const out = fill(text);
    expect(out).toContain("export\tFORGECY_ENCRYPTION_KEY=real\n");
    expect(out.match(/FORGECY_ENCRYPTION_KEY/g)).toHaveLength(1);
  });

  it("fills export<TAB>KEY= when it is empty, keeping the prefix", () => {
    const out = fill("export\tBETTER_AUTH_SECRET=\n");
    expect(out).toMatch(/^export\tBETTER_AUTH_SECRET=\S{43}\n/);
    expect(parseDotenv(out).BETTER_AUTH_SECRET).toHaveLength(43);
  });

  it("rewrites the LAST DATABASE_URL, the one that wins", () => {
    const secrets = generateSecrets();
    const first = "DATABASE_URL=postgres://a:forgecy@h/x\n";
    const out = fill(
      `POSTGRES_PASSWORD=\n${first}DATABASE_URL=postgres://a:forgecy@h/y\n`,
      secrets,
    );
    expect(out).toContain(first);
    expect(parseDotenv(out).DATABASE_URL).toBe(`postgres://a:${secrets.POSTGRES_PASSWORD}@h/y`);
  });

  it.each(['"', "'"])("rebuilds a DATABASE_URL quoted with %s inside its quotes", (quote) => {
    const secrets = generateSecrets();
    const url = `${quote}postgres://a:CHANGE_ME@h/x${quote}`;
    const out = fill(`POSTGRES_PASSWORD=\nDATABASE_URL=${url}\n`, secrets);
    expect(parseDotenv(out).DATABASE_URL).toBe(`postgres://a:${secrets.POSTGRES_PASSWORD}@h/x`);
  });
});

describe("confirmedKeys", () => {
  it("lists only the secrets whose parsed value really changed", () => {
    const text = "BETTER_AUTH_SECRET= \nPOSTGRES_PASSWORD=mine\n";
    const out = fill(text);
    expect(confirmedKeys(text, out).sort()).toEqual([
      "BETTER_AUTH_SECRET",
      "FORGECY_ENCRYPTION_KEY",
    ]);
    expect(confirmedKeys(text, text)).toEqual([]);
  });
});
