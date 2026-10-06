"use client";

import { cn } from "@forgecy/ui";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

// Admin sections appear only for Admins; each page checks the Admin flag again on the server.
const sections = [
  { href: "/settings", label: "general", admin: false },
  { href: "/settings/ai-providers", label: "aiProviders", admin: true },
  { href: "/settings/ai-policies", label: "aiPolicies", admin: true },
  { href: "/settings/smtp", label: "smtp", admin: true },
  { href: "/settings/storage", label: "storage", admin: true },
  { href: "/settings/system-health", label: "health", admin: true },
  { href: "/settings/backup", label: "backup", admin: true },
  { href: "/settings/import-export", label: "importExport", admin: true },
] as const;

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const visible = sections.filter((s) => isAdmin || !s.admin);
  if (visible.length < 2) return null;
  return (
    <nav aria-label={t("label")} className="mb-6 border-b border-subtle">
      <ul className="flex flex-wrap gap-1">
        {visible.map((s) => {
          const current = pathname === s.href;
          return (
            <li key={s.href}>
              <Link
                href={s.href as Route}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 px-3 py-2 text-body-sm focus-visible:outline-2 focus-visible:outline-focus",
                  current
                    ? "border-primary text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {t(s.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
