import { describe, expect, it, vi } from "vitest";
import { createMailer, renderMagicLinkEmail, smtpOptionsFromEnv, type MailEnv } from "../src";

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
  it("renders Italian subject, text and escaped html", () => {
    const url = "https://forgecy.local/api/auth/magic-link/verify?token=abc&callbackURL=%2F";
    const m = renderMagicLinkEmail({ url, minutes: 15, appName: "Forgecy" });
    expect(m.subject).toBe("Il tuo link di accesso a Forgecy");
    expect(m.text).toContain(url);
    expect(m.text).toContain("15 minuti");
    expect(m.html).toContain('lang="it"');
    expect(m.html).toContain("token=abc&amp;callbackURL");
    expect(m.html).not.toMatch(/<img/i);
    expect(renderMagicLinkEmail({ url, minutes: 1, appName: "<b>" }).html).toContain("&lt;b&gt;");
  });
});

describe("createMailer", () => {
  it("sends through the configured transport with defaults and never logs the body", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const mailer = createMailer(env, { transport: { jsonTransport: true }, logger });
    const m = renderMagicLinkEmail({ url: "https://x.test/verify?token=SECRET123", minutes: 15 });
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
          subject: "Prova",
          text: "ciao",
          html: "<p>ciao</p>",
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
