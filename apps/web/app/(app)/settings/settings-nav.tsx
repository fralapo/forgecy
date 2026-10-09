"use client";

import { cn } from "@forgecy/ui";
import type { Route } from "next";
import {
  Activity,
  ArrowLeftRight,
  Bot,
  DatabaseBackup,
  HardDrive,
  KeyRound,
  Mail,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

type Group = "workspace" | "ai" | "system";
type NavLabel =
  | "general"
  | "clientAccess"
  | "aiProviders"
  | "aiPolicies"
  | "smtp"
  | "storage"
  | "health"
  | "backup"
  | "importExport";

interface Section {
  href: Route;
  label: NavLabel;
  icon: LucideIcon;
  admin: boolean;
  group: Group;
}

// Admin sections appear only for Admins; each page checks the Admin flag again on the server.
const sections: readonly Section[] = [
  { href: "/settings", label: "general", icon: Settings2, admin: false, group: "workspace" },
  {
    href: "/settings/client-access",
    label: "clientAccess",
    icon: KeyRound,
    admin: true,
    group: "workspace",
  },
  { href: "/settings/ai-providers", label: "aiProviders", icon: Bot, admin: true, group: "ai" },
  {
    href: "/settings/ai-policies",
    label: "aiPolicies",
    icon: ShieldCheck,
    admin: true,
    group: "ai",
  },
  { href: "/settings/smtp", label: "smtp", icon: Mail, admin: true, group: "system" },
  { href: "/settings/storage", label: "storage", icon: HardDrive, admin: true, group: "system" },
  {
    href: "/settings/system-health",
    label: "health",
    icon: Activity,
    admin: true,
    group: "system",
  },
  {
    href: "/settings/backup",
    label: "backup",
    icon: DatabaseBackup,
    admin: true,
    group: "system",
  },
  {
    href: "/settings/import-export",
    label: "importExport",
    icon: ArrowLeftRight,
    admin: true,
    group: "system",
  },
] as const;

const groupOrder: readonly Group[] = ["workspace", "ai", "system"];
const groupLabelKey = {
  workspace: "group.workspace",
  ai: "group.ai",
  system: "group.system",
} as const;

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const visible = sections.filter((s) => isAdmin || !s.admin);
  if (visible.length < 2) return null;
  const groups = groupOrder
    .map((group) => ({ group, items: visible.filter((s) => s.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <nav aria-label={t("label")} className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max min-w-full items-stretch gap-4 border-b border-subtle sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
        {groups.map((g, gi) => (
          <li
            key={g.group}
            className={cn(
              "flex items-end gap-1 pb-2",
              gi > 0 && "border-l border-subtle pl-4 sm:pl-6",
            )}
          >
            <span className="sr-only">{t(groupLabelKey[g.group])}</span>
            <ul className="flex items-center gap-1">
              {g.items.map((s) => {
                const current = pathname === s.href;
                const Icon = s.icon;
                return (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-sm px-3 py-2 text-body-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-focus",
                        current
                          ? "bg-primary text-primary-foreground"
                          : "text-fg-muted hover:bg-app hover:text-fg",
                      )}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
                      {t(s.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
