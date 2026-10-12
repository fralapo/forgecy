import {
  diffVersions,
  isSelfApproval,
  parseDocument,
  publishChecks,
  type TokenTree,
} from "@forgecy/brand";
import { and, brandIdentityProposals, eq } from "@forgecy/db";
import { Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { ApproveForm } from "../../../../_components/approve-form";
import { DiffList } from "../../../../_components/diff-list";
import { brandPath } from "../../../../_lib/labels";
import { loadBrand, openConflicts } from "../../../../_lib/server";
import { refText } from "@/lib/i18n";

export async function generateMetadata() {
  const t = await getTranslations("brand.meta");
  return { title: t("approval") };
}

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ clientSlug: string; number: string }>;
}) {
  const { clientSlug, number } = await params;
  const t = await getTranslations("brand.approve");
  const { db, user, client, ws } = await loadBrand(clientSlug);
  const draft = ws.draft;
  const base = brandPath(client.slug);
  if (!draft || String(draft.number) !== number)
    return (
      <Card className="p-6">
        <p className="text-body-md text-fg">
          {t.rich("notOpen", {
            number,
            link: (chunks) => <Link href={`${base}/versions` as Route}>{chunks}</Link>,
          })}
        </p>
      </Card>
    );

  const document = parseDocument(draft.document);
  const tokens = draft.tokens as TokenTree;
  const published = ws.published
    ? { document: parseDocument(ws.published.document), tokens: ws.published.tokens as TokenTree }
    : null;
  const [conflicts, pending] = await Promise.all([
    openConflicts(client.id),
    db
      .select({ sensitive: brandIdentityProposals.sensitive })
      .from(brandIdentityProposals)
      .where(
        and(
          eq(brandIdentityProposals.clientId, client.id),
          eq(brandIdentityProposals.status, "proposed"),
        ),
      ),
  ]);
  const checks = publishChecks(document, tokens, {
    publishedTokens: published?.tokens ?? null,
    pendingSensitive: pending.filter((p) => p.sensitive).length,
    conflicts: conflicts.length,
  });
  const changes = diffVersions(published, { document, tokens });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_28rem]">
      <Card className="p-6">
        <h2 className="text-heading-md text-fg">
          {published
            ? t("changesComparedWith", { number: draft.number, previous: ws.published!.number })
            : t("changesFirst", { number: draft.number })}
        </h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t("summary", {
            changed: changes.length,
            sensitive: changes.filter((c) => c.sensitive).length,
          })}
        </p>
        <div className="mt-4">
          <DiffList changes={changes} />
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="text-heading-md text-fg">{t("title")}</h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {ws.published ? t("explainArchived", { number: ws.published.number }) : t("explain")}
        </p>
        <div className="mt-6">
          <ApproveForm
            key={draft.rev}
            slug={client.slug}
            clientId={client.id}
            versionId={draft.id}
            number={draft.number}
            rev={draft.rev}
            inReview={draft.status === "in_review"}
            checks={await Promise.all(
              checks.map(async (c) => ({ key: c.key, message: await refText(c.ref, c.message) })),
            )}
            selfApproval={isSelfApproval(draft, user.id)}
            doneHref={`${base}/versions`}
          />
        </div>
      </Card>
    </div>
  );
}
