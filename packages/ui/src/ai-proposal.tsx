"use client";

import { Bot, Check, FileText, Sparkles, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";

export interface AiProposalSource {
  /** Human-readable source title. */
  label: string;
  /** Optional link to the source. */
  href?: string;
}

export interface AiProposalProps extends Omit<ComponentProps<"section">, "title"> {
  title: ReactNode;
  /** Agent that authored the proposal (e.g. skill name). Shown in mono. */
  agent: string;
  sources: readonly AiProposalSource[];
  children?: ReactNode;
  onAccept?: () => void;
  onReject?: () => void;
  acceptLabel?: string;
  rejectLabel?: string;
  /** Disables both actions, e.g. while a decision is being saved. */
  pending?: boolean;
}

/**
 * AI proposal: always the same look (dashed Forge Blue border, sparkles icon, agent author,
 * visible sources, separate Accept/Reject). The AI proposes; a person decides.
 */
export function AiProposal({
  title,
  agent,
  sources,
  children,
  onAccept,
  onReject,
  acceptLabel = "Accept",
  rejectLabel = "Reject",
  pending = false,
  className,
  ...props
}: AiProposalProps) {
  return (
    <section
      data-slot="ai-proposal"
      aria-label="AI proposal"
      className={cn(
        "flex flex-col gap-4 rounded-lg border-2 border-dashed border-primary bg-surface p-6 text-fg",
        className,
      )}
      {...props}
    >
      <header className="flex items-start gap-3">
        <Sparkles aria-hidden="true" strokeWidth={1.5} className="mt-1 size-5 shrink-0 text-link" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-label uppercase text-link">AI proposal</p>
          <h3 className="font-body text-heading-sm text-fg">{title}</h3>
          <p className="flex items-center gap-1 text-body-sm text-fg-muted">
            <Bot aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0" />
            <span>
              Proposed by <code className="font-mono text-mono-md text-fg">{agent}</code>
            </span>
          </p>
        </div>
      </header>

      {children ? <div className="text-body-md text-fg">{children}</div> : null}

      <div className="flex flex-col gap-2">
        <p className="text-label uppercase text-fg-muted">Sources</p>
        {sources.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {sources.map((s) => (
              <li
                key={`${s.label}-${s.href ?? ""}`}
                className="flex items-center gap-2 text-body-sm"
              >
                <FileText
                  aria-hidden="true"
                  strokeWidth={1.5}
                  className="size-4 shrink-0 text-fg-muted"
                />
                {s.href ? (
                  <a href={s.href} className="text-link underline underline-offset-2">
                    {s.label}
                  </a>
                ) : (
                  <span>{s.label}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-warning">No sources given: check before accepting.</p>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-subtle pt-4">
        <Button variant="primary" onClick={onAccept} disabled={pending}>
          <Check aria-hidden="true" strokeWidth={1.5} />
          {acceptLabel}
        </Button>
        <Button variant="secondary" onClick={onReject} disabled={pending}>
          <X aria-hidden="true" strokeWidth={1.5} />
          {rejectLabel}
        </Button>
      </footer>
    </section>
  );
}
