import { BlockPage } from "../../_components/block-page";
import { channelsUi, contentUi } from "../../_lib/editor-config";
import { versionParam } from "../../_lib/server";

export const metadata = { title: "Content · Brand Identity" };

export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  return (
    <BlockPage
      slug={clientSlug}
      version={versionParam(sp.version)}
      sections={[contentUi, channelsUi]}
      intro="Editorial pillars, formats with their slide sequence, and rules per channel."
    />
  );
}
