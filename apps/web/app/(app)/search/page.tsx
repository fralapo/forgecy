import { Badge, Button, Card, Input, Label } from "@forgecy/ui";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import {
  highlight,
  MIN_QUERY,
  parseSearchParams,
  searchHref,
  searchTypes,
  type SearchType,
} from "./_lib/query";
import { clientOptions, runSearch, type SearchHit } from "./_lib/server";

export async function generateMetadata() {
  const t = await getTranslations("search");
  return { title: t("metaTitle") };
}

const selectClass =
  "h-10 w-full rounded-md border border-control bg-surface px-3 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-focus";
const linkClass = "text-link underline-offset-2 hover:underline";

function Highlighted({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlight(text, q).map((part, i) =>
        part.match ? (
          <strong key={i} className="font-semibold">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const p = parseSearchParams(await searchParams);
  const [t, te, tc, tp, tb, ta, tt] = await Promise.all([
    getTranslations("search"),
    getTranslations("enums"),
    getTranslations("content.labels"),
    getTranslations("products"),
    getTranslations("brand"),
    getTranslations("audit"),
    getTranslations("templates"),
  ]);
  const ready = p.q.length >= MIN_QUERY;
  const [result, clientList] = await Promise.all([ready ? runSearch(p) : null, clientOptions()]);
  const filtered = p.types.length > 0 || p.client !== null || p.archived;

  // Status labels already live in each module's namespace.
  const statusLabel = (type: SearchType, s: string): string => {
    switch (type) {
      case "client":
        return te(`clientStatus.${s}` as never);
      case "carousel":
        return tc(`contentStatus.${s}` as never);
      case "product":
        return tp(`status.${s}` as never);
      case "brand":
        return tb(`versionStatus.${s}` as never);
      case "audit":
        return ta(`status.${s}` as never);
      case "report":
        return ta(`reportStatus.${s}` as never);
      case "template":
        return tt(`status.${s}` as never);
      case "asset":
        return tc(`assetStatus.${s}` as never);
    }
  };
  const hitTitle = (type: SearchType, h: SearchHit) =>
    type === "asset" && !h.title ? t("noAlt") : h.title;
  const total = result ? result.groups.reduce((sum, g) => sum + g.total, 0) : 0;

  return (
    <>
      <PageHeader
        title={ready ? t("title", { q: p.q }) : t("titleEmpty")}
        description={
          result && total > 0
            ? t("summary", { count: total, types: result.groups.length })
            : undefined
        }
      />
      <form method="get" action="/search" className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-6" aria-label={t("filters.title")}>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-label font-medium text-fg">{t("filters.type")}</legend>
            {searchTypes.map((type) => (
              <label key={type} className="flex items-center gap-2 text-body-sm text-fg">
                <input
                  type="checkbox"
                  name="type"
                  value={type}
                  defaultChecked={p.types.includes(type)}
                  className="size-4 accent-primary"
                />
                <span className="flex-1">{t(`types.${type}`)}</span>
                {result ? <span className="text-fg-muted">{result.counts[type]}</span> : null}
              </label>
            ))}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="client">{t("filters.client")}</Label>
            <select id="client" name="client" defaultValue={p.client ?? ""} className={selectClass}>
              <option value="">{t("filters.anyClient")}</option>
              {clientList.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              name="archived"
              value="1"
              defaultChecked={p.archived}
              className="size-4 accent-primary"
            />
            {t("filters.archived")}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary">
              {t("filters.apply")}
            </Button>
            {filtered ? (
              <Link href={searchHref({ q: p.q }) as Route} className={`text-body-sm ${linkClass}`}>
                {t("filters.reset")}
              </Link>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <div className="flex gap-2">
            <Label htmlFor="q" className="sr-only">
              {t("fieldLabel")}
            </Label>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={p.q}
              placeholder={t("field")}
              autoFocus
              autoComplete="off"
            />
            <Button type="submit">{t("submit")}</Button>
          </div>

          <p aria-live="polite" className="sr-only">
            {result
              ? total > 0
                ? t("summary", { count: total, types: result.groups.length })
                : t("noResults", { q: p.q })
              : ""}
          </p>

          {!ready ? (
            <p className="text-body-md text-fg-muted">
              {p.q.length > 0 ? t("tooShort", { min: MIN_QUERY }) : t("hint")}
            </p>
          ) : result && result.groups.length === 0 ? (
            <Card>
              <p className="text-body-md text-fg">{t("noResults", { q: p.q })}</p>
              <p className="text-body-sm text-fg-muted">{t("noResultsHints")}</p>
              {filtered ? (
                <Link
                  href={searchHref({ q: p.q }) as Route}
                  className={`text-body-sm ${linkClass}`}
                >
                  {t("filters.reset")}
                </Link>
              ) : null}
            </Card>
          ) : (
            result?.groups.map((g) => (
              <Card key={g.type} role="region" aria-labelledby={`group-${g.type}`}>
                <h2 id={`group-${g.type}`} className="text-heading-sm text-fg">
                  {t("groupTitle", { type: t(`types.${g.type}`), count: g.total })}
                </h2>
                <ul className="divide-y divide-subtle">
                  {g.hits.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <Link href={h.href as Route} className={`text-body-md ${linkClass}`}>
                        <Highlighted text={hitTitle(g.type, h)} q={p.q} />
                      </Link>
                      {h.detail ? (
                        <span
                          className={
                            g.type === "client"
                              ? "text-body-sm text-fg-muted"
                              : "font-mono text-body-sm text-fg-muted"
                          }
                        >
                          <Highlighted text={h.detail} q={p.q} />
                        </span>
                      ) : null}
                      {h.client ? (
                        <span className="text-body-sm text-fg-muted">{h.client.name}</span>
                      ) : g.type === "template" ? (
                        <span className="text-body-sm text-fg-muted">{t("agencyTemplate")}</span>
                      ) : null}
                      <Badge>{statusLabel(g.type, h.status)}</Badge>
                    </li>
                  ))}
                </ul>
                {g.hits.length < g.total ? (
                  <Link
                    href={searchHref({ ...p, types: [g.type] }) as Route}
                    className={`text-body-sm ${linkClass}`}
                  >
                    {t("showAll", { count: g.total })}
                  </Link>
                ) : null}
              </Card>
            ))
          )}
        </div>
      </form>
    </>
  );
}
