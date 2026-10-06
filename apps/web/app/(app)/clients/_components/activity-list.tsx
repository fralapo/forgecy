import { Badge } from "@forgecy/ui";
import { Bot, Cog, User } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/lib/i18n";
import {
  activityArea,
  activityHref,
  activityObject,
  activityVerb,
  actorVerb,
  isAnomaly,
  parseActor,
} from "../_lib/activity";
import type { ActivityRow } from "../_lib/server";

/** Timeline of a client's events, grouped by day, newest first. */
export async function ActivityList({
  rows,
  clientSlug,
  headingLevel = "h3",
}: {
  rows: ActivityRow[];
  clientSlug: string;
  headingLevel?: "h2" | "h3";
}) {
  const t = await getTranslations("clients.activity");
  const tr = await getTranslations("brand.agentRole");
  const format = await getFormat();
  const now = new Date();
  const today = format.date(now, "long");
  const yesterday = format.date(new Date(now.getTime() - 86_400_000), "long");
  const dayLabel = (day: string) =>
    day === today ? t("today") : day === yesterday ? t("yesterday") : day;

  const days: Array<{ day: string; rows: ActivityRow[] }> = [];
  for (const row of rows) {
    const day = format.date(row.e.at, "long");
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  const Heading = headingLevel;

  return (
    <div className="space-y-6">
      {days.map(({ day, rows: dayRows }) => (
        <section key={day}>
          <Heading className="mb-2 text-label font-medium text-fg-muted">{dayLabel(day)}</Heading>
          <ol className="divide-y divide-subtle">
            {dayRows.map(({ e, userName }) => {
              const actor = parseActor(e.actor, e.actorUserId);
              const verb = actorVerb(actor, activityVerb(e.action));
              const href = activityHref(clientSlug, e.entity, e.entityId);
              const object = t(`objects.${activityObject(e.entity)}`);
              const actorName =
                actor.kind === "person"
                  ? (userName ?? t("actor.deletedUser"))
                  : actor.kind === "agent"
                    ? t("actor.agent", { role: tr(actor.role ?? "agent") })
                    : t("actor.system");
              const ActorIcon = actor.kind === "person" ? User : actor.kind === "agent" ? Bot : Cog;
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <time
                    dateTime={e.at.toISOString()}
                    className="w-12 shrink-0 font-mono text-body-sm text-fg-muted"
                  >
                    {format.date(e.at, "time")}
                  </time>
                  <span className="inline-flex items-center gap-1 text-body-sm text-fg">
                    <ActorIcon aria-hidden className="size-4 text-fg-muted" />
                    {actorName}
                  </span>
                  <span className="text-body-sm text-fg-muted">{t(`verbs.${verb}`)}</span>
                  {href ? (
                    <Link
                      href={href as Route}
                      className="text-body-sm text-link underline-offset-2 hover:underline"
                    >
                      {object}
                    </Link>
                  ) : (
                    <span className="text-body-sm text-fg">{object}</span>
                  )}
                  <Badge>{t(`areas.${activityArea(e.entity)}`)}</Badge>
                  {isAnomaly(actor, verb) ? <Badge variant="error">{t("anomaly")}</Badge> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
