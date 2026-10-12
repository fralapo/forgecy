import { blocks, type BlockKey, type FieldComparison } from "@forgecy/brand";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { fieldMessageKey, formatValue } from "../_lib/labels";

/** Two versions side by side, block by block; only the fields that differ unless `all`. */
export async function VersionCompare({
  rows,
  left,
  right,
  all,
  href,
}: {
  rows: FieldComparison[];
  left: number;
  right: number;
  all: boolean;
  /** Versions page URL with the same comparison, without `all`. */
  href: string;
}) {
  const t = await getTranslations("brand");
  const root = await getTranslations();
  const labelOf = (r: FieldComparison) => {
    if (r.pointer.startsWith("/tokens/"))
      return t("diff.token", { path: r.pointer.split("/").slice(2).join(".") });
    const key = fieldMessageKey(r.pointer);
    return root.has(key) ? root(key) : r.label;
  };
  const shown = all ? rows : rows.filter((r) => r.changed);
  const changedCount = rows.filter((r) => r.changed).length;
  const groups = (Object.keys(blocks) as BlockKey[])
    .map((block) => ({ block, rows: shown.filter((r) => r.block === block) }))
    .filter((g) => g.rows.length);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-heading-md text-fg">{t("versions.compareTitle", { left, right })}</h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            {t("versions.compareCount", { count: changedCount })}
          </p>
        </div>
        <Link href={(all ? href : `${href}&all=1`) as Route} className="text-body-sm">
          {all ? t("versions.onlyDifferences") : t("versions.showAll")}
        </Link>
      </div>
      <p className="mt-4 text-body-sm text-fg-muted lg:hidden">{t("versions.compareNarrow")}</p>
      <div className="mt-4 hidden lg:block">
        {groups.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{t("diff.none")}</p>
        ) : (
          groups.map((g) => (
            <div className="overflow-x-auto">
              <table key={g.block} className="mb-6 w-full table-fixed text-left text-body-sm">
                <caption className="pb-2 text-left text-heading-sm text-fg">
                  {t(`blocks.${g.block}`)}
                </caption>
                <thead className="border-b border-subtle text-label text-fg-muted">
                  <tr>
                    <th scope="col" className="w-56 py-2 pr-4 font-medium">
                      {t("versions.field")}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t("versions.number", { number: left })}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t("versions.number", { number: right })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.pointer} className="border-b border-subtle align-top last:border-0">
                      <th scope="row" className="py-3 pr-4 font-normal">
                        <span className="block text-fg">{labelOf(r)}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {r.changed && all ? <Badge>{t("diff.changed")}</Badge> : null}
                          {r.changed && r.sensitive ? (
                            <Badge variant="warning">{t("diff.sensitive")}</Badge>
                          ) : null}
                        </span>
                      </th>
                      <td className="whitespace-pre-wrap break-words py-3 pr-4 text-fg-muted">
                        {formatValue(r.left)}
                      </td>
                      <td
                        className={`whitespace-pre-wrap break-words py-3 ${r.changed ? "text-fg" : "text-fg-muted"}`}
                      >
                        {formatValue(r.right)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
