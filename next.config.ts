import type { NextConfig } from "next";
const allowedDevOrigins = (process.env.FORGECY_ALLOWED_DEV_ORIGINS || "")
 .split(",")
 .map((origin) => origin.trim())
 .filter(Boolean);

const config: NextConfig = {
 serverExternalPackages: ["undici","cheerio","ipaddr.js","pdf-parse","@napi-rs/canvas","mammoth","better-sqlite3","@napi-rs/keyring","@huggingface/transformers","playwright-core"],
 poweredByHeader: false,
 ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
};
export default config;
