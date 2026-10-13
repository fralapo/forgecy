# Run Forgecy on your own computer

Forgecy is an open-source personal project. Each person runs their own copy with their own Supabase project and API keys. There is no centrally operated Forgecy account, subscription or shared backend; you sign in through your own Supabase project. One Supabase project is enough; separate staging and production projects are optional.

The web application runs locally. Supabase provides remote Auth, PostgreSQL and private file storage; enabled AI/social integrations send requests to their providers. This setup needs internet access. Providers may charge for usage.

## 1. Install and clone

Use Node.js **22.18 or later** and npm. `.nvmrc` pins the version used in CI for nvm users; Docker is not required for the application.

```sh
git clone https://github.com/fralapo/forgecy.git
cd forgecy
# If you use nvm: nvm install && nvm use
npm install
cp .env.example .env.local
```

Keep `.env.local` untracked. On macOS/Linux you can restrict local access with `chmod 600 .env.local`. The code under `old/` is an archive, not the current installation entry point.

## 2. Initialize your Supabase project

Create a project in your own Supabase account. In its **SQL Editor**, apply every file in `supabase/migrations/` in filename order: `0001_init.sql` through `0017_ai_provider_usage.sql` (17 files at this revision). Use the repository files directly, not the old application's migrations.

The migrations create tables, owner/client RLS policies, RPCs and two **private** Storage buckets: `forgecy-sources` and `forgecy-assets`. Do not make them public. The publishable/secret API keys are not PostgreSQL passwords and cannot execute arbitrary migration SQL through the normal REST API.

For a fresh project only, you can generate a single SQL Editor script with Python 3:

```sh
python3 - <<'PY'
from pathlib import Path
files = sorted(Path('supabase/migrations').glob('*.sql'))
output = Path('.local/forgecy-initial-setup.sql')
output.parent.mkdir(exist_ok=True)
output.write_text('BEGIN;\n' + '\n'.join(
    '\n-- ' + p.name + '\n' + p.read_text() for p in files
) + '\nCOMMIT;\n')
print(output)
PY
```

Paste the generated SQL into the editor and run it once. The transaction rolls back if any statement fails. Record which migration files were applied; later upgrades must apply only new files. Do not rerun the initial script on an initialized project. Back up existing database records and files before upgrades. The `.local/` directory is ignored by Git.

**Do not run `tests/sql/bootstrap.sql` or the SQL smoke suites on this project.** They are fixtures for a disposable CI database, not installation or live-data validation scripts.

## 3. Configure local authentication and keys

In Supabase **Authentication → URL Configuration**, set your local Site URL to `http://localhost:3000` and allow this redirect:

```text
http://localhost:3000/auth/callback
```

Keep email sign-in enabled. Sign in with an address accepted by your Supabase email configuration; restrictions and rate limits of Supabase's default mail service may require custom SMTP for additional recipients. Do not disable authentication to avoid email setup.

Find the project URL in Supabase **Project Settings → Data API** (or the **Connect** dialog), and the publishable/secret keys in **Project Settings → API Keys**. Copy only your own project's values. In `.env.local`, set:

| Variable | Value / purpose |
| --- | --- |
| `APP_ORIGIN` | `http://localhost:3000` (exact origin, no final slash) |
| `NEXT_PUBLIC_SUPABASE_URL` | Your project URL, `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your `sb_publishable_…` key, or legacy anon JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | Your **private** `sb_secret_…` key, or legacy service-role JWT; worker and usage ledger only |
| `OPENROUTER_API_KEY` | Your OpenRouter key for chat, dossiers, strategies and specialist missions |
| `OPENROUTER_MODEL` | A model supporting strict JSON Schema for dossiers; default `openai/gpt-4.1-mini` |
| `OPENROUTER_SITE_URL` | `http://localhost:3000` |
| `CRON_SECRET` | A private random string of at least 24 characters protecting the dispatcher |
| `ENABLE_WEBSITE_INGEST` | Keep `false` until network isolation is configured |

Generate a cron secret locally and paste the output into `.env.local`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not put private keys into any variable beginning `NEXT_PUBLIC_`. The name `SUPABASE_SERVICE_ROLE_KEY` is retained for compatibility and accepts the current secret-key format. Do not copy secrets into issues, commits, logs, screenshots or exported reports. Restart the app and dispatcher after changing environment variables.

## 4. Start the app

```sh
npm run dev -- --hostname 127.0.0.1
```

Open **http://localhost:3000**, request the email sign-in link, and open it in the same browser that requested it (the login uses PKCE). Use `localhost` consistently; switching to `127.0.0.1` in the browser changes the cookie origin and callback configuration.

For normal use with an optimized build, stop the dev server first, then:

```sh
npm run build
npm run start -- --hostname 127.0.0.1
```

Next.js calls this a production build even when it runs on your laptop. `APP_ORIGIN=http://localhost:3000` must be set for authenticated writes in this mode. You do not need a public domain or a second database. The loopback bind keeps the server off your local network.

## 5. Run queued AI work locally

Dossiers, strategies and campaign missions queued by the UI need a dispatcher while the app is running. In a **second terminal in the repository**, run the following Node command. It reads the secret from the private env file, sends dispatcher requests sequentially and waits 15 seconds between completed requests. Ctrl+C stops it. No Vercel account, system cron installation or cloud scheduler is needed.

```sh
node --env-file=.env.local --input-type=module <<'JS'
import { setTimeout as delay } from 'node:timers/promises';
const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
const url = new URL(origin);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
  throw new Error('This example dispatcher is for a local app only.');
}
const secret = process.env.CRON_SECRET;
if (!secret || secret.length < 24) throw new Error('Set CRON_SECRET (24+ characters).');
for (;;) {
  try {
    const response = await fetch(new URL('/api/jobs/dispatch', url), {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(240_000),
      redirect: 'error',
    });
    if (response.ok) {
      const data = await response.json();
      if (data.processed) console.log(new Date().toISOString(), data.kind, data.status);
    } else {
      console.error('Dispatcher HTTP', response.status, '(check local server logs).');
    }
  } catch {
    console.error('Dispatcher cannot reach the local app or request timed out.');
  }
  await delay(15_000);
}
JS
```

The computer and both terminals must remain running. Stopping them pauses dispatch; expired leases can be recovered on a later invocation. A client-side timeout does not cancel server execution, so a later request may overlap a still-running attempt; database leases protect claims, but do not guarantee only one active job globally. Long interrupted model calls may still incur provider charges; the queue does not guarantee exactly-once billing or resume each individual agent step. See [AI_JOB_RUNNER.md](AI_JOB_RUNNER.md).

## 6. Check your installation

Start with a sample client/brand profile and text notes or a supported document:

1. Create a profile, add sources and verified products/services; search your uploaded text.
2. Queue a dossier, wait for the dispatcher, inspect evidence and approve it.
3. Generate and approve the separate company strategy.
4. Request a static campaign, inspect the agents' hand-offs and approve the proposal.
5. Edit content and inspect the downloaded PNG/PDF/TXT, especially long text and symbols.
6. Check Results → AI usage. Unknown costs stay unknown; compare usage with your provider dashboard.
7. Change a source and verify that outdated dossiers/strategy/content require review.

Without an OpenRouter key, AI fails with a configuration error; it does not generate sample answers. Without a configured dispatcher, queued jobs remain queued. Without the private Supabase key, the worker cannot execute and provider observations cannot be saved.

For code changes, run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. CI additionally uses a disposable PostgreSQL database for migrations and RLS tests. These checks do not verify your external accounts or visual exports.

## Optional integrations

- **Generated images:** add your `OPENAI_API_KEY`; default image model is `gpt-image-1`. Text/layout editing does not require it. Image token observations may have no reported USD cost.
- **Instagram:** configure your Meta app, authorized Professional account, permissions, callback variables and a 32-byte base64 `TOKEN_ENCRYPTION_KEY_BASE64`. The local callback in `.env.example` must be allowed by your Meta app. This is optional and requires Meta's setup/review rules. Expired credentials currently require reconnection. Local disconnect does not revoke Meta consent remotely.
- **Website import:** disabled by default. Code URL/DNS checks are not a substitute for public-only outbound network isolation, even on a personal computer. Use manually supplied notes/documents until that isolation is configured. See [SOURCE_INTELLIGENCE_BACKEND.md](SOURCE_INTELLIGENCE_BACKEND.md) and [CRAWL_BUDGETS.md](CRAWL_BUDGETS.md).
- **Public hosting/collaboration:** a separate decision. Configure HTTPS origin, auth callbacks, secrets, scheduler, request limits, backups and monitoring for that deployment. Organizations, billing and a client portal are not needed to run Forgecy personally.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Supabase reports `PGRST205` / table not found | Migrations were not applied to the configured project, or the API schema cache needs to refresh. |
| Writes return 503 about `APP_ORIGIN` | Set the exact local origin and restart, especially after `npm run build`/`start`. |
| Writes return 403 about origin | Open the configured hostname/port; API scripts must also send the exact `Origin` header and authenticate. |
| Magic link goes to the wrong page or cannot exchange session | Check Site URL/redirect allowlist and open the link in the requesting browser. |
| Login email is not delivered | Check Supabase email restrictions, rate limits and SMTP configuration. |
| Jobs stay queued | Start both terminals and check private Supabase key, cron secret and server errors. |
| AI returns 503 or schema errors | Set an OpenRouter key and a model supporting the required schema; check provider balance/access. |
| Usage is incomplete | Check migration 0017, server-only key and provider response usage; the panel is not a complete bill. |
| PDF differs from preview or loses symbols | Current PDF renderer has font/line limits; inspect exports before use. |

When reporting a bug, include the failing step, app revision and sanitized error text. Never attach `.env.local`, raw tokens or customer documents.
