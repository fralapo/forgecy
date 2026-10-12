"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

const isTyping = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement ||
  (el instanceof HTMLElement && el.isContentEditable);

/** Sidebar search field: Enter opens /search; Ctrl/⌘+K or `/` (outside text fields) focuses it. */
export function SearchBox() {
  const t = useTranslations("search");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !isTyping(document.activeElement);
      if (!combo && !slash) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form role="search" action="/search" method="get" className="px-3 pb-4">
      <label htmlFor="global-search" className="sr-only">
        {t("fieldLabel")}
      </label>
      <div className="flex h-10 items-center gap-2 rounded-md border border-control bg-surface px-3 focus-within:outline-2 focus-within:outline-focus">
        <Search aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <input
          ref={ref}
          id="global-search"
          name="q"
          type="search"
          autoComplete="off"
          placeholder={t("fieldLabel")}
          aria-keyshortcuts="Control+K Meta+K /"
          className="min-w-0 flex-1 bg-transparent text-body-sm text-fg outline-none"
        />
        <kbd className="hidden font-mono text-label text-fg-muted lg:inline">{t("shortcut")}</kbd>
      </div>
    </form>
  );
}
