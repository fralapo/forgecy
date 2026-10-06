"use client";

import type { AiProposalTexts } from "@forgecy/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/** The texts of the AiProposal frame in the interface language. */
export function useAiProposalTexts(agent: string): AiProposalTexts {
  const t = useTranslations("design.aiProposal");
  return {
    kicker: t("kicker"),
    byline: t.rich("byline", {
      agent,
      code: (chunks: ReactNode) => <code className="font-mono text-mono-md text-fg">{chunks}</code>,
    }),
    sources: t("sources"),
    noSources: t("noSources"),
    accept: t("accept"),
    reject: t("reject"),
  };
}
