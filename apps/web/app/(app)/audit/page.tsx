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

export const metadata = { title: "Audit dei prospect" };

export default async function AuditListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stato?: string; archivio?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const status =
    sp.stato === "none" || auditStatuses.includes(sp.stato as AuditStatus)
      ? (sp.stato as AuditStatus | "none")
      : undefined;
  const archived = sp.archivio === "1";
  const rows = await listProspects(readDeps().db, {
    ...(sp.q ? { q: sp.q } : {}),
    ...(status ? { status } : {}),
    archived,
  });
  return (
    <>
      <PageHeader
        title="Audit dei prospect"
        description="Analizza sito, social e competitor di un potenziale cliente prima del primo incontro. L'AI propone, tu decidi cosa entra nel report."
        actions={
          <Button asChild>
            <Link href="/audit/new">
              <Plus aria-hidden />
              Nuovo prospect
            </Link>
          </Button>
        }
      />
      <form className="mb-6 flex flex-wrap items-end gap-3" role="search">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-label text-fg-muted">
          Cerca
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Nome, sito o settore" />
        </label>
        <label className="flex w-56 flex-col gap-1 text-label text-fg-muted">
          Stato dell&apos;audit
          <select name="stato" defaultValue={status ?? ""} className={selectClass}>
            <option value="">Tutti</option>
            <option value="none">Audit non avviato</option>
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
          <input type="checkbox" name="archivio" value="1" defaultChecked={archived} />
          Archiviati
        </label>
        <Button type="submit" variant="secondary">
          <Search aria-hidden />
          Filtra
        </Button>
      </form>
      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-body-md text-fg-muted">
              {sp.q || status || archived
                ? "Nessun prospect corrisponde ai filtri."
                : "Ancora nessun prospect. Aggiungi il primo per avviare un audit."}
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">Prospect e stato dell&apos;audit</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-6 py-3 font-medium">
                  Prospect
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Settore e area
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Audit
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Da rivedere
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Responsabile
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Aggiornato
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
                      <span className="text-fg-muted">Non avviato</span>
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
