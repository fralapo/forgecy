import { getTranslations } from "next-intl/server";
import { BlockPage } from "../../_components/block-page";
import { channelsUi, contentUi } from "../../_lib/editor-config";
import { versionParam } from "../../_lib/server";

export async function generateMetadata() {
  const t = await getTranslations("brand.meta");
  return { title: t("content") };
}

export default async function ContentPage({
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
      sections={[contentUi, channelsUi]}
      intro={t("content")}
    />
  );
}
