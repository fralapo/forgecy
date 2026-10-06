import {
  imageModelFor,
  imageProviderOrder,
  isMcpImageProvider,
  listMcpConnections,
} from "@forgecy/ai";
import { getCommercialUseReviews, type ImageProvider } from "@forgecy/content";
import { getDb } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { BadgeCheck, Hourglass, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { CommercialUseForm } from "./commercial-use-form";
import { McpConnection } from "./mcp-connection";

export async function generateMetadata() {
  const t = await getTranslations("settings.aiProviders");
  return { title: t("title") };
}

const providerNames: Record<ImageProvider, string> = {
  openai: "OpenAI Images",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  higgsfield: "Higgsfield (MCP)",
  weave: "Figma Weave (MCP)",
};

/** Providers configured by API key; MCP ones are ready once connected. */
const keyReady: Partial<Record<ImageProvider, boolean>> = {
  openai: Boolean(env.OPENAI_API_KEY),
  google: Boolean(env.GOOGLE_AI_API_KEY),
  openrouter: Boolean(env.OPENROUTER_API_KEY),
};

const mcpStatusBadge = {
  connected: "success",
  pending: "warning",
  error: "error",
} as const;

const statusBadge = {
  pending_verification: { variant: "warning", icon: Hourglass },
  verified: { variant: "success", icon: BadgeCheck },
  rejected: { variant: "error", icon: XCircle },
} as const;

export default async function AiProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ mcp?: string }>;
}) {
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
  const tm = await getTranslations("settings.aiProviders.mcp");
  const { mcp: mcpResult } = await searchParams;
  const reviews = await getCommercialUseReviews(getDb());
  const connections = await listMcpConnections(getDb());
  const ready = (p: ImageProvider) =>
    isMcpImageProvider(p) ? connections.get(p)?.status === "connected" : !!keyReady[p];
  // Order from IMAGE_PROVIDERS; the first two ready providers are primary and fallback.
  const order = imageProviderOrder(env);
  const configured = order.filter(ready);
  const roleOf = (p: ImageProvider) =>
    configured[0] === p ? "primary" : configured[1] === p ? "secondary" : "unused";

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {mcpResult === "connected" || mcpResult === "error" ? (
        <p
          role={mcpResult === "error" ? "alert" : "status"}
          className={`mb-6 text-body-sm ${mcpResult === "error" ? "text-error" : "text-success"}`}
        >
          {tm(`result.${mcpResult}`)}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {order.map((p) => {
          const isReady = ready(p);
          const connection = isMcpImageProvider(p) ? connections.get(p) : undefined;
          const review = reviews.get(p);
          const status = review?.status ?? "pending_verification";
          const badge = statusBadge[status];
          return (
            <Card key={p} className="flex flex-col gap-4 p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-heading-sm text-fg">{providerNames[p]}</h2>
                  <p className="text-body-sm text-fg-muted">{t(roleOf(p))}</p>
                  <p className="font-mono text-body-sm text-fg-muted">{imageModelFor(p, env)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isMcpImageProvider(p) ? (
                    <Badge variant={connection ? mcpStatusBadge[connection.status] : "neutral"}>
                      {tm(`status.${connection?.status ?? "notConnected"}`)}
                    </Badge>
                  ) : (
                    <Badge variant={isReady ? "success" : "neutral"}>
                      {tp(isReady ? "configured" : "notConfigured")}
                    </Badge>
                  )}
                  <Badge variant={badge.variant} icon={badge.icon}>
                    {t(`status.${status}`)}
                  </Badge>
                </div>
              </div>
              <p className="text-body-sm text-fg">
                {t(status === "verified" ? "available" : "unavailable")}
              </p>
              {isMcpImageProvider(p) ? (
                <div className="grid gap-3 rounded-md border border-subtle p-4">
                  <p className="text-body-sm text-fg-muted">
                    {p === "weave"
                      ? tm("hint.weave", { max: env.WEAVE_MAX_CREDITS_PER_IMAGE })
                      : tm("hint.higgsfield")}
                  </p>
                  {connection?.connectedAt && connection.status === "connected" ? (
                    <p className="text-body-sm text-fg">
                      {tm("connectedOn")} {format.date(connection.connectedAt, "long")}
                    </p>
                  ) : null}
                  {connection?.lastError ? (
                    <p className="break-words text-body-sm text-error">
                      {tm("lastError")}: {connection.lastError}
                    </p>
                  ) : null}
                  <McpConnection provider={p} connected={connection?.status === "connected"} />
                </div>
              ) : null}
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
