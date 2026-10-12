"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

/**
 * Sidebar that stays in the grid from `lg` up and becomes an off-canvas drawer below it,
 * opened from a top bar. Closes on navigation and on Escape.
 */
export function ShellNav({ appName, children }: { appName: string; children: ReactNode }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  // Remembers the page the drawer was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (on: boolean) => setOpenOn(on ? pathname : null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-subtle bg-surface px-2 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="app-sidebar"
          aria-label={t("openMenu")}
          className="rounded-md p-2 text-fg-muted hover:bg-app hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Menu aria-hidden className="size-5" />
        </button>
        <span className="font-display text-heading-sm text-fg">{appName}</span>
      </div>
      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-fg/40 lg:hidden"
        />
      ) : null}
      <aside
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-y-auto border-r border-subtle bg-surface transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-auto lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("closeMenu")}
          className="absolute top-4 right-2 rounded-md p-2 text-fg-muted hover:bg-app hover:text-fg focus-visible:outline-2 focus-visible:outline-focus lg:hidden"
        >
          <X aria-hidden className="size-5" />
        </button>
        {children}
      </aside>
    </>
  );
}
