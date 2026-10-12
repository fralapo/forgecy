import { type TemplatePackage, isSafePackagePath, packageFileDataUrl } from "./package";

const URL_RE = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/** Resolve `rel` against the directory of `from` inside the package. */
export function resolvePackagePath(from: string, rel: string): string | undefined {
  if (/^[a-z]+:/i.test(rel) || rel.startsWith("/") || rel.startsWith("//")) return undefined;
  const parts = from.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  const p = parts.join("/");
  return isSafePackagePath(p) ? p : undefined;
}

/**
 * Make template CSS self-contained: package files referenced with url() become data
 * URLs, anything else (remote URLs, @import) is dropped, so Chromium never touches
 * the network and the output only depends on the package.
 */
export function inlineCss(css: string, pkg: TemplatePackage, cssPath: string): string {
  return (
    css
      .replace(/@import[^;]*;?/gi, "")
      .replace(URL_RE, (_m, _q, ref: string) => {
        const path = resolvePackagePath(cssPath, ref.trim());
        const data = path ? packageFileDataUrl(pkg, path) : undefined;
        return data ? `url("${data}")` : "none";
      })
      // A stray "</style" would close the element early.
      .replace(/<\/(style)/gi, "<\\/$1")
  );
}

/** `"Space Grotesk", system-ui, sans-serif` from a bare family name. */
export function fontStack(family: string): string {
  const clean = family.replace(/["'\\;{}<>]/g, "").trim();
  return `"${clean}", system-ui, sans-serif`;
}

export function fontFaceRule(family: string, src: string, weight: string, style: string): string {
  const clean = family.replace(/["'\\;{}<>]/g, "").trim();
  return `@font-face{font-family:"${clean}";src:url("${src}");font-weight:${weight};font-style:${style};font-display:block}`;
}
