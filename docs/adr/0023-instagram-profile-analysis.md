# 0023 · Instagram profile analysis

- Status: accepted
- Date: 2026-10-10 (amended the same day, before any release: the public source reads with a browser and is on by default, because the owner requires analysing accounts without any access)
- Refines: ADR 0022 (public pages only, `robots.txt` respected, no login) and the audit rule that social numbers are never estimated

## Context

The audit takes social numbers only from typed values or CSV/XLSX exports, and the brand import reads public pages. Agencies also need to look at a client's own Instagram profile, at competitors and at prospects: content mix, cadence, engagement, hashtags, who the brand tags, and how all of that changes over time.

Four open-source tools do parts of this (instaloader, instagram_monitor, Osintgram, Osintgraph). Their ideas are useful; their data collection is not allowed here: it logs in with a real account or lifts browser cookies, calls private mobile endpoints, harvests followers, likers and commenters, and in places profiles individuals. Three of the four are GPL-3.0.

## Decision

- **One tool, `@forgecy/social`**, with a source-agnostic model (`ProfileSnapshot`, `PostSnapshot`). Analysis, change detection, relationship edges and the competitor benchmark are pure functions over it. Every number carries its source and the date it was read; a missing value is `null`, never an estimate.
- **Sources** (adapters behind one interface):
  - `public_web`: the main source. Chromium opens the public profile the way a visitor does, with no login, no account and no stored cookies (optional cookies are declined), and reads only the profile header, the meta tags and the grid of the latest posts, then the meta tags and the time of the newest few posts (about six): caption, likes and comments as shown, exact time. It never reads comments or commenters. **On by default; `FORGECY_SOCIAL_PUBLIC_WEB=false` switches it off for the whole installation.** This is an explicit exception to ADR 0022: Instagram's terms of use and its `robots.txt` do not allow it, and the agency that leaves it on accepts that. Instagram rounds counts above about 10K, and a post whose page was not opened has no likes, comments or time of day: those stay empty.
  - `file_import`: the existing CSV/XLSX import of the audit.
  - `graph_api` (optional, off unless configured): the official Instagram Graph API Business Discovery with the agency's own Meta app (`INSTAGRAM_GRAPH_TOKEN`, `INSTAGRAM_GRAPH_USER_ID` in `.env`), for business and creator accounts. Nothing in the interface requires it.
  - A logged-out request to Instagram's JSON profile endpoint was tried and answered 429 at once, so it is not used.
- **Never built, whatever the source**: login of any kind (password, 2FA, cookies, session files), followers, followings, likers, commenters, stories, contact data (emails, phone numbers), private accounts, any profile of a private individual, inference of personal traits, media download. Only business profiles are followed; an account that turns out private is reported as private and nothing else is read.
- **Pacing and stop rules** apply to every source: request budget per run, sliding-window rate limits with jitter, retries only for rate limits and transport errors, never after a challenge, checkpoint or login wall. Those trip a circuit breaker, set the profile to `blocked` and stop everything for that source until a person resumes it.
- **Re-implementation, not copying.** The GPL tools are used for ideas only; no code or structure is copied.
- **Data**: migration `0034_social_profiles` adds `social_profiles`, `social_snapshots`, `social_posts`, `social_edges` (with `first_seen`/`last_seen`/`ended_at`) and `social_events` (append-only change log). Every read and write checks the client with `can()`.
- **AI** only through `packages/ai`, and only on computed metrics and public captions; it never produces a number.

## Consequences

- With neither the Graph API nor the public source configured, the tool still analyses imported files.
- Public-web numbers and Graph API numbers are not mixed silently: a change of source is an event and the benchmark warns when sources differ.
- The public source depends on endpoints Instagram changes without notice. They are kept in one file (`sources/endpoints.ts`); a shape change surfaces as `api_drift`, not as wrong numbers.
- Profiles are public business data, but names and captions can still be personal data: the usual retention and erasure paths of a client apply (a client's profiles are deleted with the client).

## Known limitations

- Graph API Business Discovery gives no views, no tagged accounts and no collaborators; those parts of the analysis are empty for that source.
- The public source sees the latest 12 posts at most, and opens the pages of only the newest few. Tagged accounts and collaborators are not in the grid, so the relationship view is thin for it. Instagram can show a login wall at any time: the profile is then marked stopped and a person resumes it.
- Caption similarity is lexical: the AI gateway has no embeddings path yet.

## Not covered

- Facebook, LinkedIn and TikTok profiles.
- Posting to Instagram.
