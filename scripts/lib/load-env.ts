import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCliEnv } from "./cli-env";

// The CLI runs from the repository root, where .env lives. Only the keys the CLI reads are
// loaded (see cli-env.ts); variables already set in the shell win. Nothing is printed.
const file = resolve(".env");
if (existsSync(file))
  Object.assign(process.env, parseCliEnv(readFileSync(file, "utf8"), process.env));
