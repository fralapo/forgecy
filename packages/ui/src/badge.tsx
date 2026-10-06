import { cva, type VariantProps } from "class-variance-authority";
import { BadgeCheck, CircleAlert, Eye, Info, Lock, Sparkles, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 py-1 text-label font-medium [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-control bg-surface text-fg",
        success: "border-success-fill bg-surface text-success",
        warning: "border-warning-fill bg-surface text-warning",
        error: "border-error-fill bg-surface text-error",
        info: "border-primary bg-surface text-link",
        highlight: "border-transparent bg-highlight text-highlight-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

type Variant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// Status is never conveyed by color alone: every variant carries an icon next to the label.
const ICONS: Record<Variant, LucideIcon> = {
  neutral: Info,
  success: BadgeCheck,
  warning: Eye,
  error: Lock,
  info: CircleAlert,
  highlight: Sparkles,
};

export interface BadgeProps
  extends Omit<ComponentProps<"span">, "children">, VariantProps<typeof badgeVariants> {
  /** Visible label (required: color is never the only signal). */
  children: ReactNode;
  /** Override the default icon for the variant. */
  icon?: LucideIcon;
}

export function Badge({ className, variant, icon, children, ...props }: BadgeProps) {
  const Icon = icon ?? ICONS[variant ?? "neutral"];
  return (
    <span
      data-slot="badge"
      data-variant={variant ?? "neutral"}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden="true" strokeWidth={1.5} />
      <span>{children}</span>
    </span>
  );
}
