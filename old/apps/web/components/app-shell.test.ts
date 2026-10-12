import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Mirrors the `nav` hrefs in ./app-shell.tsx (kept as plain data here, not imported, because
// vitest can't parse this project's .tsx files — Next owns their JSX transform, and
// tsconfig.json sets `"jsx": "preserve"` for it).
//
// Each href must have a page under app/(app), or it loses the shell (sidebar, nav, sign-out)
// and the user is stuck with no way back — see /design.
const NAV_HREFS = [
  "/",
  "/clients",
  "/audit",
  "/products",
  "/templates",
  "/brand",
  "/content",
  "/social",
  "/agents",
  "/automations",
  "/settings",
  "/design",
];

describe("app shell navigation", () => {
  const appDir = path.join(__dirname, "..", "app", "(app)");

  it.each(NAV_HREFS)("%s has a page inside app/(app)", (href) => {
    const segment = href === "/" ? "" : href.slice(1);
    const pageDir = path.join(appDir, segment);
    const hasPage =
      existsSync(path.join(pageDir, "page.tsx")) || existsSync(path.join(pageDir, "page.ts"));
    expect(hasPage).toBe(true);
  });
});
