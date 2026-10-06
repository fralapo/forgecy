/**
 * Allowlists for template markup. Layouts are written by people, but they arrive as
 * uploaded ZIPs: the renderer strips anything that could run code or reach the
 * network, and the template validation reports the same things as errors.
 */
export const ALLOWED_ELEMENTS = new Set([
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "img",
  "figure",
  "figcaption",
  "blockquote",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "mark",
  "br",
  "hr",
  "header",
  "footer",
  "section",
  "article",
  "main",
  "aside",
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "use",
  "symbol",
  "title",
  "desc",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "class",
  "id",
  "role",
  "alt",
  "src",
  "style",
  "width",
  "height",
  "viewbox",
  "xmlns",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "points",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "offset",
  "stop-color",
  "gradientunits",
  "preserveaspectratio",
  "href",
  "focusable",
]);

export function isAllowedAttribute(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("data-") || n.startsWith("aria-") || ALLOWED_ATTRIBUTES.has(n);
}

/** True when an attribute value could fetch or execute something. */
export function isDangerousValue(name: string, value: string): boolean {
  const n = name.toLowerCase();
  const v = value.trim().toLowerCase();
  if (n === "href") return !v.startsWith("#");
  if (n === "style") return /url\s*\(|expression\s*\(|@import/i.test(v);
  return /^\s*(javascript|vbscript|data:text\/html)/i.test(v);
}
