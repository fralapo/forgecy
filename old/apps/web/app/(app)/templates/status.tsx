import type { StoredValidation, TemplateStatus } from "@forgecy/carousel/catalog";
import { Badge } from "@forgecy/ui";
import { getTranslations } from "next-intl/server";

const STATUS_VARIANT = {
  draft: "neutral",
  in_review: "info",
  published: "success",
  archived: "neutral",
} as const satisfies Record<TemplateStatus, string>;

export async function StatusBadge({ status }: { status: string }) {
  const t = await getTranslations("templates");
  const s = status as TemplateStatus;
  return (
    <Badge variant={STATUS_VARIANT[s] ?? "neutral"}>
      {s in STATUS_VARIANT ? t(`status.${s}`) : status}
    </Badge>
  );
}

export async function ValidationBadge({ validation }: { validation: StoredValidation }) {
  const t = await getTranslations("templates.badge");
  if (!validation.ok)
    return (
      <Badge variant="error">{t("validationErrors", { count: validation.issues.length })}</Badge>
    );
  if (!validation.rendered) return <Badge variant="warning">{t("renderPending")}</Badge>;
  return <Badge variant="success">{t("validationPassed")}</Badge>;
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
