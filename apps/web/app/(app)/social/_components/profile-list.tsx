import type { SocialProfileStatus } from "@forgecy/core";
import { Badge, Card } from "@forgecy/ui";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ProfileListItem } from "@forgecy/social";
import { ActionButton } from "../../brand/_components/action-button";
import { readNowAction, removeProfileAction, tryAgainAction } from "../actions";
import { socialPath } from "../_lib/server";
import { MonitorToggle } from "./monitor-toggle";
import { getFormat, getRefText } from "@/lib/i18n";

const stateVariant = {
  pending: "neutral",
  ok: "success",
  error: "warning",
  blocked: "error",
  paused: "warning",
} as const satisfies Record<SocialProfileStatus, string>;

/** The profiles followed for a client, one calm row each. */
export async function ProfileList({
  slug,
  items,
  reading,
  canEdit,
}: {
  slug: string;
  items: ProfileListItem[];
  /** Ids of the profiles being read right now. */
  reading: ReadonlySet<string>;
  canEdit: boolean;
}) {
  const t = await getTranslations("social");
  const format = await getFormat();
  const refText = await getRefText();
  return (
    <Card className="mb-6 p-0">
      <h2 className="px-6 pt-6 text-heading-sm text-fg">{t("list.title")}</h2>
      {items.length === 0 ? (
        <p className="px-6 pb-6 text-body-sm text-fg-muted">{t("list.empty")}</p>
      ) : (
        <ul className="divide-y divide-subtle">
          {items.map(({ profile, snapshot, postsStored }) => {
            const isReading = reading.has(profile.id);
            const failed = ["error", "blocked", "paused"].includes(profile.status);
            return (
              <li key={profile.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 px-6 py-4">
                <div className="min-w-60 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={socialPath(slug, profile.handle) as Route}
                      className="text-heading-sm text-link"
                    >
                      @{profile.handle}
                    </Link>
                    <Badge variant={profile.role === "self" ? "info" : "neutral"}>
                      {t(`roles.${profile.role}`)}
                    </Badge>
                    {isReading ? (
                      <Badge variant="info">{t("list.reading")}</Badge>
                    ) : (
                      <Badge variant={stateVariant[profile.status]}>
                        {t(`state.${profile.status}`)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-body-sm text-fg-muted">
                    {snapshot?.followers != null
                      ? t("list.followers", { count: snapshot.followers })
                      : t("unavailable")}
                    {" · "}
                    {profile.lastSnapshotAt
                      ? t("list.readAgo", { when: format.relative(profile.lastSnapshotAt) })
                      : t("list.neverRead")}
                    {" · "}
                    {t("list.posts", { count: postsStored })}
                  </p>
                  {failed && !isReading && profile.statusReason ? (
                    <p className="text-body-sm text-fg">
                      {refText(profile.statusReason, profile.statusReason.key)}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <MonitorToggle
                      slug={slug}
                      profileId={profile.id}
                      monitored={profile.monitored}
                    />
                    {failed && !isReading ? (
                      <ActionButton
                        action={tryAgainAction.bind(null, slug, profile.id)}
                        variant="secondary"
                        size="sm"
                      >
                        <RotateCcw aria-hidden />
                        {t("list.tryAgain")}
                      </ActionButton>
                    ) : (
                      <ActionButton
                        action={readNowAction.bind(null, slug, profile.id)}
                        variant="secondary"
                        size="sm"
                        disabled={isReading}
                      >
                        <RefreshCw aria-hidden />
                        {t("list.readNow")}
                      </ActionButton>
                    )}
                    <ActionButton
                      action={removeProfileAction.bind(null, slug, profile.id)}
                      variant="ghost"
                      size="sm"
                      confirm={t("list.removeConfirm", { handle: profile.handle })}
                    >
                      <Trash2 aria-hidden />
                      {t("list.remove")}
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
