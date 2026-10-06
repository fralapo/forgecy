import { getCommercialUseReviews, imageProviders, type ImageProvider } from "@forgecy/content";
import { getDb } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { BadgeCheck, Hourglass, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { CommercialUseForm } from "./commercial-use-form";

export async function generateMetadata() {
  const t = await getTranslations("settings.aiProviders");
  return { title: t("title") };
}

const providerInfo: Record<
  ImageProvider,
  { name: string; role: "primary" | "secondary"; ready: boolean }
> = {
  openai: { name: "OpenAI Images", role: "primary", ready: Boolean(env.OPENAI_API_KEY) },
  google: { name: "Google Gemini", role: "secondary", ready: Boolean(env.GOOGLE_AI_API_KEY) },
};

const statusBadge = {
  pending_verification: { variant: "warning", icon: Hourglass },
  verified: { variant: "success", icon: BadgeCheck },
  rejected: { variant: "error", icon: XCircle },
} as const;

export default async function AiProvidersPage() {
  const user = await requireUser();
  const t = await getTranslations("settings.aiProviders");
  const tp = await getTranslations("settings.providers");
  if (!user.isAdmin)
    return (
      <>
        <PageHeader title={t("title")} />
        <p role="alert" className="text-body text-fg">
          {(await getTranslations("errors"))("adminOnly")}
        </p>
      </>
    );
  const format = await getFormat();
  const reviews = await getCommercialUseReviews(getDb());

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 lg:grid-cols-2">
        {imageProviders.map((p) => {
          const info = providerInfo[p];
          const review = reviews.get(p);
          const status = review?.status ?? "pending_verification";
          const badge = statusBadge[status];
          return (
            <Card key={p} className="flex flex-col gap-4 p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-heading-sm text-fg">{info.name}</h2>
                  <p className="text-body-sm text-fg-muted">{t(info.role)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={info.ready ? "success" : "neutral"}>
                    {tp(info.ready ? "configured" : "notConfigured")}
                  </Badge>
                  <Badge variant={badge.variant} icon={badge.icon}>
                    {t(`status.${status}`)}
                  </Badge>
                </div>
              </div>
              <p className="text-body-sm text-fg">
                {t(status === "verified" ? "available" : "unavailable")}
              </p>
              <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-body-sm">
                <dt className="text-fg-muted">{t("verifiedBy")}</dt>
                <dd className="text-fg">{review?.updatedBy?.name ?? "—"}</dd>
                <dt className="text-fg-muted">{t("consultedOn")}</dt>
                <dd className="text-fg">
                  {review?.consultedOn
                    ? format.date(`${review.consultedOn}T12:00:00`, "long")
                    : "—"}
                </dd>
                <dt className="text-fg-muted">{t("terms")}</dt>
                <dd className="min-w-0 break-all text-fg">
                  {review?.termsUrl ? (
                    <a
                      href={review.termsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-link underline"
                    >
                      {review.termsUrl}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-fg-muted">{t("note")}</dt>
                <dd className="text-fg">{review?.note ?? "—"}</dd>
              </dl>
              <CommercialUseForm
                provider={p}
                initial={{
                  status,
                  termsUrl: review?.termsUrl ?? "",
                  consultedOn: review?.consultedOn ?? "",
                  note: review?.note ?? "",
                }}
              />
            </Card>
          );
        })}
      </div>
    </>
  );
}
