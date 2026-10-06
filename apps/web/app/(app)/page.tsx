import { Card } from "@forgecy/ui";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title={`Ciao ${user.name.split(" ")[0]}`}
        description="Prospect, Audit, Diagnosi, Brand identity, Content strategy, Carosello, Revisione, Export."
      />
      <Card className="p-6">
        <h2 className="text-heading-sm text-fg">Fondamenta pronte</h2>
        <p className="mt-2 text-body-md text-fg-muted">
          Clienti e impostazioni sono attivi. Audit, Brand Identity, template e caroselli arrivano
          con le prossime milestone.
        </p>
      </Card>
    </>
  );
}
