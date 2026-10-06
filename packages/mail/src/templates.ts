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

function minutesLabel(n: number): string {
  return n === 1 ? "1 minuto" : `${n} minuti`;
}

/** Magic link email (Italian). Plain HTML, inline styles, no external images or trackers. */
export function renderMagicLinkEmail(input: {
  url: string;
  minutes: number;
  appName?: string;
}): RenderedEmail {
  const app = input.appName ?? "Forgecy";
  const ttl = minutesLabel(input.minutes);
  const subject = `Il tuo link di accesso a ${app}`;
  const text = [
    "Ciao,",
    "",
    `per accedere a ${app} apri questo link:`,
    input.url,
    "",
    `Il link vale una sola volta e scade tra ${ttl}.`,
    "Se non hai chiesto tu l'accesso, ignora questa email: nessuno può entrare senza il link.",
    "",
    `— ${app}`,
  ].join("\n");

  const a = escapeHtml(app);
  const u = escapeHtml(input.url);
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px;background:#f6f6f4;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;">
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">Accedi a ${a}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">Premi il pulsante per entrare. Il link vale una sola volta e scade tra ${escapeHtml(ttl)}.</p>
<p style="margin:0 0 24px;"><a href="${u}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Accedi a ${a}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#555555;">Se il pulsante non funziona, copia questo indirizzo nel browser:</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.5;word-break:break-all;"><a href="${u}" style="color:#1a1a1a;">${u}</a></p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#555555;">Se non hai chiesto tu l'accesso, ignora questa email: nessuno può entrare senza il link.</p>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}
