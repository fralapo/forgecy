# @forgecy/audit

Prospect audits (M2): website reading, manually uploaded social data, competitors, channel comparison, diagnosis and 30-day plan. Every observation cites its evidence; the AI proposes, a person accepts, edits or rejects.

## Entry points

- `@forgecy/audit`: services and queries for the web app (prospects, audits, observations, competitors, social), job definitions, CSV/XLSX parsers and metrics. It does not load Chromium.
- `@forgecy/audit/handlers`: `createAuditHandlers()` for the worker, with the crawler and the AI calls.

Every service receives `(deps, actor, input)`, checks the permission with `assertCan` and writes `recordAuditEvent` in the same transaction. Agents only have `view` and `propose`: they write proposals (`status = observed`) and cannot accept or reject them.

## Jobs

| Job                         | What it does                                                           |
| --------------------------- | ---------------------------------------------------------------------- |
| `audit.crawl`               | Reads up to 10 pages (3 for a competitor), screenshots and checks      |
| `audit.analyze_site`        | Brand Analyst observations on the website                              |
| `audit.analyze_social`      | Observations on a channel from metrics, imported posts and screenshots |
| `audit.propose_competitors` | The Strategist proposes 3–5 competitors to confirm                     |
| `audit.compare_competitors` | Offer, tone and comparison observations with the confirmed competitors |
| `audit.compare_channels`    | Website, Instagram and Facebook on five criteria                       |
| `audit.diagnose`            | 3–5 problems from the accepted observations                            |
| `audit.plan`                | Pillars and 30-day plan from the accepted problems                     |

With the `no_ai` policy no AI job starts: observations and problems are written by hand.

## Evidence and confidence

The model receives references (`P1`, `CHECK:h1`, `POST:3`, `O2`…) and must cite them. `verifyEvidence` discards invented references and keeps a quote only if it appears word for word in the source. Confidence comes from the number of distinct verified items, never from the model.

## Crawler

It always respects `robots.txt` (user agent `ForgecyAudit`), skips pages behind a login, and has a timeout per page and one for the whole read. It refuses local network addresses.

| Variable                            | Effect                                                          |
| ----------------------------------- | --------------------------------------------------------------- |
| `FORGECY_CHROMIUM_PATH`             | Chromium to use; without it, HTML-only reading (no screenshots) |
| `FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS` | `true` allows websites on the local network (intranet)          |

## Social

No scraping: screenshots, CSV/XLSX exports with column mapping, or values entered by hand with source and date. The analysis sends the model up to 8 recent screenshots (reduced to JPEG, longest side 1568 px) for style, tone and calls to action; numbers come only from values and exports, never read from the images. A missing value stays "Not available". The engagement rate appears only with followers and interactions from the same source.

## Tests

`pnpm --filter @forgecy/audit test`. The service integration tests use `FORGECY_TEST_DATABASE_URL` and `FORGECY_TEST_REDIS_URL` and are skipped without them.
