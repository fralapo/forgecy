import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // During a restore everyone but its Admin is sent to /maintenance (spec page 70).
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
