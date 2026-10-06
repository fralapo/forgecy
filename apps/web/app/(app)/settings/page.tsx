import { Badge, Card } from "@forgecy/ui";
import { asc, eq, getDb, users } from "@forgecy/db";
import { LOCALES, loadMessages, negotiateLocale } from "@forgecy/i18n";
import { smtpOptionsFromEnv } from "@forgecy/mail";
import { headers } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { currentRouting } from "@/lib/ai";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { getTheme } from "@/lib/theme";
import { EmailNotificationsForm } from "./email-notifications-form";
import { LanguageForm } from "./language-form";
import { NewUserForm } from "./new-user-form";
import { ThemeForm } from "./theme-form";
import { WorkerCheck } from "./worker-check";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const user = await requireUser();
  const t = await getTranslations("settings");
  const te = await getTranslations("enums");
  const tc = await getTranslations("common");
  const people = user.isAdmin ? await getDb().select().from(users).orderBy(asc(users.name)) : [];
  const [me] = await getDb()
    .select({ emailNotifications: users.emailNotifications })
    .from(users)
    .where(eq(users.id, user.id));
  // Each language is listed by its own name, taken from its own messages.
  const languages = await Promise.all(
    LOCALES.map(async (code) => ({ code, name: (await loadMessages(code)).meta.languageName })),
  );
  const { routing } = await currentRouting();
  const browser = negotiateLocale((await headers()).get("accept-language"));
  // Only whether a key is configured, never the key itself.
  const providers = [
    { name: "Anthropic", ready: Boolean(env.ANTHROPIC_API_KEY) },
    { name: "OpenAI", ready: Boolean(env.OPENAI_API_KEY) },
    { name: "OpenRouter", ready: Boolean(env.OPENROUTER_API_KEY) },
    { name: "DeepSeek", ready: Boolean(env.DEEPSEEK_API_KEY) },
    { name: t("providers.googleImages"), ready: Boolean(env.GOOGLE_AI_API_KEY) },
    { name: t("providers.localModel"), ready: env.LOCAL_LLM_ENABLED },
  ];

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("preferences.title")}</h2>
          <LanguageForm
            current={user.locale ?? ""}
            languages={languages}
            browserLanguage={languages.find((l) => l.code === browser)?.name ?? browser}
          />
          <ThemeForm current={await getTheme()} />
          <EmailNotificationsForm
            current={me?.emailNotifications ?? false}
            smtpReady={smtpOptionsFromEnv(env) !== null}
          />
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("instance.title")}</h2>
          <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-2 text-body-sm">
            <dt className="text-fg-muted">{t("instance.access")}</dt>
            <dd className="text-fg">{te(`authMode.${env.FORGECY_AUTH_MODE}`)}</dd>
            <dt className="text-fg-muted">{t("instance.storage")}</dt>
            <dd className="text-fg">
              {te(env.STORAGE_DRIVER === "local" ? "storageDriver.local" : "storageDriver.s3")}
            </dd>
            <dt className="text-fg-muted">{t("instance.defaultProvider")}</dt>
            <dd className="font-mono text-fg">
              {routing.default.primary.provider} · {routing.default.primary.model}
            </dd>
          </dl>
          {user.isAdmin ? <WorkerCheck /> : null}
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("providers.title")}</h2>
          <p className="mt-2 text-body-sm text-fg-muted">{t("providers.hint")}</p>
          <ul className="mt-4 space-y-2">
            {providers.map((p) => (
              <li key={p.name} className="flex items-center justify-between text-body-sm">
                <span className="text-fg">{p.name}</span>
                <Badge variant={p.ready ? "success" : "neutral"}>
                  {t(p.ready ? "providers.configured" : "providers.notConfigured")}
                </Badge>
              </li>
            ))}
          </ul>
          {user.isAdmin ? (
            <Link
              href="/settings/ai-providers"
              className="mt-4 inline-block text-body-sm text-link underline"
            >
              {t("providers.commercialUseLink")}
            </Link>
          ) : null}
        </Card>
        {user.isAdmin ? (
          <>
            <Card className="p-6">
              <h2 className="text-heading-sm text-fg">{t("people.title")}</h2>
              <ul className="mt-4 divide-y divide-subtle">
                {people.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-body-sm">
                    <span>
                      <span className="block text-fg">{p.name}</span>
                      <span className="text-fg-muted">{p.email}</span>
                    </span>
                    <span className="flex gap-2">
                      {p.isAdmin ? <Badge>{tc("role.admin")}</Badge> : null}
                      {!p.active ? (
                        <Badge variant="warning">{t("people.deactivated")}</Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-6">
              <h2 className="text-heading-sm text-fg">{t("newUser.title")}</h2>
              <NewUserForm />
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
