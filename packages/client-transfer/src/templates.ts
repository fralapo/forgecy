/**
 * How a package's templates meet the templates already here. Verify and Import decide with the
 * same function so that the screen and the import agree, and every place where a row names a
 * template by key and version follows a rename or a reuse (`rewriteTemplateRefs`).
 */
import { templateConflictId } from "@forgecy/core";

export interface TemplateRow {
  id: string;
  version: string;
  client_id: string | null;
}

/**
 * Agency templates (no client) and, when a client is replaced, that client's own are reusable;
 * another client's private template never is.
 */
export function reusableTemplates<T extends { client_id: string | null }>(
  rows: readonly T[],
  ownerId: string | null,
): T[] {
  return rows.filter((r) => r.client_id === null || (ownerId !== null && r.client_id === ownerId));
}

/**
 * The version an imported template gets when its own is held by a template that cannot be
 * reused (templates are unique by key and version across the installation): the package's
 * version when it is free, else `<version>-import.<n>`, a valid semver prerelease that sorts
 * just below the release it copies.
 */
export function freeImportVersion(version: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(version)) return version;
  for (let n = 1; ; n++) if (!used.has(`${version}-import.${n}`)) return `${version}-import.${n}`;
}

export type TemplateReuse<T extends TemplateRow = TemplateRow> =
  | { kind: "exact"; row: T; conflictVersions: string[] }
  | { kind: "useExisting"; row: T; conflictVersions: string[] }
  | { kind: "import"; version: string; conflictVersions: string[] };

/**
 * What happens to one template of the package. `all` are the installation's templates with the
 * same key, newest first; `ownerId` is the client being replaced (null for a new client).
 * `conflictVersions` are the versions the person may choose to use instead: Verify lists a
 * conflict when there are any and the exact version is not here.
 */
export function templateReuse<T extends TemplateRow>(
  all: readonly T[],
  version: string,
  ownerId: string | null,
  choice: "useExisting" | "importDraft" | undefined,
  otherPackageVersions: Iterable<string> = [],
): TemplateReuse<T> {
  const reusable = reusableTemplates(all, ownerId);
  const conflictVersions = reusable.map((r) => r.version);
  const exact = reusable.find((r) => r.version === version);
  if (exact) return { kind: "exact", row: exact, conflictVersions };
  if (reusable.length && choice === "useExisting")
    return { kind: "useExisting", row: reusable[0]!, conflictVersions };
  return {
    kind: "import",
    version: freeImportVersion(version, [...all.map((r) => r.version), ...otherPackageVersions]),
    conflictVersions,
  };
}

/**
 * Decides every template of the package at once, reserving the names it hands out: a template
 * renamed to `1.0.0-import.1` must not meet a template of the package that is literally called
 * that, nor one renamed earlier in the same import. `installed` are the installation's templates
 * by key, newest first; the result is keyed by the package template's id.
 */
export function planTemplateImport<T extends TemplateRow>(
  packageTemplates: readonly { id: string; key: string; version: string }[],
  installed: ReadonlyMap<string, readonly T[]>,
  ownerId: string | null,
  choices: Readonly<Record<string, "useExisting" | "importDraft" | undefined>>,
): Map<string, TemplateReuse<T>> {
  const reserved = new Map<string, Set<string>>();
  for (const t of packageTemplates) {
    const set = reserved.get(t.key) ?? new Set<string>();
    set.add(t.version);
    reserved.set(t.key, set);
  }
  const plan = new Map<string, TemplateReuse<T>>();
  for (const t of packageTemplates) {
    const names = reserved.get(t.key)!;
    // Every other name in play for this key: the package's own and those handed out already.
    const others = [...names].filter((v) => v !== t.version);
    const decision = templateReuse(
      installed.get(t.key) ?? [],
      t.version,
      ownerId,
      choices[templateConflictId(t.key, t.version)],
      others,
    );
    if (decision.kind === "import") names.add(decision.version);
    plan.set(t.id, decision);
  }
  return plan;
}

/** The template row as it is stored here under another version; the manifest is left alone. */
export function renameTemplateRow<T extends Record<string, unknown>>(row: T, version: string): T {
  // The stored manifest keeps the version of the package's template.json: the catalog parses it
  // with the strict x.y.z rule and reads the row's own `version` for everything else.
  return { ...row, version };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The ways a row names a template: [property holding the key, property holding the version]. */
function templatePair(o: Obj, parent: string | undefined): [string, string] | null {
  if (typeof o.template_version === "string" && typeof o.template_key === "string")
    return ["template_key", "template_version"];
  if (typeof o.templateVersion === "string") {
    if (typeof o.templateKey === "string") return ["templateKey", "templateVersion"];
    if (typeof o.templateId === "string") return ["templateId", "templateVersion"];
  }
  // The content pipeline writes { template: <key>, version } into a version's meta.
  if (typeof o.template === "string" && typeof o.version === "string")
    return ["template", "version"];
  if (parent === "template" && typeof o.version === "string") {
    if (typeof o.id === "string") return ["id", "version"];
    if (typeof o.key === "string") return ["key", "version"];
  }
  return null;
}

/**
 * A copy of `value` where every reference to a template whose version was renamed or replaced
 * (`rewrite`: conflict id of the package's key@version -> the version it has here) points at
 * the new version: the `template_key`/`template_version` columns and the same pair inside any
 * JSON (a version's `meta`, a job's parameters, a provenance block).
 */
export function rewriteTemplateRefs<T>(value: T, rewrite: ReadonlyMap<string, string>): T {
  const walk = (v: unknown, parent?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, parent));
    if (!isObj(v)) return v;
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x, k);
    const pair = templatePair(out, parent);
    if (pair) {
      const to = rewrite.get(templateConflictId(String(out[pair[0]]), String(out[pair[1]])));
      if (to) out[pair[1]] = to;
    }
    return out;
  };
  return walk(value) as T;
}

/**
 * True when anything in `value` holds the template's key and its version side by side (a looser
 * test than the rewrite uses, so that a shape the rewrite does not know still shows up).
 */
export function referencesTemplate(value: unknown, key: string, version: string): boolean {
  if (Array.isArray(value)) return value.some((x) => referencesTemplate(x, key, version));
  if (!isObj(value)) return false;
  const strings = Object.values(value).filter((x): x is string => typeof x === "string");
  if (strings.includes(key) && strings.includes(version)) return true;
  return Object.values(value).some((x) => referencesTemplate(x, key, version));
}
