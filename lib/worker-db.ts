import { localDb } from "./local-db";

/** Shared local SQLite boundary used by the in-process AI worker. */
export function workerDb(){ return localDb(); }
