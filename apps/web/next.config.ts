import { existsSync } from "node:fs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// In development the whole monorepo shares the root .env (Docker passes real env vars).
const rootEnv = new URL("../../.env", import.meta.url).pathname;
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Baseline response headers for every page and API route. /render (own CSP, framed by the editor) and
// /api/files (own per-type headers) are excluded: a second Content-Security-Policy would intersect with theirs.
// ponytail: no script-src. A nonce CSP makes every page dynamic (Next guide) and needs the proxy; add it as its own change.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  ...(process.env.FORGECY_BASE_URL?.startsWith("https://")
    ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }]
    : []),
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // Internal packages ship TypeScript source ("just-in-time" packages).
  transpilePackages: [
    "@forgecy/audit",
    "@forgecy/backup",
    "@forgecy/carousel",
    "@forgecy/core",
    "@forgecy/db",
    "@forgecy/ai",
    "@forgecy/brand",
    "@forgecy/automations",
    "@forgecy/client-transfer",
    "@forgecy/brand-book",
    "@forgecy/content",
    "@forgecy/catalog",
    "@forgecy/files",
    "@forgecy/i18n",
    "@forgecy/jobs",
    "@forgecy/mail",
    "@forgecy/social",
    "@forgecy/ui",
  ],
  serverExternalPackages: ["pg", "bullmq", "nodemailer", "read-excel-file"],
  poweredByHeader: false,
  // Uploads through the proxy (default 10 MB): brand books up to 50 MB, product imports (ZIP) up to 200 MB.
  experimental: { proxyClientMaxBodySize: "210mb" },
  typedRoutes: true,
  async headers() {
    return [{ source: "/((?!render/|api/files/).*)", headers: securityHeaders }];
  },
};

// Interface text comes from packages/i18n/messages, one folder per language (docs/I18N.md).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
