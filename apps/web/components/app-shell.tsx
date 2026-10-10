import { getDb, unreadNotificationCount } from "@forgecy/db";
import {
  Bell,
  Bot,
  Building2,
  Fingerprint,
  GalleryHorizontal,
  Share2,
  ClipboardCheck,
  LayoutDashboard,
  LayoutTemplate,
  Layers,
  Palette,
  Settings,
} from "lucide-react";
import { Package } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/session";
import { SearchBox } from "./search-box";
import { ShellNav } from "./shell-nav";
import { SignOutButton } from "./sign-out-button";

// Module threads add their entries here (Audit, Brand Identity, Content, Templates...).
// Every href must have a page under app/(app) — that's the only way it renders inside this
// shell; see app-shell.test.ts.
const nav = [
  { href: "/", label: "overview", icon: LayoutDashboard },
  { href: "/clients", label: "clients", icon: Building2 },
  { href: "/audit", label: "audit", icon: ClipboardCheck },
  { href: "/products", label: "products", icon: Package },
  { href: "/templates", label: "templates", icon: LayoutTemplate },
  { href: "/brand", label: "brand", icon: Fingerprint },
  { href: "/content", label: "content", icon: GalleryHorizontal },
  { href: "/social", label: "social", icon: Share2 },
  { href: "/agents", label: "agents", icon: Bot },
  { href: "/automations", label: "automations", icon: Layers },
  { href: "/settings", label: "settings", icon: Settings },
  { href: "/design", label: "design", icon: Palette },
] as const;

export async function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const t = await getTranslations();
  const unread = await unreadNotificationCount(getDb(), user.id);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <ShellNav appName={t("common.appName")}>
        <div className="flex items-center justify-between gap-2 py-5 pr-14 pl-6 lg:pr-3">
          <span className="font-display text-heading-md text-fg">{t("common.appName")}</span>
          <Link
            href="/notifications"
            aria-label={t("notifications.bell", { count: unread })}
            className="relative rounded-md p-2 text-fg-muted hover:bg-app hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Bell aria-hidden className="size-5" />
            {unread > 0 ? (
              <span
                aria-hidden
                className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-label text-primary-foreground"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
        </div>
        <SearchBox />
        <nav aria-label={t("shell.mainNavigation")} className="flex-1 px-3">
          <ul className="space-y-1">
            {nav.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-body-sm text-fg hover:bg-app focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <Icon aria-hidden className="size-5 text-fg-muted" />
                  {t(`shell.nav.${label}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-subtle px-6 py-4">
          <p className="text-body-sm text-fg">{user.name}</p>
          <p className="text-body-sm text-fg-muted">
            {t(user.isAdmin ? "common.role.admin" : "common.role.user")}
          </p>
          <SignOutButton />
        </div>
      </ShellNav>
      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
