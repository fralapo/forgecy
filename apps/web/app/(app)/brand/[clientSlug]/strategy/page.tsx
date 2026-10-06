import { BlockPage } from "../../_components/block-page";
import { competitorsUi, strategyUi } from "../../_lib/editor-config";
import { versionParam } from "../../_lib/server";

export const metadata = { title: "Strategy · Brand Identity" };

export default async function StrategyPage({
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
      sections={[strategyUi, competitorsUi]}
      intro="Identity, positioning, audience and messages. Sensitive fields are accepted one by one when they come from a proposal."
    />
  );
}
