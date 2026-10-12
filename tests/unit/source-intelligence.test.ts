import assert from "node:assert/strict";
import {test} from "node:test";
import {publicHttpsUrl,parseRobots,robotsPermit} from "../../lib/site-ingest";
import {reconcileDossierEvidence} from "../../lib/dossier-evidence";

test("website URLs reject SSRF destinations and unsupported schemes",()=>{
  for(const input of [
    "http://example.com/","file:///etc/passwd","https://localhost/",
    "https://127.0.0.1/","https://[::1]/","https://company.local/",
    "https://admin:pass@example.com/","https://example.com:8443/",
    "https://example.com./"
  ]) assert.throws(()=>publicHttpsUrl(input),undefined,input);
  assert.equal(publicHttpsUrl("https://example.com/about#anchor").toString(),"https://example.com/about");
});

test("robots groups, longest match, star wildcard and terminal anchor",()=>{
  const rules=parseRobots(`
User-agent: *
Disallow: /private
Allow: /private/public
Disallow: /*.pdf$

User-agent: ForgecyResearch
Disallow: /internal
Allow: /internal/public
`);
  // A matching product-token group overrides the wildcard group.
  assert.equal(robotsPermit(rules,new URL("https://example.com/private")) ,true);
  assert.equal(robotsPermit(rules,new URL("https://example.com/internal")) ,false);
  assert.equal(robotsPermit(rules,new URL("https://example.com/internal/public")) ,true);
  assert.equal(robotsPermit(rules,new URL("https://example.com/a.pdf")) ,true);
  const wildcard=parseRobots("User-agent: *\nDisallow: /*.pdf$\nAllow: /news/");
  assert.equal(robotsPermit(wildcard,new URL("https://example.com/files/test.pdf")),false);
  assert.equal(robotsPermit(wildcard,new URL("https://example.com/files/test.pdf/preview")),true);
  assert.equal(robotsPermit(wildcard,new URL("https://example.com/news/a")),true);
});

test("verified dossier findings require an actual quote present in the cited client source",()=>{
  const material=[{id:"source-a",body:"Atelier Forma offre consulenze di interior design a Milano.",status:"ready"}];
  const draft=[
    {topic:"Offerta",claim:"L'azienda offre consulenze di interior design.",source_ids:["source-a"],
      certainty:"verified" as const,evidence_quote:"offre consulenze di interior design"},
    {topic:"Prezzi",claim:"I prezzi partono da 100 euro.",source_ids:["source-a"],
      certainty:"verified" as const,evidence_quote:"prezzi partono da 100 euro"},
    {topic:"Sorgente esterna",claim:"L'azienda ha 100 clienti.",source_ids:["other-client"],
      certainty:"verified" as const,evidence_quote:"L'azienda ha 100 clienti"}
  ];
  const {findings,report}=reconcileDossierEvidence(draft,material,"2026-10-12T00:00:00Z");
  assert.equal(findings[0].certainty,"verified");
  assert.equal(findings[1].certainty,"inferred");
  assert.equal(findings[1].evidence_quote,"");
  assert.deepEqual(findings[2].source_ids,[]);
  assert.equal(findings[2].certainty,"inferred");
  assert.equal(report.verified,1);
  assert.equal(report.downgraded,2);
  assert.equal(report.invalid_source_references,1);
  assert.equal(report.checked_at,"2026-10-12T00:00:00Z");
});

test("sources pending extraction cannot verify a factual claim",()=>{
  const findings=[{
    topic:"Brand",claim:"Test",source_ids:["pending"],certainty:"verified" as const,
    evidence_quote:"brand narrative supported in document"
  }];
  const {findings:output,report}=reconcileDossierEvidence(findings,[
    {id:"pending",body:"brand narrative supported in document",status:"pending"}
  ]);
  assert.equal(output[0].certainty,"inferred");
  assert.equal(report.invalid_source_references,1);
});
