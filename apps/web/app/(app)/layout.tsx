import { readRestoreStatus, restoreInProgress } from "@forgecy/backup";
import { resolveMediaRoot } from "@forgecy/files";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthShell } from "@/components/auth-shell";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { RefreshWhileRunning } from "./settings/backup/forms";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // During a restore the data is being replaced: only Admins (who follow it in
  // Settings › Backup) keep using the app; everyone else waits (spec 16.4).
  if (!user.isAdmin) {
    const status = await readRestoreStatus(resolveMediaRoot(env.FORGECY_DATA_DIR));
    if (status && restoreInProgress(status)) {
      const t = await getTranslations("admin.backup.restore.maintenance");
      const format = await getFormat();
      return (
        <AuthShell title={t("title")} description={t("body")}>
          <RefreshWhileRunning active />
          <p role="status" className="text-body-sm text-fg-muted">
            {t("since", { date: format.date(status.requestedAt, "dateTime") })}
          </p>
        </AuthShell>
      );
    }
  }
  return <AppShell user={user}>{children}</AppShell>;
}
