import { eq, getDb, users } from "@forgecy/db";
import { smtpOptionsFromEnv } from "@forgecy/mail";
import { Badge, Card } from "@forgecy/ui";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { AdminOnly } from "../_components/admin-only";
import { SmtpChecks } from "./smtp-checks";
import { lastSmtpTest } from "./status";

export async function generateMetadata() {
  const t = await getTranslations("admin.smtp");
  return { title: t("title") };
}

const MAILPIT_URL = "http://localhost:8025";

export default async function SmtpPage() {
  const user = await requireUser();
  const t = await getTranslations("admin.smtp");
  if (!user.isAdmin) return <AdminOnly title={t("title")} />;
  const format = await getFormat();
  const options = smtpOptionsFromEnv(env);
  // In development without SMTP_HOST the mailer targets Mailpit on localhost:1025.
  const devMailpit = !env.SMTP_HOST && options !== null;
  const last = await lastSmtpTest();
  const lastBy = last
    ? await getDb().query.users.findFirst({ where: eq(users.id, last.by), columns: { name: true } })
    : undefined;

  const rows: [string, string][] = options
    ? [
        [t("config.host"), String(options.host ?? "")],
        [t("config.port"), String(options.port ?? "")],
        [t("config.security"), t(options.secure ? "config.tls" : "config.starttls")],
        [t("config.username"), env.SMTP_USERNAME || t("config.none")],
        [t("config.password"), t(env.SMTP_PASSWORD ? "config.passwordSet" : "config.none")],
        [t("config.from"), env.SMTP_FROM],
        [t("config.replyTo"), env.SMTP_REPLY_TO || t("config.none")],
      ]
    : [];

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Badge variant={options ? "success" : "warning"}>
            {t(options ? "status.configured" : "status.not_configured")}
          </Badge>
        }
      />
      {devMailpit ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-subtle bg-surface p-4 text-body-sm text-fg"
        >
          {t.rich("mailpit", {
            link: (chunks) => (
              <a
                href={MAILPIT_URL}
                className="text-link underline"
                target="_blank"
                rel="noreferrer"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("config.title")}</h2>
          {options ? (
            <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-2 text-body-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-fg-muted">{label}</dt>
                  <dd className="break-all font-mono text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 text-body-sm text-fg">{t("config.missing")}</p>
          )}
          <p className="mt-4 text-body-sm text-fg-muted">{t("config.envHint")}</p>
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("test.title")}</h2>
          <p className="mt-2 text-body-sm text-fg-muted">
            {last
              ? t(last.ok ? "test.lastOk" : "test.lastFailed", {
                  date: format.date(last.at, "dateTime"),
                  name: lastBy?.name ?? "—",
                })
              : t("test.never")}
          </p>
          <SmtpChecks defaultTo={user.email} disabled={!options} />
        </Card>
      </div>
      <Card className="mt-6 p-6">
        <h2 className="text-heading-sm text-fg">{t("dns.title")}</h2>
        <p className="mt-2 text-body-sm text-fg-muted">{t("dns.intro")}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-body-sm text-fg">
          <li>{t("dns.spf")}</li>
          <li>{t("dns.dkim")}</li>
          <li>{t("dns.dmarc")}</li>
        </ul>
        <p className="mt-4 text-body-sm text-fg-muted">{t("dns.brevo")}</p>
      </Card>
    </>
  );
}
