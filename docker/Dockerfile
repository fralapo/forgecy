# syntax=docker/dockerfile:1.7
# One Dockerfile, three targets: `web` (Next.js standalone), `worker` and `migrate`.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/audit/package.json packages/audit/
COPY packages/carousel/package.json packages/carousel/
COPY packages/brand/package.json packages/brand/
COPY packages/content/package.json packages/content/
COPY packages/brand-guard/package.json packages/brand-guard/
COPY packages/catalog/package.json packages/catalog/
COPY packages/files/package.json packages/files/
COPY packages/jobs/package.json packages/jobs/
COPY packages/mail/package.json packages/mail/
COPY packages/ui/package.json packages/ui/
# Optional extra CA bundle for networks behind a TLS-inspecting proxy:
#   docker build --secret id=extra-ca,src=/path/to/ca.pem ...
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=secret,id=extra-ca,required=false \
    if [ -f /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi; \
    pnpm install --frozen-lockfile

FROM deps AS workspace
COPY . .

FROM workspace AS web-build
# Build-time placeholders only; real values come from the runtime environment.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime
RUN pnpm --filter @forgecy/web build

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=workspace --chown=node:node /app/templates ./templates
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# Runs TypeScript sources with tsx on Playwright's image, which ships Chromium and its
# system libraries. Keep the tag equal to playwright-core in packages/carousel/package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS worker
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
# uid 1000 (`ubuntu` here, `node` in the web image): web and worker share ./data/media.
COPY --from=workspace --chown=1000:1000 /app /app
USER 1000:1000
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/apps/worker
# No package manager at runtime: the image must start offline.
CMD ["node", "--import", "tsx", "src/index.ts"]

FROM workspace AS migrate
ENV NODE_ENV=production
USER node
WORKDIR /app/packages/db
CMD ["node", "--import", "tsx", "src/migrate.ts"]
