import { describe, expect, it, vi } from "vitest";
import {
  createMailer,
  renderMagicLinkEmail,
  renderNotificationsEmail,
  smtpOptionsFromEnv,
  type MailEnv,
} from "../src";

const env: MailEnv = {
  NODE_ENV: "development",
  SMTP_HOST: undefined,
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USERNAME: undefined,
  SMTP_PASSWORD: undefined,
  SMTP_FROM: "Forgecy <forgecy@localhost>",
  SMTP_REPLY_TO: "help@example.com",
};

describe("smtpOptionsFromEnv", () => {
  it("targets Mailpit in development when SMTP_HOST is unset", () => {
    expect(smtpOptionsFromEnv(env)).toMatchObject({ host: "localhost", port: 1025, secure: false });
  });
  it("is unconfigured in production without SMTP_HOST", () => {
    expect(smtpOptionsFromEnv({ ...env, NODE_ENV: "production" })).toBeNull();
    expect(createMailer({ ...env, NODE_ENV: "production" }).configured).toBe(false);
  });
  it("maps SMTP_* variables", () => {
    const o = smtpOptionsFromEnv({
      ...env,
      SMTP_HOST: "smtp-relay.brevo.com",
      SMTP_SECURE: true,
      SMTP_PORT: 465,
      SMTP_USERNAME: "u",
      SMTP_PASSWORD: "p",
    });
    expect(o).toMatchObject({
      host: "smtp-relay.brevo.com",
      port: 465,
      secure: true,
      auth: { user: "u", pass: "p" },
    });
  });
});

describe("renderMagicLinkEmail", () => {
  it("renders English subject, text and escaped html", async () => {
    const url = "https://forgecy.local/api/auth/magic-link/verify?token=abc&callbackURL=%2F";
    const m = await renderMagicLinkEmail({ url, minutes: 15, appName: "Forgecy" });
    expect(m.subject).toBe("Your sign-in link for Forgecy");
    expect(m.text).toContain(url);
    expect(m.text).toContain("15 minutes");
    expect(m.html).toContain('lang="en"');
    expect(m.html).toContain("token=abc&amp;callbackURL");
    expect(m.html).not.toMatch(/<img/i);
    expect((await renderMagicLinkEmail({ url, minutes: 1, appName: "<b>" })).html).toContain(
      "&lt;b&gt;",
    );
  });

  it("renders in the recipient's language", async () => {
    const m = await renderMagicLinkEmail({ url: "https://x.test/v", minutes: 15, locale: "it" });
    expect(m.subject).toBe("Il tuo link di accesso a Forgecy");
    expect(m.text).toContain("15 minuti");
    expect(m.html).toContain('lang="it"');
  });
});

describe("createMailer", () => {
  it("sends through the configured transport with defaults and never logs the body", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const mailer = createMailer(env, { transport: { jsonTransport: true }, logger });
    const m = await renderMagicLinkEmail({
      url: "https://x.test/verify?token=SECRET123",
      minutes: 15,
    });
    const sent = await mailer.sendMail({ to: "anna@agency.it", ...m });
    expect(sent.messageId).toBeTruthy();
    expect(logger.info).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("SECRET123");
    expect(JSON.stringify(logger.info.mock.calls)).toContain("agency.it");
    mailer.close();
  });

  it("works with the stream transport", async () => {
    const mailer = createMailer(env, { transport: { streamTransport: true, buffer: true } });
    expect(
      (
        await mailer.sendMail({
          to: ["a@b.it", "c@d.it"],
          subject: "Test",
          text: "hello",
          html: "<p>hello</p>",
        })
      ).messageId,
    ).toBeTruthy();
  });

  it("throws unavailable when SMTP is not configured", async () => {
    const mailer = createMailer({ ...env, NODE_ENV: "production" });
    await expect(mailer.sendMail({ to: "a@b.it", subject: "x", text: "y" })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("renderNotificationsEmail", () => {
  const n = (url: string) => ({
    kind: "content_approved" as const,
    params: { client: "Rossi <Srl>", title: "Spring", version: 2 },
    url,
  });

  it("uses the notification as subject when there is one, escaped in HTML", async () => {
    const mail = await renderNotificationsEmail({
      locale: "en",
      notifications: [n("https://forgecy.test/notifications/1")],
      settingsUrl: "https://forgecy.test/settings",
    });
    expect(mail.subject).toBe("Forgecy: Rossi <Srl>: “Spring” v2 was approved.");
    expect(mail.text).toContain("https://forgecy.test/notifications/1");
    expect(mail.html).toContain("Rossi &lt;Srl&gt;");
    expect(mail.html).not.toContain("<Srl>");
  });

  it("counts several in the reader's language", async () => {
    const mail = await renderNotificationsEmail({
      locale: "it",
      notifications: [n("https://a.test/1"), n("https://a.test/2")],
      settingsUrl: "https://a.test/settings",
    });
    expect(mail.subject).toBe("Forgecy: 2 nuove notifiche");
    expect(mail.text).toContain("«Spring» v2 è stato approvato.");
  });
});
