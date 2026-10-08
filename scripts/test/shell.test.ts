import { describe, expect, it } from "vitest";
import { readOnlyComposeEnv } from "../lib/shell";

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
