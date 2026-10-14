import { Entry } from "@napi-rs/keyring";
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ApiFailure } from "./http";
import { getLocalDataDirectory } from "./local-db";

const SERVICE = "Forgecy OpenRouter";
const ACCOUNT = "api-key";

function credentialPath() {
  const directory = getLocalDataDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* Windows inherits the current user's private app-data ACL. */ }
  return join(directory, "openrouter-api-key");
}

function keyringEntry() { return new Entry(SERVICE, ACCOUNT); }

function storedApiKey(): string | null {
  try {
    const value = keyringEntry().getPassword();
    if (value) return value;
  } catch { /* Use the owner-only local file when the system keyring is unavailable. */ }
  try { return readFileSync(credentialPath(), "utf8").trim() || null; }
  catch { return null; }
}

export async function getOpenRouterApiKey() {
  return storedApiKey() || process.env.OPENROUTER_API_KEY?.trim() || null;
}

export async function openRouterKeyStatus() {
  const stored = storedApiKey();
  if (stored) return { configured: true, source: "app" as const };
  if (process.env.OPENROUTER_API_KEY?.trim()) return { configured: true, source: "environment" as const };
  return { configured: false, source: null };
}

export async function saveOpenRouterApiKey(value: string) {
  let savedInKeyring = false;
  try { keyringEntry().setPassword(value); savedInKeyring = true; }
  catch { /* Headless systems may not provide Keychain/Secret Service. */ }
  const target = credentialPath();
  if (savedInKeyring) {
    try { unlinkSync(target); } catch { /* No fallback file exists. */ }
    return;
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
  try { chmodSync(temporary, 0o600); } catch { /* Windows uses the private app-data ACL. */ }
  renameSync(temporary, target);
}

export async function removeOpenRouterApiKey() {
  try { keyringEntry().deletePassword(); } catch { /* No keyring entry or unavailable system keyring. */ }
  try { unlinkSync(credentialPath()); } catch { /* No fallback file exists. */ }
}

export async function validateOpenRouterApiKey(value: string, fetcher: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await fetcher("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${value}`, "X-Title": "Forgecy" },
      signal: AbortSignal.timeout(15_000), cache: "no-store"
    });
  } catch {
    throw new ApiFailure(502, "OpenRouter non è raggiungibile. Controlla la connessione e riprova.");
  }
  if (response.status === 401 || response.status === 403)
    throw new ApiFailure(422, "OpenRouter non ha accettato questa chiave. Verifica di averla copiata correttamente.");
  if (!response.ok) throw new ApiFailure(502, "Impossibile verificare la chiave OpenRouter in questo momento.");
}
