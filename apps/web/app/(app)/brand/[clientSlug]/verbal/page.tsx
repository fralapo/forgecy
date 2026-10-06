import { BlockPage } from "../../_components/block-page";
import { verbalUi } from "../../_lib/editor-config";
import { versionParam } from "../../_lib/server";

export const metadata = { title: "Verbale · Brand Identity" };

export default async function VerbalPage({
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
      sections={[verbalUi]}
      intro="Voce costante, tono per asse con una frase giusta e una sbagliata, regole di scrittura e vocabolario."
    />
  );
}
