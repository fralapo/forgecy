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

const gradeLabel = {
  normal: "Normal text (4.5:1)",
  large: "Large text only (3:1)",
  fail: "Not allowed",
  unknown: "Can’t be calculated",
} as const;
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

  const update = (fn: (t: TokenTree) => void) => {
    setTokens((t) => {
      const next = clone(t);
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
      setMessage({ kind: "ok", text: "Tokens saved." });
      router.refresh();
    });

  return (
    <section
      aria-labelledby="palette"
      className="space-y-6 rounded-lg border border-subtle bg-surface p-6"
    >
      <h2 id="palette" className="text-heading-md text-fg">
        Palette and roles
      </h2>
      <div>
        <h3 className="text-heading-sm text-fg">Reference colors</h3>
        <ul className="mt-3 space-y-2">
          {colors.map((c) => (
            <li key={c.name} className="flex flex-wrap items-center gap-3">
              <input
                type="color"
                aria-label={`Color ${c.name}`}
                value={c.hex.toLowerCase()}
                disabled={disabled}
                onChange={(e) =>
                  update((t) => {
                    node(t, "color", "reference", c.name).$value = hexToDtcg(e.target.value);
                  })
                }
                className="h-10 w-12 rounded-md border border-control bg-surface"
              />
              <code className="w-28 font-mono text-mono-md text-fg">{c.hex}</code>
              <span className="text-body-sm text-fg">{c.name}</span>
              {c.extension?.sourceIds?.length ? (
                <span className="text-body-sm text-fg-muted">
                  from {c.extension.sourceIds.length} sources
                </span>
              ) : null}
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    update((t) => {
                      delete node(t, "color", "reference")[c.name];
                    })
                  }
                >
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="new-color-name">Name</Label>
              <Input
                id="new-color-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Rossi Blue"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-color-hex">Hex</Label>
              <Input
                id="new-color-hex"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value)}
                placeholder="0044CC"
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
                    text: "Invalid color: use the #RRGGBB format.",
                  });
                const name = tokenNameFrom(newName, `color-${colors.length + 1}`);
                if (colors.some((c) => c.name === name))
                  return setMessage({ kind: "error", text: `The color ${name} already exists.` });
                update((t) => {
                  node(t, "color", "reference")[name] = {
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
              Add color
            </Button>
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="text-heading-sm text-fg">Semantic roles</h3>
        <p className="text-body-sm text-fg-muted">
          Layouts use only these roles: the renderer applies the values.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {semanticColorRoles.map((r) => {
            const key = r.path.split(".").pop()!;
            const current = aliasTarget(node(tokens, "color", "semantic", key).$value);
            return (
              <div key={r.path} className="space-y-1">
                <Label htmlFor={r.path}>{r.label}</Label>
                <select
                  id={r.path}
                  className={controlClass}
                  value={current}
                  disabled={disabled}
                  onChange={(e) =>
                    update((t) => {
                      node(t, "color", "semantic", key).$value =
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
        <h3 className="text-heading-sm text-fg">Font families</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(["display", "body"] as const).map((role) => (
            <div key={role} className="space-y-1">
              <Label htmlFor={`font-${role}`}>
                {role === "display" ? "Headings" : "Body text"}
              </Label>
              <Input
                id={`font-${role}`}
                value={fontOf(role)}
                disabled={disabled}
                onChange={(e) =>
                  update((t) => {
                    node(t, "font", "family", role).$value = e.target.value
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
        <h3 className="text-heading-sm text-fg">Contrasts</h3>
        <p className="text-body-sm text-fg-muted">
          Large text is measured at its displayed size: at least 68 px on the canvas, or 54 px in
          bold.
        </p>
        <table className="mt-3 w-full text-left text-body-sm">
          <caption className="sr-only">Contrast of text and background pairs</caption>
          <thead className="text-label text-fg-muted">
            <tr>
              <th scope="col" className="py-2 font-medium">
                Pair
              </th>
              <th scope="col" className="py-2 font-medium">
                Preview
              </th>
              <th scope="col" className="py-2 font-medium">
                Ratio
              </th>
              <th scope="col" className="py-2 font-medium">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((cell) => (
              <tr key={`${cell.fg}-${cell.bg}`} className="border-t border-subtle">
                <td className="py-2 text-fg">{cell.label}</td>
                <td className="py-2">
                  {cell.fgHex && cell.bgHex ? (
                    <span
                      className="inline-block rounded-sm px-2 py-1"
                      style={{ color: cell.fgHex, backgroundColor: cell.bgHex }}
                    >
                      Aa Text
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 font-mono text-mono-md text-fg">
                  {cell.ratio ? `${cell.ratio.toFixed(2)}:1` : "—"}
                </td>
                <td className="py-2">
                  <Badge variant={gradeVariant[cell.grade]}>{gradeLabel[cell.grade]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {issues.length ? (
        <ul role="alert" className="space-y-1 text-body-sm text-error">
          {issues.slice(0, 5).map((i) => (
            <li key={`${i.path}-${i.message}`}>
              {i.path}: {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-subtle pt-4">
          <Button onClick={save} disabled={saving || !dirty || issues.length > 0}>
            <Save aria-hidden />
            {saving ? "Saving…" : "Save tokens"}
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
