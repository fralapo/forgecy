import { Card } from "@forgecy/ui";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";

const steps = [
  {
    href: "/audit",
    title: "Audit",
    text: "Analizza sito, social e competitor di un prospect e consegna il report in PDF.",
  },
  {
    href: "/templates",
    title: "Template",
    text: "Importa e pubblica i template dell'agenzia: report e caroselli usano solo quelli pubblicati.",
  },
  {
    href: "/brand",
    title: "Brand Identity",
    text: "Strategia, voce e identità visiva del cliente, approvate da una persona.",
  },
  {
    href: "/products",
    title: "Prodotti",
    text: "Il catalogo del cliente: solo i prodotti approvati entrano nei contenuti.",
  },
  {
    href: "/content",
    title: "Contenuti",
    text: "Strategia, piano, caroselli, revisione ed export in PNG, PDF e ZIP.",
  },
] as const;

export default async function HomePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title={`Ciao ${user.name.split(" ")[0]}`}
        description="Prospect, Audit, Diagnosi, Brand identity, Content strategy, Carosello, Revisione, Export."
      />
      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.href}>
            <Card className="h-full p-6">
              <h2 className="text-heading-sm text-fg">
                <Link href={s.href} className="hover:underline">
                  {i + 1}. {s.title}
                </Link>
              </h2>
              <p className="mt-2 text-body-md text-fg-muted">{s.text}</p>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
