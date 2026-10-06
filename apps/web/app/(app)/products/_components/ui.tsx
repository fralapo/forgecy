import type { ConfidenceLevel, ProductImportStatus, ProductStatus } from "@forgecy/core";
import { Badge, cn } from "@forgecy/ui";
import {
  Archive,
  BadgeCheck,
  ChevronRight,
  ImageOff,
  Pencil,
  ScanEye,
  ShieldAlert,
  Sparkles,
  User,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { confidenceText, importStatusLabels, productStatusLabels } from "../_lib/labels";

export function ProductStatusBadge({
  status,
  byAgent = false,
}: {
  status: ProductStatus;
  byAgent?: boolean;
}) {
  const map: Record<
    ProductStatus,
    { variant: "neutral" | "info" | "success" | "error"; icon: LucideIcon }
  > = {
    draft: { variant: "neutral", icon: Pencil },
    proposed: { variant: "info", icon: byAgent ? Sparkles : User },
    approved: { variant: "success", icon: BadgeCheck },
    rejected: { variant: "error", icon: XCircle },
    archived: { variant: "neutral", icon: Archive },
  };
  const { variant, icon } = map[status];
  return (
    <Badge
      variant={variant}
      icon={icon}
      className={status === "proposed" ? "border-dashed" : undefined}
    >
      {productStatusLabels[status]}
    </Badge>
  );
}

export function ImportStatusBadge({ status }: { status: ProductImportStatus }) {
  const variant =
    status === "failed"
      ? "error"
      : status === "completed"
        ? "success"
        : status === "needs_mapping" || status === "ready_for_review" || status === "partial"
          ? "warning"
          : "neutral";
  return <Badge variant={variant}>{importStatusLabels[status]}</Badge>;
}

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return (
    <Badge variant={level === "high" ? "success" : level === "medium" ? "neutral" : "warning"}>
      {confidenceText[level]} confidence
    </Badge>
  );
}

export function SensitiveBadge() {
  return (
    <Badge variant="warning" icon={ShieldAlert}>
      Sensitive
    </Badge>
  );
}

export function ObservedBadge() {
  return (
    <Badge variant="neutral" icon={ScanEye} className="border-dashed">
      Extracted, not reviewed
    </Badge>
  );
}

/** Three segments plus a text label: never color alone. */
export function CompletenessMeter({ level }: { level: "complete" | "partial" | "minimal" }) {
  const filled = level === "complete" ? 3 : level === "partial" ? 2 : 1;
  const label = level === "complete" ? "Complete" : level === "partial" ? "Partial" : "Minimal";
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-4 rounded-sm",
              i < filled ? (level === "complete" ? "bg-success-fill" : "bg-primary") : "bg-subtle",
            )}
          />
        ))}
      </span>
      <span className="text-body-sm text-fg-muted">{label}</span>
    </span>
  );
}

export function Thumb({
  url,
  alt,
  size = "md",
}: {
  url: string | null;
  alt: string;
  size?: "md" | "lg";
}) {
  const box = size === "md" ? "size-12" : "aspect-[4/5] w-full";
  if (!url)
    return (
      <span
        className={cn(
          box,
          "flex items-center justify-center rounded-md border border-subtle bg-app",
        )}
        title="No image"
      >
        <ImageOff aria-hidden className="size-5 text-fg-muted" />
        <span className="sr-only">No image</span>
      </span>
    );
  return (
    // Signed, private URLs: next/image would need a loader for every storage driver.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={cn(box, "rounded-md border border-subtle bg-app object-cover")}
    />
  );
}

export function Banner({
  tone = "neutral",
  children,
  action,
}: {
  tone?: "neutral" | "warning" | "error" | "success";
  children: ReactNode;
  action?: ReactNode;
}) {
  const border = {
    neutral: "border-subtle",
    warning: "border-warning-fill",
    error: "border-error-fill",
    success: "border-success-fill",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border bg-surface px-4 py-3 text-body-sm text-fg",
        border,
      )}
    >
      <div className="min-w-0">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  children,
  actions,
}: {
  icon: LucideIcon;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <Icon aria-hidden className="size-8 text-fg-muted" />
      <p className="max-w-lg text-body-md text-fg-muted">{children}</p>
      {actions ? <div className="flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: Route }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-body-sm text-fg-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight aria-hidden className="size-4" /> : null}
            {it.href ? (
              <Link href={it.href} className="hover:text-fg hover:underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-fg">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const selectClass =
  "h-10 rounded-md border border-control bg-surface px-3 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-focus";

export const textareaClass =
  "w-full rounded-md border border-control bg-surface px-3 py-2 text-body-md text-fg placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
