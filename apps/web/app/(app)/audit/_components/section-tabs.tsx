"use client";

import { cn } from "@forgecy/ui";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const sections = [
  { path: "", label: "overview" },
  { path: "/website", label: "website" },
  { path: "/social", label: "social" },
  { path: "/competitors", label: "competitors" },
  { path: "/comparison", label: "comparison" },
  { path: "/diagnosis", label: "diagnosis" },
  { path: "/report", label: "report" },
] as const;

export function SectionTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const t = useTranslations("audit.sections");
  const base = `/audit/${slug}`;
  return (
    <nav aria-label={t("label")} className="mb-6 border-b border-subtle">
      <ul className="-mb-px flex flex-wrap gap-1">
        {sections.map((s) => {
          const href = `${base}${s.path}`;
          const active = s.path === "" ? pathname === base : pathname.startsWith(href);
          return (
            <li key={s.path}>
              <Link
                href={href as Route}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex border-b-2 px-4 py-2 text-body-sm",
                  active
                    ? "border-primary font-medium text-fg"
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
