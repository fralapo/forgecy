import type { StoredValidation, TemplateStatus } from "@forgecy/carousel/catalog";
import { templateStatusLabels } from "@forgecy/carousel/catalog";
import { Badge } from "@forgecy/ui";

const STATUS_VARIANT = {
  draft: "neutral",
  in_review: "info",
  published: "success",
  archived: "neutral",
} as const satisfies Record<TemplateStatus, string>;

export function StatusBadge({ status }: { status: string }) {
  const s = status as TemplateStatus;
  return (
    <Badge variant={STATUS_VARIANT[s] ?? "neutral"}>{templateStatusLabels[s] ?? status}</Badge>
  );
}

export function ValidationBadge({ validation }: { validation: StoredValidation }) {
  if (!validation.ok) {
    const n = validation.issues.length;
    return <Badge variant="error">{n === 1 ? "1 errore" : `${n} errori`} di validazione</Badge>;
  }
  if (!validation.rendered) return <Badge variant="warning">Render di prova in corso</Badge>;
  return <Badge variant="success">Validazione superata</Badge>;
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mb-6 rounded-md border border-error-fill bg-surface p-4 text-body-sm text-error"
    >
      {message}
    </p>
  );
}
