import { describe, expect, it } from "vitest";
import { parseCliEnv } from "../lib/cli-env";

describe("parseCliEnv", () => {
  it("copies the keys the CLI reads", () => {
    expect(
      parseCliEnv(
        "FORGECY_PORT=8080\nFORGECY_WORKER_HEALTH_PORT=9001\nPOSTGRES_USER=agency\nMEDIA_ROOT=/m\n",
        {},
      ),
    ).toEqual({
      FORGECY_PORT: "8080",
      FORGECY_WORKER_HEALTH_PORT: "9001",
      POSTGRES_USER: "agency",
      MEDIA_ROOT: "/m",
    });
  });

  it("keeps a value that contains =", () => {
    expect(parseCliEnv("DATABASE_URL=postgres://u:p@h/db?sslmode=require\n", {})).toEqual({
      DATABASE_URL: "postgres://u:p@h/db?sslmode=require",
    });
  });

  it("keeps # inside quotes and drops a trailing comment", () => {
    expect(parseCliEnv('FORGECY_DATA_DIR="/d#1"\nMEDIA_ROOT=/m # note\n', {})).toEqual({
      FORGECY_DATA_DIR: "/d#1",
      MEDIA_ROOT: "/m",
    });
  });

  it("accepts an empty value, `export`, single quotes and CRLF", () => {
    expect(
      parseCliEnv("# c\r\nexport FORGECY_PORT='8080'\r\nPOSTGRES_DB=\r\nMEDIA_ROOT=/m\r\n", {}),
    ).toEqual({ FORGECY_PORT: "8080", POSTGRES_DB: "", MEDIA_ROOT: "/m" });
  });

  it("strips a leading BOM", () => {
    expect(parseCliEnv("﻿FORGECY_PORT=8080\n", {})).toEqual({ FORGECY_PORT: "8080" });
  });

  it("reads FORGECY_BIND_ADDRESS, which health needs to find the web port", () => {
    expect(parseCliEnv("FORGECY_BIND_ADDRESS=0.0.0.0\n", {})).toEqual({
      FORGECY_BIND_ADDRESS: "0.0.0.0",
    });
  });

  it("reads FORGECY_RESTORE_DATABASE_URL, which `restore` connects with (ADR 0018)", () => {
    const url = "postgres://forgecy_restore:p@localhost:5432/forgecy";
    expect(parseCliEnv(`FORGECY_RESTORE_DATABASE_URL=${url}\n`, {})).toEqual({
      FORGECY_RESTORE_DATABASE_URL: url,
    });
  });

  it("lets a real environment variable beat the file, even an empty one", () => {
    expect(
      parseCliEnv("FORGECY_PORT=8080\nMEDIA_ROOT=/m\n", { FORGECY_PORT: "1", MEDIA_ROOT: "" }),
    ).toEqual({});
  });

  it("copies only allowlisted keys: no secrets reach child processes", () => {
    const text = [
      "OPENROUTER_API_KEY=sk-secret",
      "POSTGRES_PASSWORD=hunter2",
      "BETTER_AUTH_SECRET=x",
      "FORGECY_PORT=8080",
    ].join("\n");
    expect(parseCliEnv(text, {})).toEqual({ FORGECY_PORT: "8080" });
  });

  it("does not copy a value Compose would interpolate differently ($)", () => {
    // Compose turns `$$` into `$`; a shell variable would hide that from `docker compose`.
    expect(parseCliEnv("POSTGRES_USER=pa$$w\nPOSTGRES_DB=ok\n", {})).toEqual({ POSTGRES_DB: "ok" });
    // Not interpolated by Compose, so the raw value is what the CLI should use.
    expect(parseCliEnv("DATABASE_URL=postgres://u:pa$$w@h/db\n", {})).toEqual({
      DATABASE_URL: "postgres://u:pa$$w@h/db",
    });
  });
});
