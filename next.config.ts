import type { NextConfig } from "next";
const config: NextConfig = { serverExternalPackages: ["undici","cheerio","ipaddr.js","pdf-parse","@napi-rs/canvas","mammoth","better-sqlite3","@napi-rs/keyring","@huggingface/transformers"], poweredByHeader: false };
export default config;
