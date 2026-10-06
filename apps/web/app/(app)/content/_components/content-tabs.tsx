"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Route } from "next";
import { cn } from "@forgecy/ui";

export interface ContentTab {
  href: string;
  label: string;
  count?: number;
}

/** Sub-navigation of the content module: Strategy, Plan, Carousels, Library. */
export function ContentTabs({ tabs }: { tabs: ContentTab[] }) {
  const pathname = usePathname();
  const t = useTranslations("content.client");
  return (
    <nav aria-label={t("sectionsLabel")} className="mb-6 overflow-x-auto border-b border-subtle">
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
