"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@forgecy/ui";
import { useTranslations } from "next-intl";

export interface BrandTab {
  href: string;
  label: string;
  count?: number;
}

/** Sub-navigation shared by the Brand Identity pages (UX spec page 18). */
export function BrandTabs({ tabs }: { tabs: BrandTab[] }) {
  const pathname = usePathname();
  const t = useTranslations("brand.tabs");
  return (
    <nav aria-label={t("label")} className="mb-4 overflow-x-auto border-b border-subtle">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t, i) => {
          const current = i === 0 ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href as Route}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-body-sm",
                  current
                    ? "border-primary text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {t.label}
                {t.count ? (
                  <span className="rounded-sm border border-control px-1 text-label text-fg">
                    {t.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
