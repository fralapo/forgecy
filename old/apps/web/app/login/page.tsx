import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { countUsers } from "@/lib/users";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("auth.login");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if ((await countUsers()) === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const team = env.FORGECY_AUTH_MODE === "team";
  const t = await getTranslations("auth.login");
  return (
    <AuthShell title={t("title")} description={t("description")}>
      <LoginForm
        magicLink={team && env.FORGECY_ALLOWED_EMAIL_DOMAINS.length > 0}
        google={team && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
      />
    </AuthShell>
  );
}
