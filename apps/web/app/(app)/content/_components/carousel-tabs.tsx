"use client";

import { cn } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

/** Steps of a carousel: Brief, Outline, Editor, Review, Export, Versions. */
export function CarouselTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const t = useTranslations("content.carousel");
  return (
    <nav aria-label={t("stepsLabel")} className="mb-6 overflow-x-auto border-b border-subtle">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t, i) => {
          const current = i === 0 ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href as Route}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-10 items-center border-b-2 px-3 text-body-sm",
                  current
                    ? "border-primary text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
