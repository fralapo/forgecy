/**
 * Which templates of this installation a package may reuse, shared by Verify and Import so that
 * the screen and the import agree. Agency templates (no client) and, when a client is replaced,
 * that client's own are reusable; another client's private template never is.
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
 * version when it is free, else `<version>-import-<n>`.
 */
export function freeImportVersion(version: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(version)) return version;
  for (let n = 1; ; n++) if (!used.has(`${version}-import-${n}`)) return `${version}-import-${n}`;
}
