"use client";

import { Badge, Button, Card, Label } from "@forgecy/ui";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { decideLessonAction, proposeLessonAction } from "../actions";
import { ActionButton } from "./action-button";

export interface LessonView {
  id: string;
  correction: string;
  rule: string;
  status: "proposed" | "accepted" | "rejected" | "stale";
  by: string;
  when: string;
}

/** Lessons log: corrections turned into rules. A person confirms; a proposal alone binds nothing. */
export function LessonsCard({
  slug,
  clientId,
  lessons,
  canPropose,
  canDecide,
}: {
  slug: string;
  clientId: string;
  lessons: LessonView[];
  canPropose: boolean;
  canDecide: boolean;
}) {
  const t = useTranslations("brand.lessons");
  const router = useRouter();
  const id = useId();
  const [correction, setCorrection] = useState("");
  const [rule, setRule] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-heading-sm text-fg">{t("title")}</h2>
        <p className="text-body-sm text-fg-muted">{t("intro")}</p>
      </div>
      {lessons.length ? (
        <ul className="space-y-3">
          {lessons.map((l) => (
            <li key={l.id} className="space-y-1 border-b border-subtle pb-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    l.status === "accepted"
                      ? "success"
                      : l.status === "proposed"
                        ? "info"
                        : "neutral"
                  }
                >
                  {t(`status.${l.status}`)}
                </Badge>
                <span className="text-body-sm text-fg-muted">
                  {t("by", { who: l.by, date: l.when })}
                </span>
              </div>
              <p className="text-body-md text-fg">{l.correction}</p>
              {l.rule ? (
                <p className="text-body-sm text-fg">{t("rule", { rule: l.rule })}</p>
              ) : null}
              {canDecide && l.status === "proposed" ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    size="sm"
                    action={decideLessonAction.bind(null, {
                      slug,
                      clientId,
                      id: l.id,
                      decision: "accepted",
                    })}
                  >
                    <Check aria-hidden />
                    {t("confirm")}
                  </ActionButton>
                  <ActionButton
                    size="sm"
                    variant="secondary"
                    action={decideLessonAction.bind(null, {
                      slug,
                      clientId,
                      id: l.id,
                      decision: "rejected",
                    })}
                  >
                    <X aria-hidden />
                    {t("reject")}
                  </ActionButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-fg-muted">{t("empty")}</p>
      )}
      {canPropose ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const r = await proposeLessonAction({ slug, clientId, correction, rule });
              if (!r.ok) return setError(r.error);
              setCorrection("");
              setRule("");
              router.refresh();
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`${id}-c`}>{t("correction")}</Label>
            <textarea
              id={`${id}-c`}
              required
              minLength={3}
              maxLength={600}
              rows={2}
              className="w-full rounded-md border border-control bg-surface px-3 py-2 text-body-md text-fg"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-r`}>{t("ruleLabel")}</Label>
            <textarea
              id={`${id}-r`}
              maxLength={600}
              rows={2}
              className="w-full rounded-md border border-control bg-surface px-3 py-2 text-body-md text-fg"
              value={rule}
              onChange={(e) => setRule(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {t("propose")}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
