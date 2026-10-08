import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseDotenv } from "../lib/dotenv";
import { initEnv, writeFileAtomic } from "../lib/init";
import { checkSecrets } from "../lib/secrets";
import { read } from "./helpers";

// Every test works in its own temp directory and passes explicit paths: nothing here can touch the
// repository's .env or data/.
const roots: string[] = [];
const sandbox = (env?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "forgecy-init-"));
  roots.push(dir);
  writeFileSync(join(dir, ".env.example"), read(".env.example"));
  if (env !== undefined) writeFileSync(join(dir, ".env"), env);
  return dir;
};
const envOf = (dir: string) => parseDotenv(readFileSync(join(dir, ".env"), "utf8"));
const posix = process.platform !== "win32";

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe("initEnv: new file", () => {
  it("creates .env from .env.example with secrets that pass the check", () => {
    const dir = sandbox();
    const result = initEnv(dir, { fill: false });
    expect(result).toEqual({
      created: true,
      filled: ["POSTGRES_PASSWORD", "BETTER_AUTH_SECRET", "FORGECY_ENCRYPTION_KEY"],
      passwordSkipped: false,
    });
    expect(checkSecrets(envOf(dir), { existingDatabase: false })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it.runIf(posix)("creates it with mode 0600", () => {
    const dir = sandbox();
    initEnv(dir, { fill: false });
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("refuses to touch an existing .env without --fill", () => {
    const text = "POSTGRES_PASSWORD=\n";
    const dir = sandbox(text);
    expect(() => initEnv(dir, { fill: false })).toThrow(/already exists/);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe(text);
  });

  it.each(["data/db/PG_VERSION", "data/dev-db/PG_VERSION"])(
    "does not generate a password for a database that exists (%s)",
    (marker) => {
      const dir = sandbox();
      mkdirSync(join(dir, marker, ".."), { recursive: true });
      writeFileSync(join(dir, marker), "17\n");
      const result = initEnv(dir, { fill: false });
      expect(result.passwordSkipped).toBe(true);
      expect(result.filled).toEqual(["BETTER_AUTH_SECRET", "FORGECY_ENCRYPTION_KEY"]);
      expect(envOf(dir).POSTGRES_PASSWORD).toBe("");
    },
  );
});

describe("initEnv --fill", () => {
  it("fills only the empty secrets and never changes a set one", () => {
    const dir = sandbox(
      "export FORGECY_ENCRYPTION_KEY=real\n  BETTER_AUTH_SECRET=\nPOSTGRES_PASSWORD= # later\nOTHER=1\n",
    );
    const result = initEnv(dir, { fill: true });
    expect(result.created).toBe(false);
    expect(result.filled.sort()).toEqual(["BETTER_AUTH_SECRET", "POSTGRES_PASSWORD"]);
    const env = envOf(dir);
    expect(env.FORGECY_ENCRYPTION_KEY).toBe("real");
    expect(env.OTHER).toBe("1");
    expect(env.BETTER_AUTH_SECRET).toHaveLength(43);
    expect(readFileSync(join(dir, ".env"), "utf8")).toMatch(
      /^export FORGECY_ENCRYPTION_KEY=real\n/,
    );
  });

  it("changes nothing when every secret is set", () => {
    const text = "export POSTGRES_PASSWORD=a\nBETTER_AUTH_SECRET=b\nFORGECY_ENCRYPTION_KEY=c\n";
    const dir = sandbox(text);
    expect(initEnv(dir, { fill: true }).filled).toEqual([]);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe(text);
  });

  it("skips POSTGRES_PASSWORD when a database exists", () => {
    const dir = sandbox("POSTGRES_PASSWORD=\nBETTER_AUTH_SECRET=\n");
    mkdirSync(join(dir, "data/db"), { recursive: true });
    writeFileSync(join(dir, "data/db/PG_VERSION"), "17\n");
    const result = initEnv(dir, { fill: true });
    expect(result.passwordSkipped).toBe(true);
    expect(envOf(dir).POSTGRES_PASSWORD).toBe("");
    expect(envOf(dir).BETTER_AUTH_SECRET).toHaveLength(43);
  });

  it.runIf(posix)("replaces a 0644 file with a 0600 one and leaves no temp file", () => {
    const dir = sandbox("BETTER_AUTH_SECRET=\n");
    chmodSync(join(dir, ".env"), 0o644);
    initEnv(dir, { fill: true });
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("initEnv --fill with blank-valued keys (Node's parser would swallow the next line)", () => {
  it("keeps a real key that follows `KEY= `, and reports only what changed", () => {
    for (const eol of ["\n", "\r\n"]) {
      const dir = sandbox(
        `BETTER_AUTH_SECRET= ${eol}${eol}FORGECY_ENCRYPTION_KEY=realkey${eol}POSTGRES_PASSWORD=hand${eol}`,
      );
      const result = initEnv(dir, { fill: true });
      expect(result.filled).toEqual(["BETTER_AUTH_SECRET"]);
      const env = envOf(dir);
      expect(env.FORGECY_ENCRYPTION_KEY).toBe("realkey");
      expect(env.POSTGRES_PASSWORD).toBe("hand");
      expect(env.BETTER_AUTH_SECRET).toHaveLength(43);
    }
  });

  it("fills the stock template whose POSTGRES_PASSWORD has a trailing space", () => {
    const dir = sandbox(
      read(".env.example").replace(/^POSTGRES_PASSWORD=$/m, "POSTGRES_PASSWORD= "),
    );
    const result = initEnv(dir, { fill: true });
    expect(result.filled).toContain("POSTGRES_PASSWORD");
    expect(checkSecrets(envOf(dir), { existingDatabase: false })).toEqual({
      errors: [],
      warnings: [],
    });
    expect(envOf(dir).POSTGRES_DB).toBe("forgecy");
  });

  it("writes nothing when the edit cannot be confirmed", () => {
    const text = 'NOTE="a\nBETTER_AUTH_SECRET=\nb"\n';
    const dir = sandbox(text);
    expect(() => initEnv(dir, { fill: true })).toThrow(/Cannot edit \.env safely/);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe(text);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("writeFileAtomic", () => {
  it("replaces the content, creating no leftover temp file", () => {
    const dir = sandbox();
    const file = join(dir, "target");
    writeFileSync(file, "old");
    writeFileAtomic(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("works when the target does not exist yet", () => {
    const dir = sandbox();
    const file = join(dir, "fresh");
    writeFileAtomic(file, "x");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("x");
  });

  it("leaves the original untouched and no temp file when it cannot write", () => {
    const dir = sandbox();
    const file = join(dir, "a-directory");
    mkdirSync(file); // a directory cannot be replaced by a file: rename and copy both fail
    expect(() => writeFileAtomic(file, "x")).toThrow();
    expect(statSync(file).isDirectory()).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
