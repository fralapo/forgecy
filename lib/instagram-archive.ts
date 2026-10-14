/** Parse only the owner's follower-list JSON export. Names and relationships never leave the browser. */
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : null;
}

function listFrom(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  const root = object(value);
  if (!root) return null;
  for (const key of ["followers", "relationships_followers"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return null;
}

function usernameFrom(entry: unknown): string | null {
  const row = object(entry);
  if (!row) return null;
  const strings = Array.isArray(row.string_list_data) ? row.string_list_data : [];
  for (const value of strings) {
    const data = object(value);
    if (typeof data?.value === "string" && data.value.trim()) return data.value.trim();
    if (typeof data?.href === "string") {
      try {
        const parts = new URL(data.href).pathname.split("/").filter(Boolean);
        const candidate = parts.at(-1) === "_u" ? parts.at(-2) : parts.at(-1);
        if (candidate && /^[\w.]{1,30}$/.test(candidate)) return candidate;
      } catch { /* Ignore malformed profile links. */ }
    }
  }
  if (typeof row.title === "string" && /^[\w.]{1,30}$/.test(row.title.trim())) return row.title.trim();
  return null;
}

/** Return a count only when every selected file is a recognized follower-list part and parseable. */
export function countInstagramArchiveFollowers(files: Array<{ name: string; text: string }>): number {
  if (!files.length) throw new Error("Seleziona uno o più file followers_*.json dell’archivio Instagram.");
  const names = new Set<string>();
  for (const file of files) {
    if (!/^followers(?:_\d+)?\.json$/i.test(file.name.split(/[\\/]/).at(-1) || "")) {
      throw new Error("Sono accettati solo file followers.json o followers_1.json, followers_2.json…");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(file.text); }
    catch { throw new Error(`Il file ${file.name} non contiene JSON valido.`); }
    const entries = listFrom(parsed);
    if (!entries) throw new Error(`Formato non riconosciuto nel file ${file.name}.`);
    for (const entry of entries) {
      const username = usernameFrom(entry);
      if (!username) throw new Error(`Il file ${file.name} contiene voci non riconosciute: conteggio interrotto per evitare un risultato incompleto.`);
      names.add(username.toLocaleLowerCase("en-US"));
    }
  }
  if (!names.size) throw new Error("Nessun follower leggibile nei file selezionati.");
  return names.size;
}
