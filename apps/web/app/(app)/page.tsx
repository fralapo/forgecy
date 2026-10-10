import { can } from "@forgecy/core";
import { Card } from "@forgecy/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { AddBrand } from "./brand/_components/add-brand";

const steps = [
  { href: "/audit", key: "audit" },
  { href: "/templates", key: "templates" },
  { href: "/brand", key: "brand" },
  { href: "/products", key: "products" },
  { href: "/content", key: "content" },
] as const;

export default async function HomePage() {
  const user = await requireUser();
  const t = await getTranslations("home");
  return (
    <>
      <PageHeader
        title={t("greeting", { name: user.name.split(" ")[0] ?? user.name })}
        description={t("flow")}
      />
      {can(user.actor, "project.edit") ? <AddBrand /> : null}
      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.href}>
            <Card className="h-full p-6">
              <h2 className="text-heading-sm text-fg">
                <Link href={s.href} className="hover:underline">
                  {t("step", { number: i + 1, title: t(`steps.${s.key}.title`) })}
                </Link>
              </h2>
              <p className="mt-2 text-body-md text-fg-muted">{t(`steps.${s.key}.text`)}</p>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
