// The guess from the address lives in @forgecy/brand: the import compares the client's name with it.
export { nameFromUrl } from "@forgecy/brand";

/** `base`, else `base-2`, `base-3`... the first one `taken` does not know. */
export async function uniqueSlug(
  base: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  let slug = base;
  for (let i = 2; await taken(slug); i++) slug = `${base}-${i}`;
  return slug;
}
