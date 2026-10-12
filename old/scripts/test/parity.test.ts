import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseDotenv } from "../lib/dotenv";
import { checkSecrets, emptyKeys, fillEnv, generateSecrets, hashInValue } from "../lib/secrets";
import { configuredPostgresPassword } from "../lib/shell";

// Where Node's parser and Compose disagree about a .env, and what the CLI does about it.

const good = { BETTER_AUTH_SECRET: "s".repeat(32) };
const check = (password: string, extra = "") => {
  const raw = `POSTGRES_PASSWORD=${password}\nBETTER_AUTH_SECRET=${good.BETTER_AUTH_SECRET}\n${extra}`;
  return checkSecrets(parseDotenv(raw), { existingDatabase: false, rawText: raw });
};

describe("N3: an unquoted # is not a comment for Compose unless a space precedes it", () => {
  it("Node cuts the value at the #, so the raw line is checked as well", () => {
    expect(parseDotenv("P=abcdefgh1234#xyz\n").P).toBe("abcdefgh1234");
  });

  it.each(["abcdefgh1234#xyz", "abcdefgh1234\t#xyz", "a#", "x#y #z"])(
    "refuses %j, whose parsed value would pass",
    (password) => {
      const { errors } = check(password);
      expect(errors.join()).toMatch(
        /POSTGRES_PASSWORD contains a # that is not preceded by a space/,
      );
      expect(errors.join()).toContain("openssl rand -hex 24");
      expect(errors.join()).not.toContain(password);
    },
  );

  it("also checks BETTER_AUTH_SECRET and the winning line only", () => {
    const raw = `POSTGRES_PASSWORD=aaaaaaaa11111111\nBETTER_AUTH_SECRET=${"s".repeat(40)}#tail\n`;
    const { errors } = checkSecrets(parseDotenv(raw), { existingDatabase: false, rawText: raw });
    expect(errors.join()).toMatch(/BETTER_AUTH_SECRET contains a #/);
    // An earlier line that is overridden does not count.
    expect(hashInValue("P=a#b\nP=ab\n", "P")).toBe(false);
    expect(hashInValue("P=ab\nP=a#b\n", "P")).toBe(true);
  });

  it.each([
    ["a comment after a space", "abcdefgh1234 # note"],
    ["a quoted value", '"abcdefgh1234"'],
    ["no hash", "abcdefgh1234"],
  ])("does not flag %s", (_n, value) => {
    expect(hashInValue(`POSTGRES_PASSWORD=${value}\n`, "POSTGRES_PASSWORD")).toBe(false);
  });

  it("is not triggered when no raw text is given", () => {
    expect(
      checkSecrets({ POSTGRES_PASSWORD: "abc12345", ...good }, { existingDatabase: false }).errors,
    ).toEqual([]);
  });
});

describe("N4: Compose accepts more than identifiers as key names", () => {
  it.each(["A.B", "A-B", "1A", "a[0]", "A_B.C-D"])(
    "a blank value for %s does not swallow the next line",
    (key) => {
      for (const eol of ["\n", "\r\n", "\r"]) {
        const text = `${key}= ${eol}POSTGRES_PASSWORD=real${eol}`;
        expect(parseDotenv(text)).toMatchObject({ [key]: "", POSTGRES_PASSWORD: "real" });
      }
    },
  );

  it("fill goes through instead of getting stuck on such a line", () => {
    const out = fillEnv("A.B= \nPOSTGRES_PASSWORD=\n", generateSecrets());
    expect(parseDotenv(out)["A.B"]).toBe("");
    expect(parseDotenv(out).POSTGRES_PASSWORD).toHaveLength(32);
  });

  it("a lone CR ends a line, as in Compose", () => {
    expect(parseDotenv("A=1\rB=2\r")).toEqual({ A: "1", B: "2" });
  });
});

describe("N5: `KEY: value` is a setting in Compose and ignored by Node", () => {
  it("counts as set for the checks and for emptyKeys", () => {
    expect(parseDotenv("FORGECY_ENCRYPTION_KEY: realkey\n").FORGECY_ENCRYPTION_KEY).toBe("realkey");
    expect(parseDotenv("  export BETTER_AUTH_SECRET:real\n").BETTER_AUTH_SECRET).toBe("real");
    expect(emptyKeys("FORGECY_ENCRYPTION_KEY: realkey\n")).not.toContain("FORGECY_ENCRYPTION_KEY");
  });

  it("is never overwritten or shadowed by fillEnv", () => {
    const text = "FORGECY_ENCRYPTION_KEY: realkey\nPOSTGRES_PASSWORD=\n";
    const out = fillEnv(text, generateSecrets());
    expect(out).toContain("FORGECY_ENCRYPTION_KEY: realkey\n");
    expect(out.match(/FORGECY_ENCRYPTION_KEY/g)).toHaveLength(1);
    expect(parseDotenv(out).FORGECY_ENCRYPTION_KEY).toBe("realkey");
  });

  it("refuses to append beside a `KEY:` line it would have to fill", () => {
    expect(() => fillEnv("BETTER_AUTH_SECRET:\n", generateSecrets())).toThrow(
      /BETTER_AUTH_SECRET is written with ':' syntax/,
    );
  });

  it("a comment that looks like KEY: is not a setting", () => {
    expect(emptyKeys("# BETTER_AUTH_SECRET: x\n")).toContain("BETTER_AUTH_SECRET");
    expect(() => fillEnv("# BETTER_AUTH_SECRET: x\n", generateSecrets())).not.toThrow();
  });

  it("does not turn URLs or values into settings", () => {
    expect(parseDotenv("U=http://x:1/y\n")).toEqual({ U: "http://x:1/y" });
  });
});

describe("N6: Node reads `x` as a quoted x, Compose keeps the backticks", () => {
  it("refuses a secret wrapped in backticks, whose parsed value would pass", () => {
    expect(parseDotenv("P=`abcdefgh1234`\n").P).toBe("abcdefgh1234");
    expect(check("`abcdefgh1234`").errors.join()).toMatch(
      /POSTGRES_PASSWORD starts with a backtick/,
    );
    const raw = `POSTGRES_PASSWORD=aaaaaaaa11111111\nBETTER_AUTH_SECRET=\`${"s".repeat(40)}\`\n`;
    const { errors } = checkSecrets(parseDotenv(raw), { existingDatabase: false, rawText: raw });
    expect(errors.join()).toMatch(/BETTER_AUTH_SECRET starts with a backtick/);
  });
});

describe("configuredPostgresPassword: a set but empty shell variable wins, as in Compose", () => {
  const dir = mkdtempSync(join(tmpdir(), "forgecy-parity-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "env");
  writeFileSync(file, "POSTGRES_PASSWORD=fromfile\n");

  it("returns the empty shell value instead of falling through to .env", () => {
    expect(configuredPostgresPassword({ POSTGRES_PASSWORD: "" }, file)).toBe("");
    expect(configuredPostgresPassword({}, file)).toBe("fromfile");
    expect(configuredPostgresPassword({ POSTGRES_PASSWORD: "sh" }, file)).toBe("sh");
  });
});
