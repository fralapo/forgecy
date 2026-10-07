import {
  defaultModelFor,
  imageModelFor,
  imageProviderIds,
  imageProviderOrder,
  isMcpImageProvider,
  listMcpConnections,
  loadAiRoutingSettings,
  textProviderIds,
  type TextProviderId,
} from "@forgecy/ai";
import { getCommercialUseReviews, type ImageProvider } from "@forgecy/content";
import { getDb } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { BadgeCheck, Hourglass, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { currentRouting } from "@/lib/ai";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { CommercialUseForm } from "./commercial-use-form";
import { McpConnection } from "./mcp-connection";
import { RoutingForm } from "./routing-form";

export async function generateMetadata() {
  const t = await getTranslations("settings.aiProviders");
  return { title: t("title") };
}

const providerNames: Record<ImageProvider, string> = {
  openai: "OpenAI Images",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  higgsfield: "Higgsfield (MCP)",
};

/** Providers configured by API key; MCP ones are ready once connected. */
const keyReady: Partial<Record<ImageProvider, boolean>> = {
  openai: Boolean(env.OPENAI_API_KEY),
  google: Boolean(env.GOOGLE_AI_API_KEY),
  openrouter: Boolean(env.OPENROUTER_API_KEY),
};

const textNames: Record<TextProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  local: "",
};

const textReady: Record<TextProviderId, boolean> = {
  anthropic: Boolean(env.ANTHROPIC_API_KEY),
  openai: Boolean(env.OPENAI_API_KEY),
  openrouter: Boolean(env.OPENROUTER_API_KEY),
  deepseek: Boolean(env.DEEPSEEK_API_KEY),
  local: env.LOCAL_LLM_ENABLED,
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
  const tr = await getTranslations("settings.aiProviders.routing");
  const settings = await loadAiRoutingSettings(getDb());
  const { routing, images: imageRoute } = await currentRouting();
  // The first two usable image providers in the chosen order are primary and fallback.
  const roleOf = (p: ImageProvider) =>
    imageRoute[0]?.provider === p
      ? "primary"
      : imageRoute[1]?.provider === p
        ? "secondary"
        : "unused";
  const chosenImages =
    settings.images ?? imageProviderOrder(env).map((provider) => ({ provider, model: "" }));
  // Cards in the chosen order, then the providers switched off.
  const order: ImageProvider[] = [
    ...chosenImages.map((i) => i.provider),
    ...imageProviderIds.filter((p) => !chosenImages.some((i) => i.provider === p)),
  ];
  const ref = (m: { provider: string; model: string } | undefined) =>
    m ? `${m.provider} · ${m.model}` : "";

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
      <Card className="mb-6 grid gap-4 p-6">
        <div>
          <h2 className="text-heading-sm text-fg">{tr("title")}</h2>
          <p className="text-body-sm text-fg-muted">{tr("description")}</p>
        </div>
        <div className="grid gap-1 text-body-sm">
          <span className="text-fg-muted">{tr("inUse")}</span>
          <span className="font-mono text-fg">
            {tr("textInUse", { model: ref(routing.default.primary) })}
          </span>
          <span className="font-mono text-fg">
            {imageRoute[0] ? tr("imageInUse", { model: ref(imageRoute[0]) }) : tr("noImage")}
          </span>
        </div>
        <RoutingForm
          text={textProviderIds.map((id) => ({
            id,
            name: id === "local" ? tp("localModel") : textNames[id],
            ready: textReady[id],
            defaultModel: defaultModelFor(id, env),
          }))}
          images={imageProviderIds.map((id) => ({
            id,
            name: providerNames[id],
            ready: ready(id),
            defaultModel: imageModelFor(id, env),
          }))}
          initial={{
            text: settings.text ?? { provider: env.AI_DEFAULT_PROVIDER, model: "" },
            images: chosenImages,
          }}
        />
      </Card>
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
                  <p className="font-mono text-body-sm text-fg-muted">
                    {imageRoute.find((r) => r.provider === p)?.model ?? imageModelFor(p, env)}
                  </p>
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
                  <p className="text-body-sm text-fg-muted">{tm("hint.higgsfield")}</p>
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
