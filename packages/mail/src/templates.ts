import { DEFAULT_LOCALE, getTranslator, type Locale } from "@forgecy/i18n";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Magic link email in the recipient's language. Plain HTML, inline styles,
 * no external images or trackers.
 */
export async function renderMagicLinkEmail(input: {
  url: string;
  minutes: number;
  appName?: string;
  locale?: Locale;
}): Promise<RenderedEmail> {
  const app = input.appName ?? "Forgecy";
  const locale = input.locale ?? DEFAULT_LOCALE;
  const t = getTranslator(locale, "mail");
  const minutes = input.minutes;
  const subject = t("magicLink.subject", { app });
  const text = [
    t("magicLink.greeting"),
    "",
    t("magicLink.openLink", { app }),
    input.url,
    "",
    t("magicLink.expires", { minutes }),
    t("magicLink.ignore"),
    "",
    `— ${app}`,
  ].join("\n");

  const u = escapeHtml(input.url);
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px;background:#f6f6f4;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;">
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(t("magicLink.heading", { app }))}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${escapeHtml(t("magicLink.pressButton", { minutes }))}</p>
<p style="margin:0 0 24px;"><a href="${u}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">${escapeHtml(t("magicLink.button", { app }))}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#555555;">${escapeHtml(t("magicLink.copyAddress"))}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.5;word-break:break-all;"><a href="${u}" style="color:#1a1a1a;">${u}</a></p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#555555;">${escapeHtml(t("magicLink.ignore"))}</p>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}

/** Test email sent from Settings › Email (SMTP) to check the configuration end to end. */
export async function renderTestEmail(input: {
  appName?: string;
  locale?: Locale;
  sentBy: string;
}): Promise<RenderedEmail> {
  const app = input.appName ?? "Forgecy";
  const locale = input.locale ?? DEFAULT_LOCALE;
  const t = getTranslator(locale, "mail");
  const subject = t("test.subject", { app });
  const body = t("test.body", { app, name: input.sentBy });
  const text = [body, "", `— ${app}`].join("\n");
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f6f6f4;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;">
<p style="max-width:520px;margin:0 auto;padding:32px;background:#ffffff;border-radius:8px;font-size:16px;line-height:1.5;">${escapeHtml(body)}</p>
</body>
</html>`;
  return { subject, text, html };
}
