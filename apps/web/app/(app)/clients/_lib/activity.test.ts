import { describe, expect, it } from "vitest";
import {
  activityArea,
  activityHref,
  activityQuery,
  activityVerb,
  actorVerb,
  isAnomaly,
  parseActivityFilters,
  parseActor,
} from "./activity";

describe("activityVerb", () => {
  it.each([
    ["brand.version.submit", "submitted"],
    ["brand.proposal.reject", "rejected"],
    ["product_import_started", "started"],
    ["product.image_add", "added"],
    ["client.ai_policy.change", "edited"],
    ["audit.ai.diagnose", "generated"],
    ["prospect.convert", "converted"],
    ["brand_check_issue_reopened", "reopened"],
    ["something.unknown", "updated"],
  ])("%s → %s", (action, verb) => {
    expect(activityVerb(action)).toBe(verb);
  });
});

describe("parseActor", () => {
  it("reads people, agents and the system", () => {
    expect(parseActor("user:u1", "u1")).toEqual({ kind: "person", userId: "u1" });
    expect(parseActor("agent:copywriter", null)).toEqual({ kind: "agent", role: "copywriter" });
    expect(parseActor("agent:unknown", null)).toEqual({ kind: "agent", role: null });
    expect(parseActor("system", null)).toEqual({ kind: "system" });
  });

  it("reads what an agent creates as a proposal", () => {
    expect(actorVerb(parseActor("agent:brand_analyst", null), "created")).toBe("proposed");
    expect(actorVerb(parseActor("user:u1", "u1"), "created")).toBe("created");
  });

  it("flags approvals by an agent as anomalies, never a person's", () => {
    expect(isAnomaly(parseActor("agent:reviewer", null), "approved")).toBe(true);
    expect(isAnomaly(parseActor("agent:reviewer", null), "proposed")).toBe(false);
    expect(isAnomaly(parseActor("user:u1", "u1"), "approved")).toBe(false);
  });
});

describe("areas and links", () => {
  it("groups entities by area", () => {
    expect(activityArea("audit_finding")).toBe("audit");
    expect(activityArea("brand_source")).toBe("brand");
    expect(activityArea("asset")).toBe("content");
    expect(activityArea("nope")).toBe("other");
  });

  it("links to the object's page when it can", () => {
    expect(activityHref("rossi", "content", "c1")).toBe("/content/rossi/carousels/c1");
    expect(activityHref("rossi", "product", "p1")).toBe("/products/rossi/p1");
    expect(activityHref("rossi", "test", null)).toBeNull();
  });
});

describe("filters", () => {
  it("drops unknown values and rounds the limit to whole pages", () => {
    expect(
      parseActivityFilters({ actorType: "agent", area: "other", period: "1y", limit: "70" }),
    ).toEqual({ actorType: "agent", area: null, period: null, limit: 100 });
    expect(parseActivityFilters({ limit: "999999" }).limit).toBe(1000);
    expect(parseActivityFilters({ limit: "abc" }).limit).toBe(50);
  });

  it("writes only the filters that are set", () => {
    expect(activityQuery({ area: "brand", limit: 50 })).toBe("?area=brand");
    expect(activityQuery({})).toBe("");
  });
});
