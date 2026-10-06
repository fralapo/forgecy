"use client";

import { Button } from "@forgecy/ui";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "../_lib/types";

/** Runs a server action, refreshes the page and keeps the last message for `aria-live`. */
export function useCatalogAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  function run(fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) {
    start(async () => {
      try {
        const r = await fn();
        setResult(r);
        if (r.ok) router.refresh();
        after?.(r);
      } catch {
        setResult({ error: "Decisione non salvata. Riprova." });
      }
    });
  }
  return { pending, result, run, clear: () => setResult(null) };
}

export function ActionMessage({ result }: { result: ActionResult | null }) {
  return (
    <p aria-live="polite" className="min-h-5 text-body-sm">
      {result?.error ? <span className="text-error">{result.error}</span> : null}
      {result?.ok && result.message ? <span className="text-success">{result.message}</span> : null}
    </p>
  );
}

/**
 * Native <dialog> for confirmations (focus trap and Esc come from the browser).
 * `trigger` opens it; `onConfirm` runs the action and closes it.
 */
export function ConfirmDialog({
  trigger,
  title,
  children,
  confirmLabel,
  danger = false,
  disabled = false,
  onConfirm,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: (form: FormData) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (isOpen && !d.open) d.showModal();
    if (!isOpen && d.open) d.close();
  }, [isOpen]);
  return (
    <>
      {trigger(() => setOpen(true))}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-label={title}
        className="m-auto w-full max-w-md rounded-lg border border-subtle bg-surface p-6 text-fg backdrop:bg-fg/40"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(new FormData(e.currentTarget));
            setOpen(false);
          }}
          className="space-y-4"
        >
          <h2 className="text-heading-sm">{title}</h2>
          {children ? <div className="space-y-3 text-body-md text-fg-muted">{children}</div> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" variant={danger ? "danger" : "primary"} disabled={disabled}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Refreshes the server-rendered page while a job runs (import analysis). */
export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
