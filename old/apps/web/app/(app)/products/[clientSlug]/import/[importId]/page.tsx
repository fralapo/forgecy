import { redirect } from "next/navigation";
import { paths } from "../../../_lib/paths";

/** An import has no page of its own: its address opens the review. */
export default async function ImportPage({
  params,
}: {
  params: Promise<{ clientSlug: string; importId: string }>;
}) {
  const { clientSlug, importId } = await params;
  redirect(paths.review(clientSlug, importId));
}
