import { FORMATS, type FormatId } from "@forgecy/carousel";
import {
  channelLabels,
  contentStatusLabels,
  listCarousels,
  type ContentChannel,
} from "@forgecy/content";
import { contentStatuses, type ContentStatus } from "@forgecy/core";
import { Badge, Button, Card, cn } from "@forgecy/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { carouselPath, carouselsPath, formatDate } from "../../_lib/paths";
import { loadClient } from "../../_lib/server";
import { statusVariant } from "./_lib/labels";

export const metadata = { title: "Caroselli · Contenuti" };

export default async function CarouselsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const { db, user, client } = await loadClient(clientSlug);
  const raw = typeof sp.stato === "string" ? sp.stato : "";
  const stato = (contentStatuses as readonly string[]).includes(raw)
    ? (raw as ContentStatus)
    : null;
  const rows = await listCarousels(db, user.actor, client.id, {
    ...(stato ? { status: [stato] } : {}),
    includeArchived: stato === "archived",
  });
  const base = carouselsPath(client.slug);
  const filters: { value: ContentStatus | null; label: string }[] = [
    { value: null, label: "Tutti" },
    ...contentStatuses.map((s) => ({ value: s, label: contentStatusLabels[s] })),
  ];
  const now = new Date();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filtra per stato" className="flex flex-wrap gap-2">
          {filters.map((f) => {
            const current = f.value === stato;
            return (
              <Link
                key={f.label}
                href={(f.value ? `${base}?stato=${f.value}` : base) as Route}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "rounded-md border px-3 py-1 text-body-sm",
                  current
                    ? "border-primary bg-surface text-fg"
                    : "border-subtle text-fg-muted hover:text-fg",
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
        <Button asChild>
          <Link href={`${base}/new` as Route}>
            <Plus aria-hidden />
            Nuovo carosello
          </Link>
        </Button>
      </div>
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-body-md text-fg-muted">
            {stato ? "Nessun carosello in questo stato." : "Ancora nessun carosello."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">Caroselli del cliente</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Titolo
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Stato
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Canale
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Formato
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Pilastro
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Aggiornato
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-subtle align-top last:border-0">
                    <td className="px-4 py-3">
                      <Link href={carouselPath(client.slug, r.id) as Route} className="text-fg">
                        {r.title}
                      </Link>
                      <span className="block text-fg-muted">{r.slideCount} slide</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        <Badge variant={statusVariant[r.status]}>
                          {contentStatusLabels[r.status]}
                        </Badge>
                        {r.lockedByJobId && r.lockExpiresAt && r.lockExpiresAt > now ? (
                          <Badge variant="highlight">AI al lavoro</Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-fg">
                      {channelLabels[r.channel as ContentChannel] ?? r.channel}
                    </td>
                    <td className="px-4 py-3 text-fg">
                      {FORMATS[r.format as FormatId]?.label ?? r.format}
                    </td>
                    <td className="px-4 py-3 text-fg">{r.pillarName ?? "—"}</td>
                    <td className="px-4 py-3 text-fg-muted">{formatDate(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
