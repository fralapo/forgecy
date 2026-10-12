import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";

const DENIED_CODE = "PERM-DENIED";

/** Shown instead of an Admin settings page to people without the Admin flag (PERM-DENIED). */
export async function AdminOnly({ title }: { title: string }) {
  const t = await getTranslations("admin");
  return (
    <>
      <PageHeader title={title} />
      <p role="alert" className="text-body text-fg">
        {t("adminOnly")} <span className="font-mono text-fg-muted">{DENIED_CODE}</span>
      </p>
    </>
  );
}
