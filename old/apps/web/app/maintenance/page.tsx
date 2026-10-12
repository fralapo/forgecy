import { Card } from "@forgecy/ui";
import { Wrench } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/lib/i18n";
import { MAINTENANCE_CODE, restoreUnderway } from "@/lib/maintenance";
import { RetryCountdown } from "./retry";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin.backup.restore.maintenance");
  return { title: t("title") };
}

/**
 * 503 maintenance (spec page 70): full screen, no shell, shown to everyone but the Admin
 * who started the restore. The proxy serves it with status 503; it retries every 15 s.
 */
export default async function MaintenancePage() {
  const status = await restoreUnderway();
  if (!status) redirect("/");
  const t = await getTranslations("admin.backup.restore.maintenance");
  const tc = await getTranslations("common");
  const format = await getFormat();
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <p className="font-display text-heading-sm text-fg">{tc("appName")}</p>
        <Wrench aria-hidden className="mt-6 size-8 text-fg-muted" />
        <h1 className="mt-4 text-heading-sm text-fg">{t("title")}</h1>
        <p className="mt-2 text-body-sm text-fg">
          {t("body", {
            name: status.requestedBy,
            time: format.date(status.requestedAt, "time"),
          })}
        </p>
        <p className="mt-4 text-body-sm text-fg-muted">
          {t("code")}: <code className="font-mono text-fg">{MAINTENANCE_CODE}</code>
        </p>
        <div className="mt-6">
          <RetryCountdown seconds={15} />
        </div>
      </Card>
    </main>
  );
}
