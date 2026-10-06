"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { Plus } from "lucide-react";
import { useActionState } from "react";
import { createClientAction, type ClientFormState } from "./actions";

const selectClass =
  "h-10 w-full rounded-md border border-control bg-surface px-3 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-focus";

export function NewClientForm() {
  const [state, action, pending] = useActionState<ClientFormState, FormData>(
    createClientAction,
    {},
  );
  return (
    <form action={action} className="mt-4 space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="websiteUrl">Sito</Label>
        <Input id="websiteUrl" name="websiteUrl" type="url" placeholder="https://" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sector">Settore</Label>
        <Input id="sector" name="sector" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="status">Stato</Label>
        <select id="status" name="status" className={selectClass} defaultValue="prospect">
          <option value="prospect">Prospect</option>
          <option value="active">Attivo</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="aiPolicy">Policy AI</Label>
        <select
          id="aiPolicy"
          name="aiPolicy"
          className={selectClass}
          defaultValue="external_allowed"
        >
          <option value="external_allowed">AI esterna ammessa</option>
          <option value="external_restricted">AI esterna limitata</option>
          <option value="local_only">Solo AI locale</option>
          <option value="no_ai">Nessuna AI</option>
        </select>
      </div>
      {state.error ? (
        <p role="alert" className="text-body-sm text-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-body-sm text-success">
          Cliente creato.
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        <Plus aria-hidden />
        Aggiungi
      </Button>
    </form>
  );
}
