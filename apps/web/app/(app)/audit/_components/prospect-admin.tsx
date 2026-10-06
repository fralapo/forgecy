"use client";

import type { AiPolicy } from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProspectAction, setPolicyAction } from "../actions";
import { selectClass } from "../_lib/styles";

const policyLabel: Record<AiPolicy, string> = {
  external_allowed: "AI esterna ammessa",
  external_restricted: "AI esterna limitata",
  local_only: "Solo AI locale",
  no_ai: "Nessuna AI",
};

/** Admin only (checked again on the server): changing it stops waiting AI jobs. */
export function PolicySelect({ clientId, policy }: { clientId: string; policy: AiPolicy }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="policy">Policy AI</Label>
      <select
        id="policy"
        className={selectClass}
        defaultValue={policy}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as AiPolicy;
          start(async () => {
            const res = await setPolicyAction(clientId, next);
            if (!res.ok) return setMessage({ error: res.error });
            const n = res.data?.cancelledJobs ?? 0;
            setMessage({
              ok: n ? `Policy cambiata: ${n} passi AI in attesa annullati.` : "Policy cambiata.",
            });
            router.refresh();
          });
        }}
      >
        {(Object.keys(policyLabel) as AiPolicy[]).map((p) => (
          <option key={p} value={p}>
            {policyLabel[p]}
          </option>
        ))}
      </select>
      {message.error ? (
        <p role="alert" className="text-body-sm text-error">
          {message.error}
        </p>
      ) : message.ok ? (
        <p role="status" className="text-body-sm text-success">
          {message.ok}
        </p>
      ) : null}
    </div>
  );
}

export function DeleteProspect({ clientId, name }: { clientId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const typed = String(new FormData(e.currentTarget).get("confirm") ?? "");
        start(async () => {
          const res = await deleteProspectAction(clientId, typed);
          if (!res.ok) return setError(res.error);
          router.push("/audit");
        });
      }}
    >
      <Label htmlFor="confirm">
        Elimina il prospect e tutti i dati raccolti (screenshot e file compresi). Scrivi{" "}
        <strong>{name}</strong> per confermare.
      </Label>
      <Input id="confirm" name="confirm" autoComplete="off" />
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          <Trash2 aria-hidden />
          Elimina definitivamente
        </Button>
      </div>
    </form>
  );
}
