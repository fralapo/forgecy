import type { SourceStatus } from "@forgecy/social";
import { getTranslations } from "next-intl/server";
import { ActionButton } from "../../brand/_components/action-button";
import { resumeSourceAction } from "../actions";

const SOURCES = ["graph_api", "public_web"] as const;

/**
 * Says what is missing when nothing can read Instagram, and lets an Admin resume a source that
 * Instagram stopped with a login or a check. Silent when everything works.
 */
export async function SourceBanner({
  slug,
  status,
  isAdmin,
}: {
  slug: string;
  status: SourceStatus;
  isAdmin: boolean;
}) {
  const t = await getTranslations("social");
  const stopped = SOURCES.filter((s) => status.blocked[s]);
  if (status.available.length === 0 && stopped.length === 0)
    return (
      <p
        role="status"
        className="mb-6 rounded-md border border-warning-fill bg-surface px-4 py-3 text-body-sm text-fg"
      >
        {t("source.none")}
      </p>
    );
  if (stopped.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {stopped.map((source) => (
        <div
          key={source}
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-error-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          <p>
            {t("source.blocked", { source: t(`sources.${source}`) })}
            {isAdmin ? null : ` ${t("source.adminOnly")}`}
          </p>
          {isAdmin ? (
            <ActionButton action={resumeSourceAction.bind(null, slug, source)} variant="secondary">
              {t("source.resume")}
            </ActionButton>
          ) : null}
        </div>
      ))}
    </div>
  );
}
