import { describe, expect, it } from "vitest";
import { checkSecrets, emptyKeys, fillEnv, generateSecrets } from "../lib/secrets";
import { read } from "./helpers";

const good = { POSTGRES_PASSWORD: "Zr3-9_kLmQ.x7Tt", BETTER_AUTH_SECRET: "s".repeat(32) };

describe("checkSecrets", () => {
  it("accepts a generated password and secret", () => {
    expect(checkSecrets(good, { existingDatabase: false })).toEqual({ errors: [], warnings: [] });
  });

  it("refuses an empty or missing password", () => {
    for (const POSTGRES_PASSWORD of ["", undefined]) {
      const { errors } = checkSecrets({ ...good, POSTGRES_PASSWORD }, { existingDatabase: false });
      expect(errors.join()).toMatch(/POSTGRES_PASSWORD is empty/);
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
    },
  );

  it("only warns when a database already exists", () => {
    const r = checkSecrets({ ...good, POSTGRES_PASSWORD: "forgecy" }, { existingDatabase: true });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/guessable/);
  });

  it.each(["p@ss", "a:b", "a/b", "a b", "100%", "a$b", "a#b", "a'b", 'a"b'])(
    "refuses %j, which would break the DATABASE_URL or the .env parsing",
    (password) => {
      const r = checkSecrets({ ...good, POSTGRES_PASSWORD: password }, { existingDatabase: false });
      expect(r.errors.join()).toMatch(/letters, digits/);
    },
  );

  it("requires a 32-character auth secret", () => {
    const r = checkSecrets({ ...good, BETTER_AUTH_SECRET: "short" }, { existingDatabase: false });
    expect(r.errors.join()).toMatch(/BETTER_AUTH_SECRET/);
    const missing = checkSecrets(
      { POSTGRES_PASSWORD: good.POSTGRES_PASSWORD },
      {
        existingDatabase: false,
      },
    );
    expect(missing.errors.join()).toMatch(/BETTER_AUTH_SECRET/);
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
