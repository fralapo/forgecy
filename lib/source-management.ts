export type LinkedOffer = { id: string; status: string };

/** Draft offers used only by the removed source can be removed with it.
 * Verified or already referenced offers are kept and detached from the source.
 */
export function planLinkedOfferCleanup(offers: LinkedOffer[], referencedOfferIds: Set<string>) {
  const deleteIds: string[] = [];
  const detachIds: string[] = [];
  for (const offer of offers) {
    if (offer.status === "draft" && !referencedOfferIds.has(offer.id)) deleteIds.push(offer.id);
    else detachIds.push(offer.id);
  }
  return { deleteIds, detachIds };
}
