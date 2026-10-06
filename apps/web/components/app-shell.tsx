import {
  Building2,
  Fingerprint,
  GalleryHorizontal,
  ClipboardCheck,
  LayoutDashboard,
  LayoutTemplate,
  Palette,
  Settings,
} from "lucide-react";
import { Package } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/session";
import { SearchBox } from "./search-box";
import { SignOutButton } from "./sign-out-button";

// Module threads add their entries here (Audit, Brand Identity, Content, Templates...).
const nav = [
  { href: "/", label: "overview", icon: LayoutDashboard },
  { href: "/clients", label: "clients", icon: Building2 },
  { href: "/audit", label: "audit", icon: ClipboardCheck },
  { href: "/products", label: "products", icon: Package },
  { href: "/templates", label: "templates", icon: LayoutTemplate },
  { href: "/brand", label: "brand", icon: Fingerprint },
  { href: "/content", label: "content", icon: GalleryHorizontal },
  { href: "/settings", label: "settings", icon: Settings },
  { href: "/design", label: "design", icon: Palette },
] as const;

export async function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="grid min-h-dvh grid-cols-[15rem_1fr]">
      <aside className="flex flex-col border-r border-subtle bg-surface">
        <div className="px-6 py-5 font-display text-heading-md text-fg">{t("common.appName")}</div>
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
      </aside>
      <main className="min-w-0 px-8 py-8">{children}</main>
    </div>
  );
}
