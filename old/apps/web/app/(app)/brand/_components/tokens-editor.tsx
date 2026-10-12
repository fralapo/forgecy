"use client";

import {
  contrastMatrix,
  hexToDtcg,
  normalizeHex,
  referenceColors,
  semanticColorRoles,
  tokenNameFrom,
  validateTokens,
  type TokenTree,
} from "@forgecy/brand/client";
import { Badge, Button, Input, Label } from "@forgecy/ui";
import { Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { saveTokensAction } from "../actions";
import { controlClass } from "./section-editor";

type Node = Record<string, unknown>;
const clone = <T,>(v: T): T => structuredClone(v);
const node = (tree: TokenTree, ...path: string[]): Node => {
  let n = tree as Node;
  for (const p of path) n = (n[p] ??= {}) as Node;
  return n;
};
const aliasTarget = (v: unknown) =>
  typeof v === "string" && /^\{color\.reference\.([^}]+)\}$/.test(v) ? v.slice(17, -1) : "";

/** Message key (brand.tokens.roles.*) of each semantic role. */
const roleKey = {
  "color.semantic.background": "background",
  "color.semantic.surface": "surface",
  "color.semantic.text-primary": "textPrimary",
  "color.semantic.text-secondary": "textSecondary",
  "color.semantic.brand-primary": "brandPrimary",
  "color.semantic.on-brand-primary": "onBrandPrimary",
  "color.semantic.accent": "accent",
} as const satisfies Record<(typeof semanticColorRoles)[number]["path"], string>;
const pairIds = [
  "textOnBackground",
  "secondaryTextOnBackground",
  "textOnSurface",
  "secondaryTextOnSurface",
  "textOnBrand",
  "brandOnBackground",
] as const;
const isPairId = (id: string): id is (typeof pairIds)[number] =>
  (pairIds as readonly string[]).includes(id);
const gradeVariant = {
  normal: "success",
  large: "warning",
  fail: "error",
  unknown: "neutral",
} as const;

/** Palette (reference), semantic roles and font families of the draft, with live contrast. */
export function TokensEditor({
  initial,
  editable,
  slug,
  clientId,
  versionId,
  rev,
}: {
  initial: TokenTree;
  editable: boolean;
  slug: string;
  clientId: string;
  versionId: string | null;
  rev: number;
}) {
  const t = useTranslations("brand.tokens");
  const router = useRouter();
  const [tokens, setTokens] = useState<TokenTree>(() => clone(initial));
  const [dirty, setDirty] = useState(false);
  // Revisions only grow: another editor on the page (tokens) may have saved since.
  const [savedRev, setRev] = useState(rev);
  const currentRev = Math.max(rev, savedRev);
  const [newName, setNewName] = useState("");
  const [newHex, setNewHex] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, start] = useTransition();
  const disabled = !editable || saving;

  const colors = referenceColors(tokens);
  const matrix = useMemo(() => contrastMatrix(tokens), [tokens]);
  const issues = useMemo(() => validateTokens(tokens), [tokens]);

  const update = (fn: (tree: TokenTree) => void) => {
    setTokens((current) => {
      const next = clone(current);
      fn(next);
      return next;
    });
    setDirty(true);
  };
  const fontOf = (role: "display" | "body") => {
    const v = (node(tokens, "font", "family", role) as Node).$value;
    return Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "";
  };

  const save = () =>
    start(async () => {
      if (!versionId) return;
      const res = await saveTokensAction({ slug, clientId, versionId, rev: currentRev, tokens });
      if (!res.ok) return setMessage({ kind: "error", text: res.error });
      setRev(res.rev);
      setDirty(false);
      setMessage({ kind: "ok", text: t("saved") });
      router.refresh();
    });

  return (
    <section
      aria-labelledby="palette"
      className="space-y-6 rounded-lg border border-subtle bg-surface p-6"
    >
      <h2 id="palette" className="text-heading-md text-fg">
        {t("heading")}
      </h2>
      <div>
        <h3 className="text-heading-sm text-fg">{t("referenceColors")}</h3>
        <ul className="mt-3 space-y-2">
          {colors.map((c) => (
            <li key={c.name} className="flex flex-wrap items-center gap-3">
              <input
                type="color"
                aria-label={t("colorLabel", { name: c.name })}
                value={c.hex.toLowerCase()}
                disabled={disabled}
                onChange={(e) =>
                  update((tree) => {
                    node(tree, "color", "reference", c.name).$value = hexToDtcg(e.target.value);
                  })
                }
                className="h-10 w-12 rounded-md border border-control bg-surface"
              />
              <code className="w-28 font-mono text-mono-md text-fg">{c.hex}</code>
              <span className="text-body-sm text-fg">{c.name}</span>
              {c.extension?.sourceIds?.length ? (
                <span className="text-body-sm text-fg-muted">
                  {t("fromSources", { count: c.extension.sourceIds.length })}
                </span>
              ) : null}
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    update((tree) => {
                      delete node(tree, "color", "reference")[c.name];
                    })
                  }
                >
                  <Trash2 aria-hidden />
                  {t("remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="new-color-name">{t("name")}</Label>
              <Input
                id="new-color-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("namePlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-color-hex">{t("hex")}</Label>
              <Input
                id="new-color-hex"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value)}
                placeholder={t("hexPlaceholder")}
                className="w-32"
              />
            </div>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                const hex = normalizeHex(newHex);
                if (!hex)
                  return setMessage({
                    kind: "error",
                    text: t("invalidHex"),
                  });
                const name = tokenNameFrom(newName, `color-${colors.length + 1}`);
                if (colors.some((c) => c.name === name))
                  return setMessage({ kind: "error", text: t("colorExists", { name }) });
                update((tree) => {
                  node(tree, "color", "reference")[name] = {
                    $value: hexToDtcg(hex),
                    ...(newName ? { $description: newName } : {}),
                  };
                });
                setNewName("");
                setNewHex("");
                setMessage(null);
              }}
            >
              <Plus aria-hidden />
              {t("addColor")}
            </Button>
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="text-heading-sm text-fg">{t("semanticRoles")}</h3>
        <p className="text-body-sm text-fg-muted">{t("semanticRolesHint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {semanticColorRoles.map((r) => {
            const key = r.path.split(".").pop()!;
            const current = aliasTarget(node(tokens, "color", "semantic", key).$value);
            return (
              <div key={r.path} className="space-y-1">
                <Label htmlFor={r.path}>{t(`roles.${roleKey[r.path]}`)}</Label>
                <select
                  id={r.path}
                  className={controlClass}
                  value={current}
                  disabled={disabled}
                  onChange={(e) =>
                    update((tree) => {
                      node(tree, "color", "semantic", key).$value =
                        `{color.reference.${e.target.value}}`;
                    })
                  }
                >
                  {current ? null : <option value="">—</option>}
                  {colors.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} {c.hex}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-heading-sm text-fg">{t("fontFamilies")}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(["display", "body"] as const).map((role) => (
            <div key={role} className="space-y-1">
              <Label htmlFor={`font-${role}`}>
                {role === "display" ? t("fontDisplay") : t("fontBody")}
              </Label>
              <Input
                id={`font-${role}`}
                value={fontOf(role)}
                disabled={disabled}
                onChange={(e) =>
                  update((tree) => {
                    node(tree, "font", "family", role).$value = e.target.value
                      ? [e.target.value, "sans-serif"]
                      : ["sans-serif"];
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-heading-sm text-fg">{t("contrasts")}</h3>
        <p className="text-body-sm text-fg-muted">{t("contrastsHint")}</p>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-left text-body-sm">
            <caption className="sr-only">{t("contrastCaption")}</caption>
            <thead className="text-label text-fg-muted">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  {t("pair")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("preview")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("ratio")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("result")}
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((cell) => (
                <tr key={cell.id} className="border-t border-subtle">
                  <td className="py-2 text-fg">
                    {isPairId(cell.id) ? t(`pairs.${cell.id}`) : cell.label}
                  </td>
                  <td className="py-2">
                    {cell.fgHex && cell.bgHex ? (
                      <span
                        className="inline-block rounded-sm px-2 py-1"
                        style={{ color: cell.fgHex, backgroundColor: cell.bgHex }}
                      >
                        {t("sample")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 font-mono text-mono-md text-fg">
                    {cell.ratio ? `${cell.ratio.toFixed(2)}:1` : "—"}
                  </td>
                  <td className="py-2">
                    <Badge variant={gradeVariant[cell.grade]}>{t(`grade.${cell.grade}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {issues.length ? (
        <ul role="alert" className="space-y-1 text-body-sm text-error">
          {issues.slice(0, 5).map((i) => (
            <li key={`${i.path}-${i.message}`}>
              {i.path}:{" "}
              {i.code === "unresolved"
                ? t("issues.unresolved", { detail: i.message })
                : t(`issues.${i.code}`)}
            </li>
          ))}
        </ul>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-subtle pt-4">
          <Button onClick={save} disabled={saving || !dirty || issues.length > 0}>
            <Save aria-hidden />
            {saving ? t("saving") : t("save")}
          </Button>
          {message ? (
            <span
              role={message.kind === "error" ? "alert" : "status"}
              className={
                message.kind === "error" ? "text-body-sm text-error" : "text-body-sm text-success"
              }
            >
              {message.text}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
