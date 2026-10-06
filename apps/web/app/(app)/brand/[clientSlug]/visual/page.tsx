import { BlockPage } from "../../_components/block-page";
import { TokensEditor } from "../../_components/tokens-editor";
import { visualUi } from "../../_lib/editor-config";
import { versionParam } from "../../_lib/server";

export const metadata = { title: "Visual · Brand Identity" };

export default async function VisualPage({
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
      sections={[visualUi]}
      intro="Logo, palette con i ruoli semantici, contrasti, tipografia, fotografia e impaginazione."
      before={({ client, shown }) => (
        <TokensEditor
          key={shown.version?.id ?? "none"}
          initial={shown.tokens}
          editable={shown.editable}
          slug={client.slug}
          clientId={client.id}
          versionId={shown.editable ? shown.version!.id : null}
          rev={shown.version?.rev ?? 0}
        />
      )}
    />
  );
}
