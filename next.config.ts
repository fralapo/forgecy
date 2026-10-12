import type { NextConfig } from "next";
const config: NextConfig = { serverExternalPackages: ["undici","cheerio","ipaddr.js","pdf-parse","@napi-rs/canvas","mammoth"], poweredByHeader: false };
export default config;