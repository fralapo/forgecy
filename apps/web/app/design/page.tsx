import { DesignPage } from "@forgecy/ui";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Design system" };

/** Internal Brand Guard page: palette, contrasts, type scale and components. */
export default async function DesignRoute() {
  await requireUser();
  return <DesignPage />;
}
