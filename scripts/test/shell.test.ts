import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  configuredPostgresPassword,
  readOnlyComposeEnv,
  requireComposePassword,
} from "../lib/shell";

describe("readOnlyComposeEnv", () => {
  it("adds a placeholder password so `docker compose down|ps` pass the required-variable check", () => {
    expect(readOnlyComposeEnv({ PATH: "/bin" })).toEqual({
      PATH: "/bin",
      POSTGRES_PASSWORD: "unused",
    });
    expect(readOnlyComposeEnv({ POSTGRES_PASSWORD: "" }).POSTGRES_PASSWORD).toBe("unused");
  });

  it("keeps a password the shell already sets and does not modify its input", () => {
    const base = { POSTGRES_PASSWORD: "from-shell", HOME: "/h" };
    expect(readOnlyComposeEnv(base)).toEqual(base);
    const empty = {};
    readOnlyComposeEnv(empty);
    expect(empty).toEqual({});
  });
});

describe("configuredPostgresPassword / requireComposePassword", () => {
  const dir = mkdtempSync(join(tmpdir(), "forgecy-shell-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = (text?: string) => {
    const file = join(dir, `env-${Math.random().toString(36).slice(2)}`);
    if (text !== undefined) writeFileSync(file, text);
    return file;
  };

  it("reads the real value, not the placeholder: shell wins over .env", () => {
    expect(
      configuredPostgresPassword(
        { POSTGRES_PASSWORD: "shell" },
        envFile("POSTGRES_PASSWORD=file\n"),
      ),
    ).toBe("shell");
    expect(configuredPostgresPassword({}, envFile("POSTGRES_PASSWORD=file\n"))).toBe("file");
  });

  it("is empty when nothing sets it, including a blank value followed by another key", () => {
    expect(configuredPostgresPassword({}, envFile())).toBe("");
    expect(configuredPostgresPassword({}, envFile("A=1\n"))).toBe("");
    expect(
      configuredPostgresPassword({}, envFile("POSTGRES_PASSWORD= \nPOSTGRES_DB=forgecy\n")),
    ).toBe("");
  });

  it("stops with an actionable message instead of a dead end", () => {
    expect(() => requireComposePassword("")).toThrow(/POSTGRES_PASSWORD=forgecy.*Upgrading/);
    expect(() => requireComposePassword("")).not.toThrow(/init/);
    expect(() => requireComposePassword("x")).not.toThrow();
  });
});
