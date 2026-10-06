import { Card } from "@forgecy/ui";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";

const steps = [
  {
    href: "/audit",
    title: "Audit",
    text: "Analyze a prospect's website, social profiles and competitors, and deliver the report as a PDF.",
  },
  {
    href: "/templates",
    title: "Templates",
    text: "Import and publish the agency's templates: reports and carousels use only published ones.",
  },
  {
    href: "/brand",
    title: "Brand Identity",
    text: "The client's strategy, voice and visual identity, approved by a person.",
  },
  {
    href: "/products",
    title: "Products",
    text: "The client's catalog: only approved products make it into content.",
  },
  {
    href: "/content",
    title: "Content",
    text: "Strategy, plan, carousels, review and export to PNG, PDF and ZIP.",
  },
] as const;

export default async function HomePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title={`Hi ${user.name.split(" ")[0]}`}
        description="Prospect, Audit, Diagnosis, Brand identity, Content strategy, Carousel, Review, Export."
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
