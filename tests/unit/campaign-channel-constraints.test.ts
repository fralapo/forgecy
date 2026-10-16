import assert from "node:assert/strict";
import test from "node:test";
import { linkedinAdaptationBlockReason } from "../../lib/campaign-channel-constraints";

test("LinkedIn adaptation is blocked by an explicit Italian campaign exclusion", () => {
  assert.equal(
    linkedinAdaptationBlockReason(
      "Un carosello Instagram. Nessun deliverable LinkedIn, nessuna pubblicazione.",
      {},
    ),
    "Il brief della campagna esclude LinkedIn.",
  );
});

test("LinkedIn adaptation is blocked when the strategy calendar excludes the channel", () => {
  assert.equal(
    linkedinAdaptationBlockReason("Campagna Instagram", {
      calendar: "Per i prossimi 30 giorni: solo Instagram. LinkedIn non previsto.",
    }),
    "Il brief della campagna esclude LinkedIn.",
  );
});

test("LinkedIn adaptation stays available when no explicit exclusion exists", () => {
  assert.equal(
    linkedinAdaptationBlockReason("Instagram e LinkedIn", {
      calendar: "Pubblicare un carosello Instagram e un adattamento professionale.",
    }),
    null,
  );
  assert.equal(linkedinAdaptationBlockReason(null, null), null);
});
