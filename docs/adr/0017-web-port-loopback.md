# 0017 · Web port on loopback by default

- Status: accepted
- Date: 2026-10-09

## Context

`docker-compose.yml` published the web port (`FORGECY_PORT`, default 3000) on all interfaces. Plain http on `:3000` therefore reached the app from the network without going through Caddy, so a deployment that put Caddy in front for https still had an unencrypted, unproxied way in. The sign-in throttle and the per-IP limit of Better Auth also depend on a trusted proxy (ADR 0014). Forgecy is an internal tool normally run on one machine.

## Decision

- The web port is published as `${FORGECY_BIND_ADDRESS:-127.0.0.1}:${FORGECY_PORT:-3000}:3000`. The default is loopback.
- Caddy (`--profile https`) keeps publishing 80 and 443 on all interfaces. It reaches `web:3000` over the Compose network, so it does not need the published port.
- To expose `http://host:3000` to the LAN without Caddy, set `FORGECY_BIND_ADDRESS=0.0.0.0` in `.env`. A specific address binds to that interface only.
- `pnpm forgecy health` probes the address the port is bound to when it is a specific one, and `127.0.0.1` for loopback, `0.0.0.0` and `::`. `FORGECY_WEB_HEALTH_URL` still wins.
- The worker health port was already loopback only. The dev database, Redis and Mailpit ports (`docker-compose.dev.yml`) were already on `127.0.0.1`. The optional S3 profile (`8333`) is not changed by this decision.

## Consequences

- An existing install that other machines reach on `:3000` stops being reachable after `docker compose up -d` until it uses Caddy or sets `FORGECY_BIND_ADDRESS=0.0.0.0`. The README, Upgrading, and section 7 of the security checklist say so.
- Setting `FORGECY_BIND_ADDRESS=0.0.0.0` brings back the old exposure: http, and no Caddy in front. Use it only on a network you trust.
- `FORGECY_BASE_URL` still has to match the address people type, whatever the bind address is.
- A bind address that is not on the host (for example a Docker-for-Windows address that changes) stops the web container from starting; Compose reports the bind error.
