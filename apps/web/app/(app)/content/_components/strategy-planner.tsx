"use client";

import { Button, Label } from "@forgecy/ui";
import { Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { askPlannerAction } from "../actions";
import { controlClass } from "./action-button";
import { FormError, useSave } from "./strategy-forms";

/** «Chiedi al Planner»: enqueues a strategy proposal job with an optional instruction. */
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
      aria-label="Chiedi al Planner"
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
        <Label htmlFor={id}>Istruzione per il Planner (facoltativa)</Label>
        <textarea
          id={id}
          rows={2}
          maxLength={500}
          className={controlClass}
          placeholder="Es. più spazio alla formazione, meno promozione diretta"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={disabled}>
        <Sparkles aria-hidden />
        Chiedi al Planner
      </Button>
      {disabledReason ? <p className="text-body-sm text-fg-muted">{disabledReason}</p> : null}
      <FormError error={error} />
    </form>
  );
}
