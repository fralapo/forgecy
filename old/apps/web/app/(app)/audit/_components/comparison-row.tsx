"use client";

import {
  comparisonChannels,
  comparisonOutcomes,
  type AuditEvidence,
  type ComparisonChannel,
  type ComparisonOutcome,
  type FindingStatus,
} from "@forgecy/core";
import { Badge, Button, Input, Label } from "@forgecy/ui";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { reviewFindingAction, setComparisonOutcomeAction } from "../actions";
import { findingStatusVariant, outcomeVariant } from "../_lib/labels";
import { selectClass } from "../_lib/styles";

export interface ComparisonRowView {
  id: string;
  title: string;
  rev: number;
  status: FindingStatus;
  outcome: ComparisonOutcome;
  proposedOutcome: ComparisonOutcome;
  rationale: string;
  outcomeNote?: string;
  cells: Partial<
    Record<
      ComparisonChannel,
      { value: string | null; unavailableReason?: string; evidence?: AuditEvidence[] }
    >
  >;
}

export function ComparisonRow({ row, readOnly }: { row: ComparisonRowView; readOnly: boolean }) {
  const router = useRouter();
  const t = useTranslations("audit");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ComparisonOutcome>(row.outcome);
  const changed = outcome !== row.proposedOutcome;
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-heading-sm text-fg">{row.title}</h3>
        <div className="flex gap-2">
          <Badge variant={outcomeVariant[row.outcome]}>{t(`outcome.${row.outcome}`)}</Badge>
          <Badge variant={findingStatusVariant[row.status]}>
            {t(`findingStatus.${row.status}`)}
          </Badge>
        </div>
      </header>
      <dl className="grid gap-3 sm:grid-cols-3">
        {comparisonChannels.map((c) => {
          const cell = row.cells[c];
          return (
            <div key={c} className="rounded-md border border-subtle p-3">
              <dt className="text-label text-fg-muted">{t(`channel.${c}`)}</dt>
              <dd className={cell?.value ? "text-body-sm text-fg" : "text-body-sm text-fg-muted"}>
                {cell?.value ??
                  (cell?.unavailableReason
                    ? t("comparisonRow.unavailableReason", { reason: cell.unavailableReason })
                    : t("comparisonRow.unavailable"))}
              </dd>
              {cell?.evidence?.length ? (
                <dd className="mt-1 text-body-sm text-fg-muted">
                  {t("comparisonRow.source", {
                    sources: cell.evidence
                      .map((e) => e.label)
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(", "),
                  })}
                </dd>
              ) : null}
            </div>
          );
        })}
      </dl>
      <p className="text-body-sm">{row.rationale}</p>
      {row.outcomeNote ? (
        <p className="text-body-sm text-fg-muted">
          {t("comparisonRow.note", {
            from: t(`outcome.${row.proposedOutcome}`).toLowerCase(),
            to: t(`outcome.${row.outcome}`).toLowerCase(),
            note: row.outcomeNote,
          })}
        </p>
      ) : null}
      {!readOnly ? (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-subtle pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
            start(async () => {
              setError(null);
              const res = await setComparisonOutcomeAction({
                id: row.id,
                outcome,
                ...(note ? { note } : {}),
                rev: row.rev,
              });
              if (!res.ok) return setError(res.error);
              router.refresh();
            });
          }}
        >
          <div className="flex w-48 flex-col gap-1">
            <Label htmlFor={`outcome-${row.id}`}>{t("comparisonRow.outcome")}</Label>
            <select
              id={`outcome-${row.id}`}
              className={selectClass}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as ComparisonOutcome)}
            >
              {comparisonOutcomes.map((o) => (
                <option key={o} value={o}>
                  {o === row.proposedOutcome
                    ? t("comparisonRow.proposedOption", { outcome: t(`outcome.${o}`) })
                    : t(`outcome.${o}`)}
                </option>
              ))}
            </select>
          </div>
          {changed ? (
            <div className="flex min-w-56 flex-1 flex-col gap-1">
              <Label htmlFor={`note-${row.id}`}>{t("comparisonRow.noteRequired")}</Label>
              <Input
                id={`note-${row.id}`}
                name="note"
                required
                maxLength={300}
                defaultValue={row.outcomeNote ?? ""}
              />
            </div>
          ) : null}
          <Button type="submit" size="sm" disabled={pending}>
            <Check aria-hidden />
            {row.status === "observed" ? t("comparisonRow.accept") : t("comparisonRow.save")}
          </Button>
          {row.status !== "rejected" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await reviewFindingAction({
                    id: row.id,
                    decision: "reject",
                    rev: row.rev,
                  });
                  if (!res.ok) return setError(res.error);
                  router.refresh();
                })
              }
            >
              {t("comparisonRow.rejectRow")}
            </Button>
          ) : null}
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </article>
  );
}
