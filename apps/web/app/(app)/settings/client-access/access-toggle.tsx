"use client";

import { useState, useTransition } from "react";
import { ActionFeedback } from "../_components/action-feedback";
import type { AdminActionResult } from "../_lib/admin-action";
import { setClientAccessAction } from "./actions";

/** One client's checkbox for the selected person: saved as soon as it changes. */
export function AccessToggle({
  userId,
  clientId,
  label,
  granted,
}: {
  userId: string;
  clientId: string;
  label: string;
  granted: boolean;
}) {
  const [checked, setChecked] = useState(granted);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex items-center gap-2 text-body-md text-fg">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setChecked(next);
            start(async () => {
              const r = await setClientAccessAction({ userId, clientId, granted: next });
              if (!r.ok) setChecked(!next);
              setResult(r.ok ? null : r);
            });
          }}
        />
        {label}
      </label>
      <ActionFeedback result={result} />
    </div>
  );
}
