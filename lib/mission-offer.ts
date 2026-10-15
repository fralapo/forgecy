export type MissionOfferReference = { id: string };

/** Resolve an explicitly selected offer even when it falls outside the bounded AI context list. */
export async function resolveMissionOffer<T extends MissionOfferReference>(
  contextOffers: T[],
  offerId: string | null,
  loadSelectedOffer: (id: string) => Promise<T | null>,
): Promise<T | null> {
  if (!offerId) return null;
  return contextOffers.find((offer) => offer.id === offerId) ?? loadSelectedOffer(offerId);
}
