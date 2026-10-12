import type { ReactNode } from "react";
import { requireUser } from "@/lib/session";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <SettingsNav isAdmin={user.isAdmin} />
      {children}
    </>
  );
}
