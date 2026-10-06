import { getDefaultAiPolicy } from "@forgecy/ai";
import { getDb } from "@forgecy/db";
import { Card } from "@forgecy/ui";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { ProspectForm } from "../_components/prospect-form";

export async function generateMetadata() {
  const t = await getTranslations("audit.new");
  return { title: t("title") };
}

export default async function NewProspectPage() {
  const user = await requireUser();
  const t = await getTranslations("audit.new");
  const { policy } = await getDefaultAiPolicy(getDb());
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <Card className="max-w-3xl">
        <ProspectForm mode="create" isAdmin={user.isAdmin} defaultPolicy={policy} />
      </Card>
    </>
  );
}
