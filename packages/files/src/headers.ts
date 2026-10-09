/**
 * Response headers for a stored file served from the Forgecy origin. SVG is the only stored type
 * that can run script, so it is served as an inert image document (`sandbox` also disables
 * scripts and forms and gives it an opaque origin). Other types only get `nosniff`.
 */
export function fileResponseHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = { "x-content-type-options": "nosniff" };
  if (contentType.split(";")[0]?.trim().toLowerCase() === "image/svg+xml")
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return headers;
}
