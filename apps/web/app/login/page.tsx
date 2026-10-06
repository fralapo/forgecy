import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { countUsers } from "@/lib/users";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if ((await countUsers()) === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const team = env.FORGECY_AUTH_MODE === "team";
  return (
    <AuthShell title="Sign in" description="Use the credentials your Forgecy Admin gave you.">
      <LoginForm
        magicLink={team && env.FORGECY_ALLOWED_EMAIL_DOMAINS.length > 0}
        google={team && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
      />
    </AuthShell>
  );
}
