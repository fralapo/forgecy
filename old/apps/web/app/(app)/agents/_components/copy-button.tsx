"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Copies `value` to the clipboard; the label says what is copied. */
export function CopyButton({
  value,
  label,
  copied,
}: {
  value: string;
  label: string;
  copied: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-body-sm text-link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{done ? copied : label}</span>
    </button>
  );
}
