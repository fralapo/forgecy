"use client";

import { Button, type ButtonProps } from "@forgecy/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

type Result =
  { ok: true; data?: unknown; message?: string } | { ok: false; error: string; code?: string };

/** A button running a bound server action; shows pending state and the error with its code. */
export function ActionButton({
  action,
  children,
  icon,
  variant = "secondary",
  size,
  confirm,
  done,
  className,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  /** An element (e.g. `<Play aria-hidden />`): server pages cannot pass components. */
  icon?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Ask before running (irreversible or costly steps). */
  confirm?: string;
  /** Message shown after success. */
  done?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; code?: string; ok?: boolean }>({});
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const res = await action();
            if (res.ok) {
              setState({ ok: true });
              router.refresh();
            } else setState({ error: res.error, ...(res.code ? { code: res.code } : {}) });
          });
        }}
      >
        {icon}
        {children}
      </Button>
      {state.error ? (
        <span role="alert" className="text-body-sm text-error">
          {state.error}
          {state.code ? <code className="ml-1 font-mono text-fg-muted">{state.code}</code> : null}
        </span>
      ) : state.ok && done ? (
        <span role="status" className="text-body-sm text-success">
          {done}
        </span>
      ) : null}
    </span>
  );
}
