import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { ForgecyError, type Env } from "@forgecy/core";

export type MailEnv = Pick<
  Env,
  | "NODE_ENV"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_SECURE"
  | "SMTP_USERNAME"
  | "SMTP_PASSWORD"
  | "SMTP_FROM"
  | "SMTP_REPLY_TO"
>;

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export interface SentMail {
  messageId: string;
}

/** Minimal structured logger (pino-compatible). Message bodies are never logged: they may hold tokens. */
export interface MailLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface Mailer {
  /** False when no SMTP server is configured (production without SMTP_HOST): sendMail then throws. */
  readonly configured: boolean;
  sendMail(message: MailMessage): Promise<SentMail>;
  /** Check connection and credentials (for the setup/health page). */
  verify(): Promise<boolean>;
  close(): void;
}

export interface CreateMailerOptions {
  /** Override the transport (tests: `{ jsonTransport: true }` or `{ streamTransport: true }`). */
  transport?: Parameters<typeof nodemailer.createTransport>[0];
  logger?: MailLogger;
}

/**
 * SMTP options from SMTP_* variables. In development with SMTP_HOST unset it targets
 * Mailpit (localhost:1025, no auth, no TLS). Returns null when nothing is configured.
 */
export function smtpOptionsFromEnv(env: MailEnv): SMTPTransport.Options | null {
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === "production") return null;
    return {
      host: "localhost",
      port: 1025,
      secure: false,
      ignoreTLS: true,
      logger: false,
      debug: false,
    };
  }
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // true = implicit TLS (465); false = STARTTLS upgrade when offered (587).
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USERNAME
      ? { auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD ?? "" } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
  };
}

function domainsOf(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to]).map((a) =>
    a
      .slice(a.lastIndexOf("@") + 1)
      .replace(/>$/, "")
      .toLowerCase(),
  );
}

export function createMailer(env: MailEnv, options: CreateMailerOptions = {}): Mailer {
  const transportOptions = options.transport ?? smtpOptionsFromEnv(env);
  const transporter: Transporter | null = transportOptions
    ? nodemailer.createTransport(transportOptions as SMTPTransport.Options, {
        from: env.SMTP_FROM,
        ...(env.SMTP_REPLY_TO ? { replyTo: env.SMTP_REPLY_TO } : {}),
      })
    : null;
  const log = options.logger;

  return {
    configured: transporter !== null,
    async sendMail(message) {
      if (!transporter) throw new ForgecyError("unavailable", "SMTP non configurato (SMTP_HOST)");
      try {
        const info = (await transporter.sendMail({
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        })) as { messageId?: string };
        log?.info({ messageId: info.messageId, toDomains: domainsOf(message.to) }, "mail sent");
        return { messageId: info.messageId ?? "" };
      } catch (err) {
        // Only the SMTP error message: never the message body.
        log?.error(
          { err: (err as Error).message, toDomains: domainsOf(message.to) },
          "mail send failed",
        );
        throw new ForgecyError("unavailable", "Invio email non riuscito", {
          cause: (err as Error).message,
        });
      }
    },
    async verify() {
      if (!transporter) return false;
      try {
        return await transporter.verify();
      } catch {
        return false;
      }
    },
    close() {
      transporter?.close();
    },
  };
}
