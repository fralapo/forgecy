import type { FieldChange } from "@forgecy/brand";
import { Badge } from "@forgecy/ui";
import { getTranslations } from "next-intl/server";
import { fieldMessageKey, formatValue } from "../_lib/labels";

export async function DiffList({ changes }: { changes: FieldChange[] }) {
  const t = await getTranslations("brand.diff");
  const root = await getTranslations();
  const labelOf = (c: FieldChange) => {
    if (c.pointer.startsWith("/tokens/"))
      return t("token", { path: c.pointer.split("/").slice(2).join(".") });
    const key = fieldMessageKey(c.pointer);
    return root.has(key) ? root(key) : c.label;
  };
  if (!changes.length) return <p className="text-body-sm text-fg-muted">{t("none")}</p>;
  return (
    <ul className="divide-y divide-subtle">
      {changes.map((c, i) => (
        <li
          key={`${c.pointer}-${i}`}
          className="grid gap-2 py-3 text-body-sm md:grid-cols-[14rem_1fr_1fr]"
        >
          <div className="space-y-1">
            <p className="text-fg">{labelOf(c)}</p>
            <div className="flex flex-wrap gap-1">
              <Badge>{t(c.kind)}</Badge>
              {c.sensitive ? <Badge variant="warning">{t("sensitive")}</Badge> : null}
            </div>
          </div>
          <p className="whitespace-pre-wrap text-fg-muted">
            <span className="sr-only">{t("before")} </span>
            {formatValue(c.before)}
          </p>
          <p className="whitespace-pre-wrap text-fg">
            <span className="sr-only">{t("after")} </span>
            {formatValue(c.after)}
          </p>
        </li>
      ))}
    </ul>
  );
}
