import { Card } from "@forgecy/ui";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { ProspectForm } from "../_components/prospect-form";

export const metadata = { title: "Nuovo prospect" };

export default async function NewProspectPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title="Nuovo prospect"
        description="I dati servono all'audit: sito, settore, area e obiettivi. I profili social restano solo come link: Forgecy non li legge in automatico."
      />
      <Card className="max-w-3xl">
        <ProspectForm mode="create" isAdmin={user.isAdmin} />
      </Card>
    </>
  );
}
