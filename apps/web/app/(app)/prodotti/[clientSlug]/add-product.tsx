"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { Plus } from "lucide-react";
import { useActionState, useId, useRef } from "react";
import type { ActionResult } from "../_lib/types";
import { createProductAction } from "./actions";

/** «Aggiungi prodotto»: Nome (obbligatorio), SKU, Categoria → «Crea bozza». */
export function AddProductButton({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The button can appear twice on a page (header and empty state): ids must stay unique.
  const id = useId();
  const [state, action, pending] = useActionState<ActionResult, FormData>(createProductAction, {});
  return (
    <>
      <Button variant="secondary" onClick={() => ref.current?.showModal()}>
        <Plus aria-hidden />
        Aggiungi prodotto
      </Button>
      <dialog
        ref={ref}
        aria-label="Aggiungi prodotto"
        className="m-auto w-full max-w-md rounded-lg border border-subtle bg-surface p-6 text-fg backdrop:bg-fg/40"
      >
        <form action={action} className="space-y-4">
          <h2 className="text-heading-sm">Aggiungi prodotto</h2>
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="clientSlug" value={clientSlug} />
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Nome</Label>
            <Input id={`${id}-name`} name="name" required maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-sku`}>SKU</Label>
            <Input id={`${id}-sku`} name="sku" maxLength={80} className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-category`}>Categoria</Label>
            <Input id={`${id}-category`} name="category" maxLength={120} />
          </div>
          {state.error ? (
            <p role="alert" className="text-body-sm text-error">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => ref.current?.close()}>
              Annulla
            </Button>
            <Button type="submit" disabled={pending}>
              Crea bozza
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
