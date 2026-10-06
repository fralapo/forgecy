import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { countUsers } from "@/lib/users";
import { SetupForm } from "./setup-form";

export const metadata = { title: "First run" };
export const dynamic = "force-dynamic";

/** First run: creates the first Admin. Unreachable once any user exists. */
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/login");
  return (
    <AuthShell
      title="First run"
      description="Create the Admin account. You can add the rest of the agency's people from settings."
    >
      <SetupForm />
    </AuthShell>
  );
}
