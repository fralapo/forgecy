import { getCommercialUseReviews, imageProviders, type ImageProvider } from "@forgecy/content";
import { getDb } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { BadgeCheck, Hourglass, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { CommercialUseForm } from "./commercial-use-form";

export const metadata = { title: "AI providers" };

const providerInfo: Record<ImageProvider, { name: string; role: string; ready: boolean }> = {
  openai: { name: "OpenAI Images", role: "Primary", ready: Boolean(env.OPENAI_API_KEY) },
  google: { name: "Google Gemini", role: "Secondary", ready: Boolean(env.GOOGLE_AI_API_KEY) },
};

const statusBadge = {
  pending_verification: { label: "Pending verification", variant: "warning", icon: Hourglass },
  verified: { label: "Verified", variant: "success", icon: BadgeCheck },
  rejected: { label: "Not allowed", variant: "error", icon: XCircle },
} as const;

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "long" });

export default async function AiProvidersPage() {
  const user = await requireUser();
  if (!user.isAdmin)
    return (
      <>
        <PageHeader title="AI providers" />
        <p role="alert" className="text-body text-fg">
          This setting is reserved for Admin users.
        </p>
      </>
    );
  const reviews = await getCommercialUseReviews(getDb());

  return (
    <>
      <PageHeader
        title="AI providers"
        description="Commercial use of generated images: an Admin verifies it by reading the provider’s terms."
      />
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
                  <p className="text-body-sm text-fg-muted">{info.role}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={info.ready ? "success" : "neutral"}>
                    {info.ready ? "Configured" : "Not configured"}
                  </Badge>
                  <Badge variant={badge.variant} icon={badge.icon}>
                    {badge.label}
                  </Badge>
                </div>
              </div>
              <p className="text-body-sm text-fg">
                {status === "verified"
                  ? "Available for clients whose policy allows it."
                  : "Not used with real clients: image generation is off for every client."}
              </p>
              <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-body-sm">
                <dt className="text-fg-muted">Verified by</dt>
                <dd className="text-fg">{review?.updatedBy?.name ?? "—"}</dd>
                <dt className="text-fg-muted">Terms consulted on</dt>
                <dd className="text-fg">
                  {review?.consultedOn
                    ? dateFormat.format(new Date(`${review.consultedOn}T12:00:00`))
                    : "—"}
                </dd>
                <dt className="text-fg-muted">Terms</dt>
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
                <dt className="text-fg-muted">Note</dt>
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
