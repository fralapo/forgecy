export type ExpectedPricedProduct = { code: string; variant: string; price: number };
export type DocumentEvaluation = {
  textMarkerIndices: number[];
  tableRowIndices: number[];
  productMarkerIndices: number[];
  pricedProductMarkerIndices: number[];
  expectationsPassed: boolean;
};

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function evaluateDocumentEvidence(input: {
  body: string;
  offers: Array<{ name?: unknown; description?: unknown; price?: unknown }>;
  expectedText: string[];
  expectedRows: string[];
  expectedProducts: string[];
  expectedPricedProducts: ExpectedPricedProduct[];
}): DocumentEvaluation {
  const normalizedBody = normalize(input.body);
  const compactBody = input.body.replace(/\s+/gu, "").toLocaleLowerCase("it");
  const productEvidence = input.offers.map(offer => normalize(`${String(offer.name || "")} ${String(offer.description || "")}`));
  const textMarkerIndices = input.expectedText.flatMap((marker, index) => normalizedBody.includes(normalize(marker)) ? [index + 1] : []);
  const tableRowIndices = input.expectedRows.flatMap((row, index) => compactBody.includes(row.replace(/\s+/gu, "").toLocaleLowerCase("it")) ? [index + 1] : []);
  const productMarkerIndices = input.expectedProducts.flatMap((marker, index) => productEvidence.some(evidence => evidence.includes(normalize(marker))) ? [index + 1] : []);
  const pricedProductMarkerIndices = input.expectedPricedProducts.flatMap((expected, index) => input.offers.some((offer, offerIndex) =>
    productEvidence[offerIndex]!.includes(normalize(expected.code)) &&
    productEvidence[offerIndex]!.includes(normalize(expected.variant)) &&
    offer.price !== null && offer.price !== undefined && offer.price !== "" && Number.isFinite(Number(offer.price)) &&
    Number(offer.price) === expected.price,
  ) ? [index + 1] : []);

  const expectationsPassed = textMarkerIndices.length === input.expectedText.length &&
    tableRowIndices.length === input.expectedRows.length &&
    productMarkerIndices.length === input.expectedProducts.length &&
    pricedProductMarkerIndices.length === input.expectedPricedProducts.length;
  return { textMarkerIndices, tableRowIndices, productMarkerIndices, pricedProductMarkerIndices, expectationsPassed };
}
