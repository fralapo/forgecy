import { channelLabels, getNewCarouselOptions, getPlanItem } from "@forgecy/content";
import { Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { CarouselNewForm, type PlanSeed } from "../../../_components/carousel-new-form";
import { carouselPath, carouselsPath } from "../../../_lib/paths";
import { loadClient } from "../../../_lib/server";

export const metadata = { title: "Nuovo carosello · Contenuti" };

export default async function NewCarouselPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const { db, user, client } = await loadClient(clientSlug);
  const planId = typeof sp.piano === "string" ? sp.piano : null;
  const [options, item] = await Promise.all([
    getNewCarouselOptions(db, user.actor, client.id),
    planId ? getPlanItem(db, user.actor, client.id, planId) : null,
  ]);
  const plan: PlanSeed | null =
    item && item.status === "accepted" && !item.contentId
      ? {
          id: item.id,
          title: item.theme,
          channel: item.channel as PlanSeed["channel"],
          format: item.format,
          pillarId: item.pillarId,
          rubricId: item.rubricId,
          productId: item.productIds[0] ?? null,
          briefText: [item.theme, item.hook, item.notes].filter(Boolean).join("\n"),
        }
      : null;

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-heading-md text-fg">Nuovo carosello</h2>
      <p className="mb-6 text-body-sm text-fg-muted">
        <Link href={carouselsPath(client.slug) as Route}>Torna ai caroselli</Link>
      </p>
      {item && item.contentId ? (
        <p role="status" className="mb-4 text-body-sm text-fg">
          Per questo elemento del piano esiste già un carosello.{" "}
          <Link href={carouselPath(client.slug, item.contentId) as Route}>Aprilo</Link>
        </p>
      ) : null}
      {plan ? (
        <p role="status" className="mb-4 text-body-sm text-fg">
          Dal piano: giorno {item?.day}, {channelLabels[plan.channel] ?? plan.channel}. I campi sono
          precompilati e si possono cambiare.
        </p>
      ) : null}
      {!options.brandPublished ? (
        <p role="alert" className="mb-4 text-body-sm text-fg">
          Serve una Brand Identity pubblicata per creare un carosello.{" "}
          <Link href={`/brand/${client.slug}` as Route}>Apri la Brand Identity</Link>
        </p>
      ) : options.templates.length === 0 ? (
        <p role="alert" className="mb-4 text-body-sm text-fg">
          Nessun template utilizzabile: pubblicane uno nel catalogo dei template.
        </p>
      ) : null}
      <CarouselNewForm slug={client.slug} clientId={client.id} options={options} plan={plan} />
    </Card>
  );
}
