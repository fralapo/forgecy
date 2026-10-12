import { parseDotenv } from "../lib/dotenv";
import { describe, expect, it } from "vitest";
import { checkSecrets, emptyKeys, fillEnv, generateSecrets } from "../lib/secrets";
import type { GeneratedSecrets } from "../lib/secrets";
import { read } from "./helpers";

const good = { POSTGRES_PASSWORD: "Zr3-9_kLmQ.x7Tt", BETTER_AUTH_SECRET: "s".repeat(32) };

describe("checkSecrets", () => {
  it("accepts a generated password and secret", () => {
    expect(checkSecrets(good, { existingDatabase: false })).toEqual({ errors: [], warnings: [] });
  });

  it("refuses an empty or missing password and points at init --fill, not at a refusal", () => {
    for (const POSTGRES_PASSWORD of ["", undefined]) {
      const { errors } = checkSecrets({ ...good, POSTGRES_PASSWORD }, { existingDatabase: false });
      expect(errors.join()).toMatch(/POSTGRES_PASSWORD is empty/);
      expect(errors.join()).toContain("pnpm forgecy init --fill");
    }
  });

  it("tells an existing install exactly how to keep its database", () => {
    const { errors } = checkSecrets({ ...good, POSTGRES_PASSWORD: "" }, { existingDatabase: true });
    expect(errors.join()).toMatch(/POSTGRES_PASSWORD is empty/);
    expect(errors.join()).toContain("POSTGRES_PASSWORD=forgecy");
    expect(errors.join()).toMatch(/keep the current database/);
  });

  it.each(["forgecy", "change-me", "CHANGE-ME", "password", "postgres"])(
    "refuses the guessable password %j on a fresh install",
    (password) => {
      const r = checkSecrets({ ...good, POSTGRES_PASSWORD: password }, { existingDatabase: false });
      expect(r.errors.join()).toMatch(/guessable/);
      // init --fill never replaces a set value: the message must say to edit by hand.
      expect(r.errors.join()).toMatch(/by hand.*openssl rand -hex 24.*DATABASE_URL/s);
      expect(r.errors.join()).not.toContain("POSTGRES_PASSWORD=forgecy");
      expect(r.errors.join()).not.toContain("init --fill");
    },
  );

  // Main shipped POSTGRES_PASSWORD=change-me in .env.example, so most existing databases were created
  // with it: the app must keep starting, and the message must not tell them to switch to `forgecy`.
  it.each(["change-me", "forgecy"])(
    "only warns about %j when a database already exists, and says to keep it then rotate",
    (password) => {
      const r = checkSecrets({ ...good, POSTGRES_PASSWORD: password }, { existingDatabase: true });
      expect(r.errors).toEqual([]);
      expect(r.warnings.join()).toMatch(/guessable/);
      expect(r.warnings.join()).toMatch(/KEEP it for now.*rotate it.*Upgrading/);
      expect(r.warnings.join()).not.toContain("POSTGRES_PASSWORD=forgecy");
    },
  );

  it.each([
    "p@ss",
    "a:b",
    "a/b",
    "a b",
    "a\tb",
    "100%",
    "a$b",
    "a#b",
    "a'b",
    'a"b',
    "a\\b",
    "a`b",
    "a?b",
    "a[b]",
    "pässword",
  ])("refuses %j, which would break the DATABASE_URL or the .env parsing", (password) => {
    for (const existingDatabase of [false, true]) {
      const r = checkSecrets({ ...good, POSTGRES_PASSWORD: password }, { existingDatabase });
      expect(r.errors.join()).toMatch(/must not contain/);
    }
  });

  it.each([
    "Zm9vYmFy+MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=", // the tail of `openssl rand -base64 32`
    "a+b",
    "a=b==",
    "0123456789abcdef0123456789abcdef0123456789abcdef", // openssl rand -hex 24
    "a-b_c.d~e!f*g,h;i&j(k)",
  ])("accepts %j, which works in DATABASE_URL and .env today", (password) => {
    const r = checkSecrets({ ...good, POSTGRES_PASSWORD: password }, { existingDatabase: true });
    expect(r).toEqual({ errors: [], warnings: [] });
  });

  it("requires a 32-character auth secret", () => {
    const r = checkSecrets({ ...good, BETTER_AUTH_SECRET: "short" }, { existingDatabase: false });
    expect(r.errors.join()).toMatch(/BETTER_AUTH_SECRET.*by hand/);
    const missing = checkSecrets(
      { POSTGRES_PASSWORD: good.POSTGRES_PASSWORD },
      { existingDatabase: false },
    );
    expect(missing.errors.join()).toMatch(/BETTER_AUTH_SECRET.*pnpm forgecy init --fill/);
  });

  it("never prints a secret value in a message", () => {
    const r = checkSecrets(
      { POSTGRES_PASSWORD: "bad pass!", BETTER_AUTH_SECRET: "tooshort" },
      { existingDatabase: false },
    );
    expect(r.errors.join()).not.toMatch(/bad pass|tooshort/);
  });
});

describe("generateSecrets", () => {
  it("makes secrets that pass the check and differ every time", () => {
    const a = generateSecrets();
    const b = generateSecrets();
    expect(checkSecrets(a, { existingDatabase: false })).toEqual({ errors: [], warnings: [] });
    expect(a.POSTGRES_PASSWORD).not.toBe(b.POSTGRES_PASSWORD);
    expect(a.BETTER_AUTH_SECRET).not.toBe(b.BETTER_AUTH_SECRET);
    expect(Buffer.from(a.FORGECY_ENCRYPTION_KEY, "base64")).toHaveLength(32);
  });
});

const parse = (text: string) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );

describe("fillEnv", () => {
  it("fills the real .env.example so it passes the check, DATABASE_URL included", () => {
    const secrets = generateSecrets();
    const env = parse(fillEnv(read(".env.example"), secrets));
    expect(checkSecrets(env, { existingDatabase: false })).toEqual({ errors: [], warnings: [] });
    expect(env.DATABASE_URL).toBe(
      `postgres://${env.POSTGRES_USER}:${secrets.POSTGRES_PASSWORD}@localhost:5432/${env.POSTGRES_DB}`,
    );
    expect(env.FORGECY_ENCRYPTION_KEY).toBe(secrets.FORGECY_ENCRYPTION_KEY);
  });

  it(".env.example needs init: its secrets are blank, never a usable default", () => {
    expect(emptyKeys(read(".env.example")).sort()).toEqual([
      "BETTER_AUTH_SECRET",
      "FORGECY_ENCRYPTION_KEY",
      "POSTGRES_PASSWORD",
    ]);
  });

  it("keeps every other line and the CRLF line endings", () => {
    const crlf =
      "# note\r\nFORGECY_PORT=3000\r\nPOSTGRES_PASSWORD=\r\nBETTER_AUTH_SECRET=\r\nFORGECY_ENCRYPTION_KEY=\r\n";
    const out = fillEnv(crlf, generateSecrets());
    expect(out).toContain("# note\r\nFORGECY_PORT=3000\r\n");
    expect(out).not.toMatch(/\r\r|[^\r]\n/);
    expect(out.split("\r\n").length).toBe(crlf.split("\r\n").length);
  });

  it("never overwrites a value that is already set", () => {
    const text = "POSTGRES_PASSWORD=mine\nBETTER_AUTH_SECRET=\nFORGECY_ENCRYPTION_KEY='keep'\n";
    const out = parse(fillEnv(text, generateSecrets()));
    expect(out.POSTGRES_PASSWORD).toBe("mine");
    expect(out.FORGECY_ENCRYPTION_KEY).toBe("'keep'");
    expect(out.BETTER_AUTH_SECRET).toHaveLength(43);
  });

  it("treats empty quotes and a missing line as empty, and appends a missing line", () => {
    expect(emptyKeys('POSTGRES_PASSWORD=""\nBETTER_AUTH_SECRET= \n').sort()).toEqual([
      "BETTER_AUTH_SECRET",
      "FORGECY_ENCRYPTION_KEY",
      "POSTGRES_PASSWORD",
    ]);
    const out = fillEnv("A=1\r\n", generateSecrets());
    expect(out.startsWith("A=1\r\n")).toBe(true);
    expect(Object.keys(parse(out)).sort()).toEqual([
      "A",
      "BETTER_AUTH_SECRET",
      "FORGECY_ENCRYPTION_KEY",
      "POSTGRES_PASSWORD",
    ]);
  });

  it("fills only the secrets it is given", () => {
    const { BETTER_AUTH_SECRET } = generateSecrets();
    const text = "POSTGRES_PASSWORD=\nBETTER_AUTH_SECRET=\n";
    const out = parse(fillEnv(text, { BETTER_AUTH_SECRET }));
    expect(out.POSTGRES_PASSWORD).toBe("");
    expect(out.BETTER_AUTH_SECRET).toBe(BETTER_AUTH_SECRET);
  });

  it("rebuilds only a placeholder password in DATABASE_URL, keeping host and user", () => {
    const secrets = generateSecrets();
    const filled = (url: string) =>
      parse(fillEnv(`POSTGRES_PASSWORD=\nDATABASE_URL=${url}\n`, secrets)).DATABASE_URL;
    expect(filled("postgres://app:forgecy@db.lan:5432/x")).toBe(
      `postgres://app:${secrets.POSTGRES_PASSWORD}@db.lan:5432/x`,
    );
    expect(filled("postgres://app:CHANGE_ME@db.lan:5432/x")).toBe(
      `postgres://app:${secrets.POSTGRES_PASSWORD}@db.lan:5432/x`,
    );
    expect(filled("postgres://app:custom@db.lan:5432/x")).toBe(
      "postgres://app:custom@db.lan:5432/x",
    );
  });
});

// The same parser the CLI and Compose use, so these tests fail if fillEnv and the loaders disagree.
describe("fillEnv agrees with the .env parsers", () => {
  const loaded = (text: string) => parseDotenv(text);
  const fill = (text: string, only: Partial<GeneratedSecrets> = generateSecrets()) =>
    fillEnv(text, only);

  it.each([
    ["export KEY=real", "export FORGECY_ENCRYPTION_KEY=real"],
    ["indented", "  FORGECY_ENCRYPTION_KEY=real"],
    ["tab indented export", "\texport  FORGECY_ENCRYPTION_KEY=real"],
    ["space before =", "FORGECY_ENCRYPTION_KEY =real"],
    ["double quoted", 'FORGECY_ENCRYPTION_KEY="real"'],
    ["single quoted", "FORGECY_ENCRYPTION_KEY='real'"],
    ["with a trailing comment", "FORGECY_ENCRYPTION_KEY=real # note"],
  ])("never changes a set value: %s", (_name, line) => {
    for (const eol of ["\n", "\r\n"]) {
      const text = `A=1${eol}${line}${eol}POSTGRES_PASSWORD=${eol}`;
      expect(emptyKeys(text)).not.toContain("FORGECY_ENCRYPTION_KEY");
      const out = fill(text);
      expect(loaded(out).FORGECY_ENCRYPTION_KEY).toBe("real");
      expect(out).toContain(line); // not rewritten, and no second line appended
      expect(out.match(/FORGECY_ENCRYPTION_KEY/g)).toHaveLength(1);
      expect(loaded(out).POSTGRES_PASSWORD).toHaveLength(32);
    }
  });

  it("fills a key written as `export KEY=` or indented in place, keeping the prefix", () => {
    const out = fill("A=1\nexport BETTER_AUTH_SECRET=\n  POSTGRES_PASSWORD=\nB=2\n");
    expect(out).toMatch(
      /^A=1\nexport BETTER_AUTH_SECRET=\S{43}\n {2}POSTGRES_PASSWORD=\S{32}\nB=2\n/,
    );
    expect(out.match(/BETTER_AUTH_SECRET/g)).toHaveLength(1);
    expect(loaded(out).BETTER_AUTH_SECRET).toHaveLength(43);
  });

  it("treats `KEY= # note` as empty, fills it and keeps the comment", () => {
    const text = "BETTER_AUTH_SECRET= # from openssl\nPOSTGRES_PASSWORD=\n";
    expect(emptyKeys(text)).toContain("BETTER_AUTH_SECRET");
    const out = fill(text);
    expect(out).toMatch(/^BETTER_AUTH_SECRET=\S{43} # from openssl\n/);
    expect(loaded(out).BETTER_AUTH_SECRET).toHaveLength(43);
  });

  it("treats empty quotes as empty and replaces them", () => {
    for (const empty of ['""', "''"]) {
      const out = fill(`BETTER_AUTH_SECRET=${empty}\n`);
      expect(out).not.toContain(empty);
      expect(loaded(out).BETTER_AUTH_SECRET).toHaveLength(43);
    }
  });

  it("duplicate keys: the last one wins, as in the parsers, and only that one is filled", () => {
    // Last empty: fill it, leave the earlier line alone.
    let out = fill("BETTER_AUTH_SECRET=first\nX=1\nBETTER_AUTH_SECRET=\n");
    expect(out).toMatch(/^BETTER_AUTH_SECRET=first\nX=1\nBETTER_AUTH_SECRET=\S{43}\n/);
    expect(loaded(out).BETTER_AUTH_SECRET).toHaveLength(43);
    // Last set: nothing to do, whatever came before.
    const text = "BETTER_AUTH_SECRET=\nX=1\nBETTER_AUTH_SECRET=last\n";
    expect(emptyKeys(text)).not.toContain("BETTER_AUTH_SECRET");
    out = fill(text);
    expect(out).toBe(
      text.replace(/\n$/, "\n") +
        "POSTGRES_PASSWORD=" +
        loaded(out).POSTGRES_PASSWORD +
        "\nFORGECY_ENCRYPTION_KEY=" +
        loaded(out).FORGECY_ENCRYPTION_KEY +
        "\n",
    );
    expect(loaded(out).BETTER_AUTH_SECRET).toBe("last");
  });

  it("ignores a commented-out key and a similarly named one", () => {
    const out = fill(
      "# BETTER_AUTH_SECRET=old\nXBETTER_AUTH_SECRET=other\nBETTER_AUTH_SECRET_2=z\n",
    );
    expect(loaded(out).BETTER_AUTH_SECRET).toHaveLength(43);
    expect(loaded(out).XBETTER_AUTH_SECRET).toBe("other");
    expect(out).toContain("# BETTER_AUTH_SECRET=old\n");
  });

  it("keeps CRLF, comments and order when editing in place", () => {
    const text =
      "# head\r\nexport POSTGRES_PASSWORD=\r\n\r\n# mid\r\nBETTER_AUTH_SECRET=\r\nZ=9\r\n";
    const out = fill(text, {
      POSTGRES_PASSWORD: "p",
      BETTER_AUTH_SECRET: "b",
    });
    expect(out).toBe(
      "# head\r\nexport POSTGRES_PASSWORD=p\r\n\r\n# mid\r\nBETTER_AUTH_SECRET=b\r\nZ=9\r\n",
    );
  });

  it("is a no-op when every secret is set", () => {
    const text = "export POSTGRES_PASSWORD=a\n BETTER_AUTH_SECRET=b\nFORGECY_ENCRYPTION_KEY='c'\n";
    expect(emptyKeys(text)).toEqual([]);
    expect(fill(text)).toBe(text);
  });
});
