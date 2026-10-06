# @forgecy/mail

Invio email via SMTP (Nodemailer) e template delle email di sistema.

- `createMailer(env)` legge `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_REPLY_TO`. In sviluppo, senza `SMTP_HOST`, usa Mailpit (`localhost:1025`, senza auth). In produzione senza `SMTP_HOST` il mailer risulta `configured: false` e `sendMail` lancia `ForgecyError("unavailable")`.
- `mailer.sendMail({ to, subject, text, html })`, `mailer.verify()` per la pagina di stato, `mailer.close()`.
- `renderMagicLinkEmail({ url, minutes, appName })` restituisce oggetto, testo e HTML in italiano (HTML semplice e accessibile, nessuna immagine esterna).

Il corpo delle email non viene mai loggato: il link contiene il token. Il logger opzionale riceve solo `messageId` e i domini dei destinatari.
