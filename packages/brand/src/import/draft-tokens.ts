import { and, brandIdentityVersions, eq, inArray, type Database } from "@forgecy/db";
import { defaultTokens, type TokenTree } from "../tokens";

/** Tokens of the open draft, else of the published version, else the defaults. */
export async function getDraftTokens(db: Database, clientId: string): Promise<TokenTree> {
  const rows = await db
    .select({ status: brandIdentityVersions.status, tokens: brandIdentityVersions.tokens })
    .from(brandIdentityVersions)
    .where(
      and(
        eq(brandIdentityVersions.clientId, clientId),
        inArray(brandIdentityVersions.status, ["draft", "in_review", "published"]),
      ),
    );
  const open = rows.find((r) => r.status !== "published") ?? rows[0];
  return (open?.tokens as TokenTree | undefined) ?? defaultTokens();
}
