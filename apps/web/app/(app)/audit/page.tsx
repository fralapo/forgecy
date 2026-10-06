import { listProspects } from "@forgecy/audit";
import { auditStatuses, type AuditStatus } from "@forgecy/core";
import { Badge, Button, Card, Input } from "@forgecy/ui";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { auditStatusLabel, auditStatusVariant, formatDate } from "./_lib/labels";
import { readDeps } from "./_lib/server";
import { selectClass } from "./_lib/styles";

export const metadata = { title: "Prospect audits" };

export default async function AuditListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; archived?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const status =
    sp.status === "none" || auditStatuses.includes(sp.status as AuditStatus)
      ? (sp.status as AuditStatus | "none")
      : undefined;
  const archived = sp.archived === "1";
  const rows = await listProspects(readDeps().db, {
    ...(sp.q ? { q: sp.q } : {}),
    ...(status ? { status } : {}),
    archived,
  });
  return (
    <>
      <PageHeader
        title="Prospect audits"
        description="Analyze a potential client's website, social channels and competitors before the first meeting. The AI proposes, you decide what goes into the report."
        actions={
          <Button asChild>
            <Link href="/audit/new">
              <Plus aria-hidden />
              New prospect
            </Link>
          </Button>
        }
      />
      <form className="mb-6 flex flex-wrap items-end gap-3" role="search">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-label text-fg-muted">
          Search
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name, website or sector" />
        </label>
        <label className="flex w-56 flex-col gap-1 text-label text-fg-muted">
          Audit status
          <select name="status" defaultValue={status ?? ""} className={selectClass}>
            <option value="">All</option>
            <option value="none">Audit not started</option>
            {auditStatuses
              .filter((s) => s !== "archived" && s !== "draft")
              .map((s) => (
                <option key={s} value={s}>
                  {auditStatusLabel[s]}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-body-sm text-fg">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} />
          Archived
        </label>
        <Button type="submit" variant="secondary">
          <Search aria-hidden />
          Filter
        </Button>
      </form>
      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-body-md text-fg-muted">
              {sp.q || status || archived
                ? "No prospects match the filters."
                : "No prospects yet. Add the first one to start an audit."}
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">Prospects and audit status</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-6 py-3 font-medium">
                  Prospect
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Sector and area
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Audit
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  To review
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Owner
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-subtle last:border-0">
                  <td className="px-6 py-3">
                    <Link
                      href={`/audit/${r.slug}`}
                      className="font-medium text-link underline-offset-2 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.websiteUrl ? (
                      <span className="block text-fg-muted">{r.websiteUrl}</span>
                    ) : null}
                  </td>
                  <td className="px-6 py-3 text-fg-muted">
                    {[r.sector, r.area].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-6 py-3">
                    {r.auditStatus ? (
                      <Badge variant={auditStatusVariant[r.auditStatus]}>
                        {auditStatusLabel[r.auditStatus]}
                      </Badge>
                    ) : (
                      <span className="text-fg-muted">Not started</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-fg">{r.toReview || "—"}</td>
                  <td className="px-6 py-3 text-fg-muted">{r.ownerName ?? "—"}</td>
                  <td className="px-6 py-3 text-fg-muted">{formatDate(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
