import { Button, Card } from "@forgecy/ui";
import { Package } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "../_components/ui";

/** UXA-P6-05: the catalog exists only for clients, not prospects. */
export function NotAClient({ name }: { name: string }) {
  const t = useTranslations("products");
  return (
    <>
      <PageHeader title={t("title")} description={name} />
      <Card className="p-0">
        <EmptyState
          icon={Package}
          actions={
            <Button asChild variant="secondary">
              <Link href="/clients">{t("notAClient.back")}</Link>
            </Button>
          }
        >
          {t("notAClient.body")}
        </EmptyState>
      </Card>
    </>
  );
}
