import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { countUsers } from "@/lib/users";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Primo avvio" };
export const dynamic = "force-dynamic";

/** First run: creates the first Admin. Unreachable once any user exists. */
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/login");
  return (
    <AuthShell
      title="Primo avvio"
      description="Crea l'account Admin. Potrai aggiungere le altre persone dell'agenzia dalle impostazioni."
    >
      <SetupForm />
    </AuthShell>
  );
}
