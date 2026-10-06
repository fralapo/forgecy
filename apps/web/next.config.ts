import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// In development the whole monorepo shares the root .env (Docker passes real env vars).
const rootEnv = new URL("../../.env", import.meta.url).pathname;
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // Internal packages ship TypeScript source ("just-in-time" packages).
  transpilePackages: [
    "@forgecy/carousel",
    "@forgecy/core",
    "@forgecy/db",
    "@forgecy/ai",
    "@forgecy/files",
    "@forgecy/jobs",
    "@forgecy/mail",
    "@forgecy/ui",
  ],
  serverExternalPackages: ["pg", "bullmq", "nodemailer"],
  poweredByHeader: false,
  typedRoutes: true,
};

export default nextConfig;
