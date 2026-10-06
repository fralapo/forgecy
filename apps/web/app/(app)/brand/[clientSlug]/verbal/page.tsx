import { getTranslations } from "next-intl/server";
import { BlockPage } from "../../_components/block-page";
import { verbalUi } from "../../_lib/editor-config";
import { versionParam } from "../../_lib/server";

export async function generateMetadata() {
  const t = await getTranslations("brand.meta");
  return { title: t("verbal") };
}

export default async function VerbalPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const t = await getTranslations("brand.block.intro");
  return (
    <BlockPage
      slug={clientSlug}
      version={versionParam(sp.version)}
      sections={[verbalUi]}
      intro={t("verbal")}
    />
  );
}
