import { toneAxes } from "@forgecy/brand";
import { briefSchema, getNewCarouselOptions, type CarouselParamsInput } from "@forgecy/content";
import { CarouselBriefForms } from "../../../_components/carousel-brief-forms";
import { loadCarousel } from "../_lib/workspace";

export const metadata = { title: "Brief · Carousel" };

const EDITABLE = ["draft", "changes_requested", "approved", "exported"];

export default async function CarouselBriefPage({
  params,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { db, user, client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
  const options = await getNewCarouselOptions(db, user.actor, client.id);
  const editable = EDITABLE.includes(c.status) && !ws.locked;
  const parsed = briefSchema.safeParse(c.brief ?? {});
  const brief = parsed.success ? parsed.data : briefSchema.parse({});

  return (
    <>
      {!editable ? (
        <p role="status" className="mb-4 text-body-sm text-fg-muted">
          {ws.locked
            ? "The AI is working on this carousel: the fields become editable again when it finishes."
            : "The brief can’t be edited in this status."}
        </p>
      ) : null}
      <CarouselBriefForms
        slug={client.slug}
        clientId={client.id}
        contentId={c.id}
        briefRev={c.briefRev}
        editable={editable}
        hasSlides={ws.document.slides.length > 0}
        params={{
          title: c.title,
          objective: c.objective,
          audienceIds: c.audienceIds,
          pillarId: c.pillarId,
          rubricId: c.rubricId,
          productId: c.productId,
          channel: c.channel as CarouselParamsInput["channel"],
          format: c.format as CarouselParamsInput["format"],
          templateKey: c.templateKey,
          slideCount: c.slideCount,
          language: c.language as CarouselParamsInput["language"],
          planItemId: c.planItemId,
        }}
        brief={brief}
        options={options}
        toneAxes={toneAxes.map((a) => ({ key: a.key, left: a.left, right: a.right }))}
        productPrice={ws.product?.price ?? null}
      />
    </>
  );
}
