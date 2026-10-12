import type { ComponentProps } from "react";
import { cn } from "./cn";

export type InputProps = ComponentProps<"input">;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-control bg-surface px-3 text-body-md text-fg",
        "placeholder:text-fg-muted transition-colors duration-(--fc-motion-fast)",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-error-fill aria-invalid:border-2",
        "file:border-0 file:bg-transparent file:text-body-sm file:font-medium file:text-fg",
        className,
      )}
      {...props}
    />
  );
}
