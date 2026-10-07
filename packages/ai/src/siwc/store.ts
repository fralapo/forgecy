import { eq, siwcConnections, type Database } from "@forgecy/db";
import { decryptSecret, encryptSecret } from "../crypto";
import type { SiwcProfile, SiwcTokens } from "./oauth";

const AAD = "forgecy:siwc_connections";

/** What is kept for one person's SIWC connection; stored encrypted, never logged. */
export interface SiwcAuthState {
  tokens?: SiwcTokens;
  profile?: SiwcProfile;
  /** Pending authorization only; cleared once the code is exchanged. */
  codeVerifier?: string;
}

/** Encrypted read/write of one person's SIWC state, on their `siwc_connections` row. */
export function createSiwcAuthStore(db: Database, userId: string, encryptionKey: string) {
  async function load(): Promise<SiwcAuthState> {
    const [row] = await db
      .select({ encryptedState: siwcConnections.encryptedState })
      .from(siwcConnections)
      .where(eq(siwcConnections.userId, userId));
    if (!row?.encryptedState) return {};
    return JSON.parse(decryptSecret(row.encryptedState, encryptionKey, AAD)) as SiwcAuthState;
  }

  async function write(state: SiwcAuthState, extra: { oauthState?: string | null } = {}) {
    const encryptedState = encryptSecret(JSON.stringify(state), encryptionKey, AAD);
    await db
      .insert(siwcConnections)
      .values({ userId, encryptedState, ...extra })
      .onConflictDoUpdate({
        target: siwcConnections.userId,
        set: { encryptedState, ...extra, updatedAt: new Date() },
      });
  }

  return {
    load,
    async save(patch: Partial<SiwcAuthState>) {
      const next: SiwcAuthState = { ...(await load()), ...patch };
      for (const k of Object.keys(patch) as (keyof SiwcAuthState)[])
        if (patch[k] === undefined) delete next[k];
      await write(next);
    },
    async saveOAuthState(state: string) {
      await write(await load(), { oauthState: state });
    },
    async clear() {
      await write({}, { oauthState: null });
    },
  };
}
