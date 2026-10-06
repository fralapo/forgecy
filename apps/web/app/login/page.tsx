import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { countUsers } from "@/lib/users";
import { LoginForm } from "./login-form";

export const metadata = { title: "Accedi" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if ((await countUsers()) === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const team = env.FORGECY_AUTH_MODE === "team";
  return (
    <AuthShell title="Accedi" description="Usa le credenziali che ti ha dato l'Admin di Forgecy.">
      <LoginForm
        magicLink={team && env.FORGECY_ALLOWED_EMAIL_DOMAINS.length > 0}
        google={team && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
      />
    </AuthShell>
  );
}
