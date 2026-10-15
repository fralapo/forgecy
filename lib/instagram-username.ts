const USERNAME_PATTERN=/^@?([A-Za-z0-9._]{1,30})$/;

/** Validate and normalize the public Instagram handle accepted by Forgecy. */
export function normalizeInstagramUsername(value:string):string|null{
 const match=USERNAME_PATTERN.exec(value.trim());
 return match?.[1].toLowerCase()??null;
}
