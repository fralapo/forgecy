import { existsSync } from "node:fs";
import { resolve } from "node:path";

// The CLI runs from the repository root, where .env lives. Node's parser handles quotes, comments,
// `export` and CRLF; variables already set in the shell win. Nothing is printed.
const file = resolve(".env");
if (existsSync(file)) process.loadEnvFile(file);
