import {
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  LayoutTemplate,
  Palette,
  Settings,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

// Module threads add their entries here (Audit, Brand Identity, Contenuti, Template...).
const nav = [
  { href: "/", label: "Panoramica", icon: LayoutDashboard },
  { href: "/clienti", label: "Clienti", icon: Building2 },
  { href: "/audit", label: "Audit", icon: ClipboardCheck },
  { href: "/template", label: "Template", icon: LayoutTemplate },
  { href: "/impostazioni", label: "Impostazioni", icon: Settings },
  { href: "/design", label: "Design system", icon: Palette },
] as const;

export function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-[15rem_1fr]">
      <aside className="flex flex-col border-r border-subtle bg-surface">
        <div className="px-6 py-5 font-display text-heading-md text-fg">Forgecy</div>
        <nav aria-label="Navigazione principale" className="flex-1 px-3">
          <ul className="space-y-1">
            {nav.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-body-sm text-fg hover:bg-app focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <Icon aria-hidden className="size-5 text-fg-muted" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-subtle px-6 py-4">
          <p className="text-body-sm text-fg">{user.name}</p>
          <p className="text-body-sm text-fg-muted">{user.isAdmin ? "Admin" : "Utente"}</p>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 px-8 py-8">{children}</main>
    </div>
  );
}
