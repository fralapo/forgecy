"use client";

import { Button } from "@forgecy/ui";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const t = useTranslations("shell");
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-3 -ml-3"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut aria-hidden />
      {t("signOut")}
    </Button>
  );
}
