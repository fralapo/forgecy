import { cn } from "@forgecy/ui";
import { Check } from "lucide-react";

/** The wizard's steps with a textual state for each one (spec page 68, Accessibility). */
export function Stepper({
  label,
  steps,
  current,
  states,
}: {
  label: string;
  steps: string[];
  current: number;
  states: { done: string; current: string; todo: string };
}) {
  return (
    <ol aria-label={label} className="mb-6 flex flex-wrap gap-x-6 gap-y-2">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={s}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-2 text-body-sm"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-label",
                state === "current" && "border-primary bg-primary text-primary-foreground",
                state === "done" && "border-primary text-primary",
                state === "todo" && "border-control text-fg-muted",
              )}
            >
              {state === "done" ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={state === "todo" ? "text-fg-muted" : "text-fg"}>{s}</span>
            <span className="sr-only">({states[state]})</span>
          </li>
        );
      })}
    </ol>
  );
}
