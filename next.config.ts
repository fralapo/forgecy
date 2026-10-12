import type { NextConfig } from "next";
const config: NextConfig = { serverExternalPackages: ["undici","cheerio","ipaddr.js"], poweredByHeader: false };
export default config;