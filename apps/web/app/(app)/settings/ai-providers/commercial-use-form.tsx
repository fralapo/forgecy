"use client";

import type { CommercialUse, ImageProvider } from "@forgecy/content";
import { Button, Input, Label } from "@forgecy/ui";
import { Save } from "lucide-react";
import { useActionState, useState } from "react";
import { setCommercialUseAction, type CommercialUseState } from "../actions";
import { controlClass } from "../../content/_components/action-button";

const statusOptions: { value: CommercialUse; label: string }[] = [
  { value: "pending_verification", label: "Pending verification" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Not allowed" },
];

/** “Update commercial use status”: status, terms consulted, date and note. */
export function CommercialUseForm({
  provider,
  initial,
}: {
  provider: ImageProvider;
  initial: { status: CommercialUse; termsUrl: string; consultedOn: string; note: string };
}) {
  const [state, action, pending] = useActionState<CommercialUseState, FormData>(
    setCommercialUseAction,
    {},
  );
  // Controlled fields: React resets a form after its action runs, which would wipe the
  // values when the server rejects them.
  const [values, setValues] = useState(initial);
  const bind = (field: keyof typeof initial) => ({
    name: field,
    value: values[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value })),
  });
  const id = (field: string) => `cu-${provider}-${field}`;
  return (
    <details className="rounded-md border border-subtle p-4">
      <summary className="cursor-pointer text-label text-fg">Update commercial use status</summary>
      <form action={action} className="mt-4 grid gap-4">
        <input type="hidden" name="provider" value={provider} />
        <div className="grid gap-2">
          <Label htmlFor={id("status")}>Status</Label>
          <select id={id("status")} {...bind("status")} className={controlClass}>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id("terms")}>URL of the terms consulted</Label>
          <Input id={id("terms")} type="url" {...bind("termsUrl")} placeholder="https://" />
          <p className="text-body-sm text-fg-muted">Required for “Verified”.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id("date")}>Date consulted</Label>
          <Input id={id("date")} type="date" {...bind("consultedOn")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id("note")}>Note</Label>
          <textarea
            id={id("note")}
            rows={3}
            maxLength={500}
            {...bind("note")}
            className={controlClass}
          />
        </div>
        {state.error ? (
          <p role="alert" className="text-body-sm text-error">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p role="status" className="text-body-sm text-success">
            Status updated.
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-fit">
          <Save aria-hidden />
          Save
        </Button>
      </form>
    </details>
  );
}
