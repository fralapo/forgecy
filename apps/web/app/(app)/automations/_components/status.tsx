import type { AutomationStatus } from "@forgecy/core";
import { Badge } from "@forgecy/ui";
import { Pause, Pencil, Play, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

const look = {
  draft: { variant: "neutral", Icon: Pencil },
  active: { variant: "info", Icon: Play },
  paused: { variant: "warning", Icon: Pause },
  failed: { variant: "error", Icon: XCircle },
} as const;

/** State of an automation (page 58): icon and label, never color alone. */
export async function AutomationStatusBadge({ status }: { status: AutomationStatus }) {
  const t = await getTranslations("automations.statusLabel");
  const { variant, Icon } = look[status];
  return (
    <Badge variant={variant} icon={Icon}>
      {t(status)}
    </Badge>
  );
}

/** Micro-dollars as US dollars. */
export const usd = (microUsd: number) => microUsd / 1_000_000;
