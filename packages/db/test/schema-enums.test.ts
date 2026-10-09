import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { budgetScopes, connectionScopes } from "@forgecy/core";
import { describe, expect, it } from "vitest";
import { connectionScopeEnum, scopeEnum } from "../src/schema/enums";

const dir = fileURLToPath(new URL("../src/schema/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

describe("db schema enums", () => {
  it.each(files)("%s takes every enum from @forgecy/core", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    // pgEnum("name", [ ...inline literal ]) and text("col", { enum: [ ...inline literal ] })
    const inline = [...source.matchAll(/pgEnum\(\s*"[^"]+"\s*,\s*\[|\benum:\s*\[/g)].map(
      (m) => m[0],
    );
    expect(inline).toEqual([]);
  });

  it("keeps the Postgres enums equal to the core lists", () => {
    expect(scopeEnum.enumValues).toEqual([...budgetScopes]);
    expect(connectionScopeEnum.enumValues).toEqual([...connectionScopes]);
  });
});
