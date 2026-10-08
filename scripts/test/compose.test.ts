import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { read } from "./helpers";

interface Service {
  cap_add?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  environment?: Record<string, string>;
  ports?: string[];
}

// merge: true resolves the `<<: [*app-env, *hardened]` anchors the file uses.
const load = (file: string) =>
  (parse(read(file), { merge: true }) as { services: Record<string, Service> }).services;

const main = load("docker-compose.yml");
const dev = load("docker-compose.dev.yml");
const NO_NEW_PRIVILEGES = "no-new-privileges:true";

describe("docker-compose.yml hardening", () => {
  it.each(["postgres", "redis", "data-init", "migrate", "web", "worker", "mailpit", "s3", "caddy"])(
    "%s cannot gain privileges",
    (name) => {
      expect(main[name]?.security_opt).toContain(NO_NEW_PRIVILEGES);
    },
  );

  it.each(["migrate", "web", "worker"])("%s runs without Linux capabilities", (name) => {
    expect(main[name]?.cap_drop).toEqual(["ALL"]);
    expect(main[name]?.cap_add).toBeUndefined();
  });

  it("data-init keeps CHOWN and DAC_OVERRIDE for mkdir/chown as root (FOWNER is harmless)", () => {
    expect(main["data-init"]?.cap_drop).toEqual(["ALL"]);
    expect(main["data-init"]?.cap_add?.slice().sort()).toEqual(["CHOWN", "DAC_OVERRIDE", "FOWNER"]);
  });

  it("Caddy keeps only what it needs: bind ports 80 and 443, write its CA under ./data", () => {
    expect(main.caddy?.cap_drop).toEqual(["ALL"]);
    expect(main.caddy?.cap_add?.slice().sort()).toEqual(["DAC_OVERRIDE", "NET_BIND_SERVICE"]);
  });

  it("passes FORGECY_HOSTNAME to Caddy with the same default as the Caddyfile", () => {
    expect(main.caddy?.environment?.FORGECY_HOSTNAME).toBe("${FORGECY_HOSTNAME:-forgecy.local}");
    expect(read("docker/Caddyfile")).toContain("{$FORGECY_HOSTNAME:forgecy.local}");
  });

  it("Caddy sends Strict-Transport-Security (the Next.js image never does)", () => {
    expect(read("docker/Caddyfile")).toMatch(
      /^\s*header Strict-Transport-Security "max-age=\d{7,}"$/m,
    );
  });

  it("publishes neither the database nor the queue", () => {
    expect(main.postgres?.ports).toBeUndefined();
    expect(main.redis?.ports).toBeUndefined();
  });

  it("publishes Mailpit on loopback only", () => {
    expect(main.mailpit?.ports?.length).toBeGreaterThan(0);
    for (const port of main.mailpit?.ports ?? []) expect(port).toMatch(/^127\.0\.0\.1:/);
  });
});

describe("worker health reachability", () => {
  it("publishes /health on loopback only, so `pnpm forgecy health` can reach it", () => {
    expect(main.worker?.ports).toEqual(["127.0.0.1:${FORGECY_WORKER_HEALTH_PORT:-3001}:3001"]);
  });
  it("pins the in-container port, whatever .env says", () => {
    expect(main.worker?.environment?.WORKER_HEALTH_PORT).toBe("3001");
  });
});

describe("docker-compose.dev.yml", () => {
  it.each(["postgres", "redis", "mailpit"])("publishes %s on loopback only", (name) => {
    expect(dev[name]?.ports?.length).toBeGreaterThan(0);
    for (const port of dev[name]?.ports ?? []) expect(port).toMatch(/^127\.0\.0\.1:/);
  });
});
