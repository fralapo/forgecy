import { redirect } from "next/navigation";

/** Runs are listed per agent (Runs tab); the bare address goes back to the agents list. */
export default function RunsPage() {
  redirect("/agents");
}
