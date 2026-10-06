import "server-only";
import { RENDER_CSP } from "@forgecy/carousel";
import { directoryTemplateSource } from "@forgecy/carousel/node";

/** Templates of the repository catalog (templates/agency, or FORGECY_TEMPLATES_DIR). */
export const templateSource = directoryTemplateSource();

/**
 * A rendered slide is served as its own document: same CSP the renderer writes in the
 * page (nothing but inline CSS and data: URLs) and framable only by Forgecy itself.
 */
export function slideResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `${RENDER_CSP}; frame-ancestors 'self'`,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "private, no-store",
    },
  });
}
