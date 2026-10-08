import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { parseDotenv } from "../lib/dotenv";
import { parseCliEnv } from "../lib/cli-env";
import { read } from "./helpers";

// What Compose (and godotenv, dotenv) do: an unquoted value is trimmed, so `KEY= ` is empty and
// never reaches into the next line. Node's util.parseEnv does not (it reads `KEY= \nNEXT=x` as
// KEY="NEXT=x"), which is what parseDotenv corrects.
describe("parseDotenv", () => {
  it.each([
    ["trailing space", "A= \nB=x\n"],
    ["trailing tab", "A=\t\nB=x\n"],
    ["several blanks", "A= \t \nB=x\n"],
    ["blank line after", "A= \n\nB=x\n"],
    ["comment line after", "A= \n# c\nB=x\n"],
    ["CRLF", "A= \r\nB=x\r\n"],
    ["export", "export A= \nB=x\n"],
    ["indented", "  A= \nB=x\n"],
    ["BOM", "\uFEFFA= \nB=x\n"],
  ])("reads KEY followed by only whitespace as empty and keeps the next line: %s", (_n, text) => {
    expect(parseDotenv(text)).toEqual({ A: "", B: "x" });
  });

  it("node alone gets this wrong (documents why the helper exists)", () => {
    expect(parseEnv("A= \nB=x\n")).toEqual({ A: "B=x" });
  });

  it("reads export<TAB>KEY like export<space>KEY", () => {
    expect(parseDotenv("export\tA=1\n")).toEqual({ A: "1" });
  });

  it("leaves everything else as node reads it", () => {
    const text = "A=1\nB=\"two words\"\nC='x' # note\nD=\nE=a b\n";
    expect(parseDotenv(text)).toEqual(parseEnv(text));
  });

  it("reads the stock .env.example with a trailing space on POSTGRES_PASSWORD", () => {
    const stock = read(".env.example").replace(/^POSTGRES_PASSWORD=$/m, "POSTGRES_PASSWORD= ");
    const env = parseDotenv(stock);
    expect(env.POSTGRES_PASSWORD).toBe("");
    expect(env.POSTGRES_DB).toBe("forgecy");
  });

  it("is what parseCliEnv uses, so a blank value cannot swallow the next key", () => {
    expect(parseCliEnv("FORGECY_PORT= \nPOSTGRES_DB=forgecy\n", {})).toEqual({
      FORGECY_PORT: "",
      POSTGRES_DB: "forgecy",
    });
  });
});
