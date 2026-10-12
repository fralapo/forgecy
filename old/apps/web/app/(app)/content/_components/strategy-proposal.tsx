"use client";

import { AiProposal, Input, Label } from "@forgecy/ui";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { decideProposalAction } from "../actions";
import { FormError, useSave } from "./strategy-forms";
import { useAiProposalTexts } from "@/lib/use-ai-proposal-texts";

/** A Planner proposal (pillar or rubric): a person accepts or rejects it, with an optional note. */
export function StrategyProposalCard({
  slug,
  clientId,
  kind,
  id,
  title,
  agent,
  sources,
  children,
}: {
  slug: string;
  clientId: string;
  kind: "pillar" | "rubric";
  id: string;
  title: string;
  agent: string;
  sources: { label: string }[];
  children: ReactNode;
}) {
  const [note, setNote] = useState("");
  const noteId = useId();
  const t = useTranslations("content.strategy.proposal");
  const proposalTexts = useAiProposalTexts(agent);
  const { pending, error, run } = useSave();
  const decide = (decision: "accept" | "reject") =>
    run(() => decideProposalAction({ slug, clientId, kind, id, decision, note: note.trim() }));
  return (
    <AiProposal
      title={title}
      agent={agent}
      sources={sources}
      texts={proposalTexts}
      pending={pending}
      onAccept={() => decide("accept")}
      onReject={() => decide("reject")}
    >
      <div className="space-y-3">
        {children}
        <div className="space-y-1">
          <Label htmlFor={noteId}>{t("note")}</Label>
          <Input
            id={noteId}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <FormError error={error} />
      </div>
    </AiProposal>
  );
}
