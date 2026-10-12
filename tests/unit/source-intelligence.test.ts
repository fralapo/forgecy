import assert from "node:assert/strict";
import {test} from "node:test";
import {publicHttpsUrl,parseRobots,robotsPermit,sitemapUrls,robotsSitemapUrls} from "../../lib/site-ingest";
import {reconcileDossierEvidence} from "../../lib/dossier-evidence";

test("website URLs reject SSRF destinations and unsupported schemes",()=>{
  for(const input of [
    "http://example.com/","file:///etc/passwd","https://localhost/",
    "https://127.0.0.1/","https://[::1]/","https://company.local/",
    "https://admin:pass@example.com/","https://example.com:8443/",
    "https://example.com./"
  ]) assert.throws(()=>publicHttpsUrl(input),Error,input);
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

test("sitemap discovery never escapes the same HTTPS origin and ranks company pages",()=>{
 const xml=`<?xml version="1.0"?><urlset>
 <url><loc>https://example.com/blog/foo</loc></url>
 <url><loc>https://example.com/servizi</loc></url>
 <url><loc>https://example.com/azienda</loc></url>
 <url><loc>https://localhost/private</loc></url>
 <url><loc>http://example.com/insecure</loc></url>
 <url><loc>https://evil.example.com/outside</loc></url>
 <url><loc>https://example.com/checkout</loc></url>
 <url><loc>https://example.com/brochure.pdf</loc></url>
 </urlset>`;
 const parsed=sitemapUrls(xml,"https://example.com",5);
 assert.equal(parsed.pages[0],"https://example.com/azienda");
 assert.ok(parsed.pages.includes("https://example.com/servizi"));
 assert.ok(!parsed.pages.some(v=>v.includes("evil")||v.includes("checkout")||v.endsWith(".pdf")));
 assert.equal(parsed.pages.length,3);
});

test("sitemap index parsing and robots sitemap hints reject off-origin URLs",()=>{
 const index=`<sitemapindex><sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap><sitemap><loc>http://example.com/insecure.xml</loc></sitemap><sitemap><loc>https://other.com/pages.xml</loc></sitemap></sitemapindex>`;
 assert.deepEqual(sitemapUrls(index,"https://example.com").indices,["https://example.com/sitemap-pages.xml"]);
 const hints=robotsSitemapUrls("User-agent: *\nSitemap: https://example.com/sitemap.xml\nSitemap: https://evil.example/sitemap.xml","https://example.com");
 assert.deepEqual(hints,["https://example.com/sitemap.xml"]);
});
