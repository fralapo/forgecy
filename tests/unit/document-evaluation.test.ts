import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDocumentEvidence } from "../../lib/document-evaluation";

test("document evaluation fails when any independently supplied text, row, product or price marker is missing", () => {
  const result = evaluateDocumentEvidence({
    body: "Codice 8090 008000000 · Dimensione 1 · Prezzo 12,17 EUR",
    offers: [{ name: "Gomito a 90 gradi FF 1 (8090 008000000)", description: "1 pollice", price: 12.17 }],
    expectedText: ["8090 008000000"], expectedRows: ["Codice 8090 008000000"],
    expectedProducts: ["8090 008000000"], expectedPricedProducts: [{ code: "8090 008000000", variant: "1 pollice", price: 12.17 }],
  });
  assert.equal(result.expectationsPassed, true);
  assert.deepEqual(result.pricedProductMarkerIndices, [1]);

  const wrongPrice = evaluateDocumentEvidence({
    body: "Codice 8090 008000000 · Dimensione 1 · Prezzo 12,17 EUR",
    offers: [{ name: "Gomito a 90 gradi FF 1 (8090 008000000)", description: "1 pollice", price: 14.17 }],
    expectedText: ["8090 008000000"], expectedRows: ["Codice 8090 008000000"],
    expectedProducts: ["8090 008000000"], expectedPricedProducts: [{ code: "8090 008000000", variant: "1 pollice", price: 12.17 }],
  });
  assert.equal(wrongPrice.expectationsPassed, false);
  assert.deepEqual(wrongPrice.pricedProductMarkerIndices, []);

  const missingZeroPrice = evaluateDocumentEvidence({
    body: "Codice AB12345, variante piccola, prezzo non leggibile",
    offers: [{ name: "Prodotto AB12345", description: "variante piccola", price: null }],
    expectedText: [], expectedRows: [], expectedProducts: [],
    expectedPricedProducts: [{ code: "AB12345", variant: "piccola", price: 0 }],
  });
  assert.equal(missingZeroPrice.expectationsPassed, false);
  assert.deepEqual(missingZeroPrice.pricedProductMarkerIndices, []);
});

test("document evaluation verifies expected product-image links and explicit unlinked variants", () => {
  const input = {
    body: "",
    offers: [
      { name: "FATMAX AUTOLOCK 8 m XTHT033671", description: "", price: 45.5 },
      { name: "Accessory", description: "SKU-002", price: 2 },
    ],
    expectedText: [], expectedRows: [], expectedProducts: [], expectedPricedProducts: [],
    expectedImageLinks: [
      { code: "XTHT033671", imageIndex: 2 },
      { code: "SKU-002", imageIndex: null },
    ],
    imageAssignments: [
      { productName: "FATMAX AUTOLOCK 8 m XTHT033671", imageIndex: 2 },
      { productName: "Accessory", imageIndex: null },
    ],
  };
  const linked = evaluateDocumentEvidence(input);
  assert.equal(linked.expectationsPassed, true);
  assert.deepEqual(linked.imageLinkMarkerIndices, [1, 2]);

  const wrongImage = evaluateDocumentEvidence({
    ...input,
    imageAssignments: input.imageAssignments.map(assignment => assignment.productName.includes("FATMAX")
      ? { ...assignment, imageIndex: 1 }
      : assignment),
  });
  assert.equal(wrongImage.expectationsPassed, false);
  assert.deepEqual(wrongImage.imageLinkMarkerIndices, [2]);
});
