import { existsSync } from "node:fs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// In development the whole monorepo shares the root .env (Docker passes real env vars).
const rootEnv = new URL("../../.env", import.meta.url).pathname;
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

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
    "@forgecy/brand-book",
    "@forgecy/content",
    "@forgecy/catalog",
    "@forgecy/files",
    "@forgecy/i18n",
    "@forgecy/jobs",
    "@forgecy/mail",
    "@forgecy/ui",
  ],
  serverExternalPackages: ["pg", "bullmq", "nodemailer", "read-excel-file"],
  poweredByHeader: false,
  // Uploads through the proxy (default 10 MB): brand books up to 50 MB, product imports (ZIP) up to 200 MB.
  experimental: { proxyClientMaxBodySize: "210mb" },
  typedRoutes: true,
};

// Interface text comes from packages/i18n/messages, one folder per language (docs/I18N.md).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
