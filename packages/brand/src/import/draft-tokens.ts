import { and, brandIdentityVersions, eq, inArray, type Database } from "@forgecy/db";
import { emptyDocument, parseDocument } from "../document";
import type { DraftState } from "../proposals";
import { defaultTokens, type TokenTree } from "../tokens";

/** Document and tokens of the open draft, else of the published version, else the defaults. */
export async function getDraftState(db: Database, clientId: string): Promise<DraftState> {
  const rows = await db
    .select({
      status: brandIdentityVersions.status,
      document: brandIdentityVersions.document,
      tokens: brandIdentityVersions.tokens,
    })
    .from(brandIdentityVersions)
    .where(
      and(
        eq(brandIdentityVersions.clientId, clientId),
        inArray(brandIdentityVersions.status, ["draft", "in_review", "published"]),
      ),
    );
  const open = rows.find((r) => r.status !== "published") ?? rows[0];
  return {
    document: open ? parseDocument(open.document) : emptyDocument(),
    tokens: (open?.tokens as TokenTree | undefined) ?? defaultTokens(),
  };
}
