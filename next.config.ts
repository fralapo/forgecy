import type { NextConfig } from "next";
const allowedDevOrigins = (process.env.FORGECY_ALLOWED_DEV_ORIGINS || "")
 .split(",")
 .map((origin) => origin.trim())
 .filter(Boolean);

const config: NextConfig = {
 serverExternalPackages: ["undici","cheerio","ipaddr.js","pdf-parse","@napi-rs/canvas","mammoth","better-sqlite3","@napi-rs/keyring","@huggingface/transformers"],
 poweredByHeader: false,
 // The proxy buffers incoming bodies before API routes see them. Keep this just
 // above the 64 MiB PDF limit plus multipart overhead, or large PDFs arrive truncated.
 experimental: { proxyClientMaxBodySize: "66mb" },
 ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
};
export default config;
