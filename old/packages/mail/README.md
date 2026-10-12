# @forgecy/mail

Email sending via SMTP (Nodemailer) and templates for system emails.

- `createMailer(env)` reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_REPLY_TO`. In development, without `SMTP_HOST`, it uses Mailpit (`localhost:1025`, no auth). In production without `SMTP_HOST` the mailer reports `configured: false` and `sendMail` throws `ForgecyError("unavailable")`.
- `mailer.sendMail({ to, subject, text, html })`, `mailer.verify()` for the status page, `mailer.close()`.
- `renderMagicLinkEmail({ url, minutes, appName })` returns subject, text and HTML in English (simple, accessible HTML, no external images).

The email body is never logged: the link contains the token. The optional logger receives only `messageId` and the recipients' domains.
