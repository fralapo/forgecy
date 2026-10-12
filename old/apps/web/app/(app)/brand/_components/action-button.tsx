"use client";

import { Button, type ButtonProps } from "@forgecy/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "../actions";

/** Runs a bound server action and shows its error next to the button. */
export function ActionButton({
  action,
  children,
  variant,
  size,
  confirm,
  redirectTo,
  disabled,
  title,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Question shown before running (destructive or hard-to-undo actions). */
  confirm?: string;
  redirectTo?: string;
  disabled?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant={variant}
        size={size}
        disabled={pending || disabled}
        title={title}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          start(async () => {
            const r = await action();
            if (!r.ok) setError(r.error);
            else if (redirectTo) router.push(redirectTo as never);
            else router.refresh();
          });
        }}
      >
        {children}
      </Button>
      {error ? (
        <span role="alert" className="max-w-xs text-body-sm text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
