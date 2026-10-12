import { mediaKinds } from "../types";
import type { MediaKind, PostSnapshot } from "../types";
import { interactionsOf, mean } from "./engagement";
import type { ContentMix, KindMix } from "./types";

export function contentMix(posts: PostSnapshot[]): ContentMix {
  const total = posts.length;
  const share = (n: number) => (total === 0 ? 0 : n / total);

  const byKind = {} as Record<MediaKind, KindMix>;
  for (const kind of mediaKinds) {
    const ofKind = posts.filter((p) => p.kind === kind);
    const interactions = ofKind.map(interactionsOf).filter((v): v is number => v !== null);
    byKind[kind] = {
      count: ofKind.length,
      share: share(ofKind.length),
      avgInteractions: mean(interactions),
    };
  }

  const slides = posts
    .filter((p) => p.kind === "carousel" && p.carouselCount !== null)
    .map((p) => p.carouselCount!);

  return {
    total,
    byKind,
    sponsoredShare: share(posts.filter((p) => p.isSponsored).length),
    collabShare: share(posts.filter((p) => p.collaborators.length > 0).length),
    avgCarouselSlides: mean(slides),
  };
}
