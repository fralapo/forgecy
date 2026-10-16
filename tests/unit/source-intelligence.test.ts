import assert from "node:assert/strict";
import {test} from "node:test";
import {publicHttpsUrl,parseRobots,robotsPermit,sitemapUrls,robotsSitemapUrls,extractWebsitePage} from "../../lib/site-ingest";
import {reconcileDossierEvidence} from "../../lib/dossier-evidence";
import {extractWebsiteBrand,websiteStylesheetUrls} from "../../lib/website-brand";
import {matchWebsiteProductImage} from "../../lib/site-product-images";

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

test("website extraction collects a product catalog, brand assets, and same-host documents",()=>{
  const page=extractWebsitePage(new URL("https://shop.example/catalog/"),`<!doctype html><html><head>
    <title>Catalogo</title><meta name="description" content="Prodotti per la casa">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","logo":"/logo.png"}</script>
  </head><body><main><article class="dd-product-card"><a href="/products/soap"><h2>Sapone delicato</h2></a>
    <img src="/soap.webp" alt="Flacone Sapone"><div class="dd-product-card__body">Per superfici delicate</div>
    <span class="price">€ 12,50</span></article><a href="/catalogo.pdf">Catalogo PDF</a>
    <a href="https://other.example/private.pdf">Esterno</a><p>Testo utile del catalogo per superare la soglia di contenuto minimo.</p></main></body></html>`);
  assert.equal(page.title,"Catalogo");
  assert.equal(page.products.length,1);
  assert.equal(page.products[0].name,"Sapone delicato");
  assert.equal(page.products[0].price,12.5);
  assert.ok(page.assets.some(asset=>asset.role==="logo"&&asset.url==="https://shop.example/logo.png"));
  assert.ok(page.assets.some(asset=>asset.role==="product"&&asset.url==="https://shop.example/soap.webp"));
  assert.equal(page.documents.length,1);
  assert.equal(page.documents[0].url,"https://shop.example/catalogo.pdf");
  const unknownPrice=extractWebsitePage(new URL("https://shop.example/p/"),`<main><article class="dd-product-card"><h2>Prodotto</h2><p>Descrizione sufficientemente lunga e significativa.</p></article></main>`);
  assert.equal(unknownPrice.products[0].price,null);
});

test("website product images require an exact offer or a variant in the asset filename",()=>{
 const image=(id:string,title:string,url:string,hash:string|null=null,role="product")=>({id,title,url,file_path:`client/${id}.webp`,content_sha256:hash,source_metadata:{asset_role:role}});
 const sources=[
  image("softener","Deo Due Morbido Ammorbidente","https://shop.example/DD_Morbido_fiori-blu-82x300.png"),
  image("premium","Deo Due Morbido Ammorbidente Premium","https://shop.example/DD_Morbido_Premium_BIANCO-LATTE-80x300.png","same-premium"),
  image("premium-copy","Deo Due Morbido Ammorbidente Premium","https://shop.example/DD_Morbido_Premium_BIANCO-LATTE-80x300.png.webp","same-premium"),
  image("professional","Deo Due Profumatore Ambiente Professional Line","https://shop.example/prof-row1-0-126x300.png"),
  image("generic","Deo Due Profumatore Ambiente","https://shop.example/ambiente-0-113x300.png"),
  image("drops","Gocce di DeoDue","https://shop.example/gocce-oriental-clean-97x300.png"),
  image("sgrassatore","Deo Due Profumatore Sgrassatore","https://shop.example/profumatoresgrassatore_bianco-138x300.png"),
  image("linen","Deo Due Profuma Biancheria Estate Rosa","https://shop.example/Profumabiancheria_Estate_Rosa_250ml-300x300.png"),
  image("logo","Deo Due Morbido Ammorbidente Premium","https://shop.example/logo.png",null,"logo"),
 ];
 const offers=[
  "Deo Due Morbido Ammorbidente","Deo Due Morbido Ammorbidente – Fiori Blu","Deo Due Morbido Ammorbidente – Fleur d&#8217;Or",
  "Deo Due Morbido Ammorbidente Premium","Deo Due Morbido Ammorbidente Premium – Essenza di Bianco Latte","Deo Due Morbido Ammorbidente Premium – Nature",
  "Deo Due Profumatore Ambiente Professional Line","Deo Due Profumatore Ambiente Professional Line – Tiarè",
  "Deo Due Profumatore Ambiente","Deo Due Profumatore Ambiente – Bianco Latte",
  "Gocce di DeoDue","Gocce di DeoDue – Oriental","Gocce di DeoDue – Aloe",
  "Deo Due Profumatore Sgrassatore","Deo Due Profumatore Sgrassatore – Bianco","Deo Due Profumatore Sgrassatore – Rosa",
  "Deo Due Profuma Biancheria Estate Rosa","Deo Due Profuma Biancheria Estate Rosa – Fiori di Primavera",
 ];
 const find=(name:string)=>matchWebsiteProductImage(name,sources,offers)?.id||null;
 assert.equal(find("Deo Due Morbido Ammorbidente – Fiori Blu"),"softener");
 assert.equal(find("Deo Due Morbido Ammorbidente – Fleur d&#8217;Or"),null);
 assert.equal(find("Deo Due Morbido Ammorbidente"),null);
 assert.equal(find("Deo Due Morbido Ammorbidente Premium – Essenza di Bianco Latte"),"premium");
 assert.equal(find("Deo Due Morbido Ammorbidente Premium – Nature"),null);
 assert.equal(find("Deo Due Profumatore Ambiente Professional Line – Tiarè"),null);
 assert.equal(find("Deo Due Profumatore Ambiente"),"generic");
 assert.equal(find("Deo Due Profumatore Ambiente – Bianco Latte"),null);
 assert.equal(find("Gocce di DeoDue – Oriental"),"drops");
 assert.equal(find("Gocce di DeoDue – Aloe"),null);
 assert.equal(find("Deo Due Profumatore Sgrassatore – Bianco"),"sgrassatore");
 assert.equal(find("Deo Due Profumatore Sgrassatore – Rosa"),null);
 assert.equal(find("Deo Due Profuma Biancheria Estate Rosa"),"linen");
 assert.equal(find("Deo Due Profuma Biancheria Estate Rosa – Fiori di Primavera"),null);
 assert.equal(find("Deo Due"),null);
 assert.equal(find("Altro prodotto senza corrispondenze"),null);
 assert.equal(matchWebsiteProductImage("LAVATRICE DEO DUE ULTRA POWER + BIANCO",[image("ultrapower-white","Deo Due UltraPower Lavatrice +Bianco","https://shop.example/DD_Lavatrice-ULTRAPOWER-bianco.png")])?.id,"ultrapower-white");
 assert.equal(matchWebsiteProductImage("LAVATRICE DEO DUE ULTRA POWER + COLORI",[image("ultrapower-white","Deo Due UltraPower Lavatrice +Bianco","https://shop.example/DD_Lavatrice-ULTRAPOWER-bianco.png")]),null);
 assert.equal(matchWebsiteProductImage("Deo Due UltraPower Lavatrice +Bianco – +Bianco",[image("ultrapower-white","Deo Due UltraPower Lavatrice +Bianco","https://shop.example/DD_Lavatrice-ULTRAPOWER-bianco.png")])?.id,"ultrapower-white");
 assert.equal(matchWebsiteProductImage("Deo Due Profumatore Ambiente",[image("generic-a","Deo Due Profumatore Ambiente","https://shop.example/ambiente-0.png","hash-a"),image("generic-b","Deo Due Profumatore Ambiente","https://shop.example/ambiente-0.png","hash-b")]),null);
});

test("website extraction preserves heading, paragraph, list and table structure for passage indexing",()=>{
 const page=extractWebsitePage(new URL("https://shop.example/"),`<main>
  <h1>La nostra azienda</h1><p>Una prima descrizione del progetto.</p>
  <section><h2>Ingredienti</h2><p>Usiamo olio di jojoba per la pelle sensibile.</p>
   <ul><li>Formula senza profumo</li><li>Produzione locale</li></ul>
   <table><tr><th>Formato</th><th>Prezzo</th></tr><tr><td>250 ml</td><td>12 euro</td></tr></table>
  </section></main>`);
 assert.match(page.body,/## La nostra azienda\n\nUna prima descrizione/);
 assert.match(page.body,/## Ingredienti\n\nUsiamo olio di jojoba/);
 assert.match(page.body,/Formula senza profumo\n\nProduzione locale/);
 assert.match(page.body,/Formato \| Prezzo\n\n250 ml \| 12 euro/);
});

test("brand identity extraction reads the site logo, brand palette and font from public HTML and CSS",()=>{
  const html=`<html><head><title>Example - Public Company</title><meta property="og:site_name" content="Example - Public Company"><meta name="theme-color" content="#123456"><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="https://other.example/style.css">
    <script type="application/ld+json">{"@type":"Organization","logo":"/images/company-logo.svg"}</script></head>
    <body><header><img class="custom-logo" alt="Example brand" src="/images/brand-logo.svg"></header></body></html>`;
  assert.deepEqual(websiteStylesheetUrls("https://brand.example/",html),["https://brand.example/assets/site.css"]);
  assert.deepEqual(extractWebsiteBrand("https://brand.example/",html,[`:root{--primary-color:#123456;--secondary-color:#08765a;--accent-color:rgb(243, 162, 42);--page-background:#f6f1e5;font-family:'Inter',sans-serif}`]),{
    logoUrl:"https://brand.example/images/brand-logo.svg",
    palette:{primary:"#123456",secondary:"#08765a",accent:"#f3a22a",background:"#f6f1e5"},
    fontFamily:"Inter"
  });
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
