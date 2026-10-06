"use client";

import { Button, Label } from "@forgecy/ui";
import { Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { askPlannerAction } from "../actions";
import { controlClass } from "./action-button";
import { FormError, useSave } from "./strategy-forms";

/** “Ask the Planner”: enqueues a strategy proposal job with an optional instruction. */
export function AskPlannerForm({
  slug,
  clientId,
  running,
  disabledReason,
}: {
  slug: string;
  clientId: string;
  running: boolean;
  disabledReason?: string | null;
}) {
  const [instruction, setInstruction] = useState("");
  const id = useId();
  const { pending, error, run } = useSave();
  const disabled = pending || running || Boolean(disabledReason);
  return (
    <form
      aria-label="Ask the Planner"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => askPlannerAction({ slug, clientId, instruction: instruction.trim() }),
          () => setInstruction(""),
        );
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={id}>Instruction for the Planner (optional)</Label>
        <textarea
          id={id}
          rows={2}
          maxLength={500}
          className={controlClass}
          placeholder="E.g. more room for education, less direct promotion"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={disabled}>
        <Sparkles aria-hidden />
        Ask the Planner
      </Button>
      {disabledReason ? <p className="text-body-sm text-fg-muted">{disabledReason}</p> : null}
      <FormError error={error} />
    </form>
  );
}
