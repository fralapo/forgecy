import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { countUsers } from "@/lib/users";
import { SetupForm } from "./setup-form";

export async function generateMetadata() {
  const t = await getTranslations("auth.setup");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

/** First run: creates the first Admin. Unreachable once any user exists. */
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/login");
  const t = await getTranslations("auth.setup");
  return (
    <AuthShell title={t("title")} description={t("description")}>
      <SetupForm />
    </AuthShell>
  );
}
