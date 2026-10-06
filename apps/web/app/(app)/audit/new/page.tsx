import { Card } from "@forgecy/ui";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { ProspectForm } from "../_components/prospect-form";

export const metadata = { title: "New prospect" };

export default async function NewProspectPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title="New prospect"
        description="The audit needs this data: website, sector, area and goals. Social profiles are kept as links only: Forgecy does not read them automatically."
      />
      <Card className="max-w-3xl">
        <ProspectForm mode="create" isAdmin={user.isAdmin} />
      </Card>
    </>
  );
}
