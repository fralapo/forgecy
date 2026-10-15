import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {test} from "node:test";
import {catalogEvidenceIsValid,catalogExtractionModelSchema,catalogExtractionSchema,catalogNameSimilarity,hasVariantPriceMatrix,looksLikeCatalog,normalizeCatalogName,parseCsvCatalog,parseLocalCatalogProducts,parseMarkdownCatalogCards,parseMarkdownCatalogCodePriceCards,parseMarkdownCatalogCodeVariants,parseMarkdownCatalogTable,parseMarkdownImageVariants,parseMarkdownVariantPriceMatrices,parsePositionedNativeCatalogRows} from "../../lib/catalog-import";

test("catalog names normalize accents and punctuation for safe matching",()=>{
 assert.equal(normalizeCatalogName("Caffè — Espresso 100%"),"caffe espresso 100");
 assert.equal(catalogNameSimilarity("Crema Viso Calendula 50 ml","Crema viso alla Calendula 50ml")>0.5,true);
 assert.equal(catalogNameSimilarity("Crema viso","Crema corpo"),0);
});

test("CSV catalogs support Italian semicolon separators, quoted commas and European prices",()=>{
 const source="Nome prodotto;Descrizione;Prezzo;Valuta\r\n\"Crema viso, calendula\";\"Per pelle secca; uso quotidiano\";\"1.299,50\";EUR\r\nSiero vitamina C;Formula illuminante;24,90;EUR";
 const products=parseCsvCatalog(source);
 assert.equal(products.length,2);
 assert.equal(products[0].name,"Crema viso, calendula");
 assert.equal(products[0].description,"Per pelle secca; uso quotidiano");
 assert.equal(products[0].price,1299.5);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(products[1].price,24.9);
});

test("catalog evidence rejects invented names, prices and descriptions",()=>{
 const source="Nome,Descrizione,Prezzo\nSiero viso,Con vitamina C,19.90";
 const valid=parseCsvCatalog(source)[0];
 assert.equal(catalogEvidenceIsValid(valid,source),true);
 assert.equal(catalogEvidenceIsValid({...valid,name:"Crema inventata"},source),false);
 assert.equal(catalogEvidenceIsValid({...valid,price:199},source),false);
 assert.equal(looksLikeCatalog("listino.pdf","Elenco prodotti con prezzo e codice"),true);
 assert.equal(looksLikeCatalog("Elios_Catalog_2025_page20.pdf","LEMON PLUS\nCodici\n10201000\nConfezione"),true);
 assert.equal(looksLikeCatalog("Sicutool-Catalogo-2025-pagina-1110.pdf","SGORBIE PER INTAGLIO\nProd. SCU\nDescrizione di riferimento vedi Art. 5234G 1\n5234G 8 Cad. 52,70\nPrezzi in EURO"),true);
 assert.equal(looksLikeCatalog("brief.txt","Presentazione aziendale e valori del brand"),false);
});

test("catalog extraction accepts a bounded visual reference or explicit absence",()=>{
 const product={name:"Crema viso",description:"",price:null,currency:"EUR",name_quote:"Crema viso",description_quote:"",price_quote:"",existing_offer_id:null,image_index:3};
 assert.equal(catalogExtractionSchema.safeParse({products:[product]}).success,true);
 assert.equal(catalogExtractionSchema.safeParse({products:[{...product,image_index:8}]}).success,false);
 const incomplete=catalogExtractionSchema.safeParse({products:[{...product,name:undefined,name_quote:""}]});
 assert.equal(incomplete.success,true);
 if(incomplete.success){
  assert.equal(incomplete.data.products[0].name,"Nome non verificato");
  const item=incomplete.data.products[0];
  assert.equal(catalogEvidenceIsValid({name:item.name,description:item.description,price:item.price,currency:item.currency,
   nameQuote:item.name_quote,descriptionQuote:item.description_quote,priceQuote:item.price_quote,
   existingOfferId:item.existing_offer_id,imageIndex:item.image_index},"Crema viso"),false);
 }
});

test("catalog model responses can be parsed before the importer caps them at 40 products",()=>{
 const product={name:"Prodotto valido",description:"",price:null,currency:"EUR",name_quote:"Prodotto valido",description_quote:"",price_quote:"",existing_offer_id:null,image_index:null};
 assert.equal(catalogExtractionSchema.safeParse({products:Array.from({length:41},()=>product)}).success,false);
 assert.equal(catalogExtractionModelSchema.safeParse({products:Array.from({length:41},()=>product)}).success,true);
});

test("OCR Markdown price tables are imported deterministically with exact row evidence",()=>{
 const source="Listino prodotti\n| Modello | Codice | Prezzo listino (IVA excl.) |\n| --- | --- | --- |\n| CL5000iL/Set 35 4CCE unità interna a cassetta | 7733701908 | 1.690,00 € |\n| CL5000iL/Set 53 4CCE unità interna a cassetta | 7733701909 | 2.180,00 € |\n\nPagina successiva\n| Modello | Codice | Prezzo listino (IVA excl.) |\n| --- | --- | --- |\n| CL5000iL/Set 70 4CE unità interna a cassetta | 7733701910 | 2.610,00 € |";
 const products=parseMarkdownCatalogTable(source);
 assert.equal(products.length,3);
 assert.equal(products[0].name,"CL5000iL/Set 35 4CCE unità interna a cassetta");
 assert.equal(products[0].price,1690);
 assert.equal(products[0].priceQuote,"1.690,00 €");
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
});

test("OCR item tables with a €/cad header preserve dimension, SKU and independent row prices",()=>{
 const source="Series 8000 — raccordi in ottone\n8090 Gomito a 90° F/F\n| Dimensione | Bustina | Scatola | Codice Articolo | €/cad |\n| --- | --- | --- | --- | --- |\n| 1 | 5 | 30 | 8090 008000000 | 12,17 |\n| 1 1/4 | 5 | 10 | 8090 010000000 | 20,79 |\n8090 C Gomito a 90° F/F, cromato\n| Dimensione | Bustina | Scatola | Codice Articolo | €/cad |\n| --- | --- | --- | --- | --- |\n| 1 | 10 | 20 | 8090 008C00000 | 16,39 |";
 const products=parseLocalCatalogProducts("Conex_Listino_2026_p188_scanned.pdf",source);
 assert.equal(products.length,3);
 assert.deepEqual(products.map(product=>[product.name,product.description,product.price]),[
  ["8090 Gomito a 90° F/F — 1 (8090 008000000)","1 — 5 — 30",12.17],
  ["8090 Gomito a 90° F/F — 1 1/4 (8090 010000000)","1 1/4 — 5 — 10",20.79],
  ["8090 C Gomito a 90° F/F, cromato — 1 (8090 008C00000)","1 — 10 — 20",16.39],
 ]);
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
 assert.equal(catalogEvidenceIsValid({...products[0]!,price:16.39},source),false);
});

test("Conex Serie 8000 page 188 OCR imports all table rows with family names and exact evidence",()=>{
 const source=readFileSync(join(process.cwd(),"tests/fixtures/conex-series-8000-page-188-ocr.md"),"utf8");
 const products=parseLocalCatalogProducts("Conex_Listino_2026_p188_scanned.pdf",source);
 assert.equal(products.length,23);
 assert.deepEqual(products.slice(0,2).map(product=>product.name),[
  "8090 Gomito a 90° F/F — 1/4 (8090 002000000)",
  "8090 Gomito a 90° F/F — 3/8 (8090 003000000)",
 ]);
 assert.deepEqual([
  ["8090 008000000",12.17],
  ["8090 010000000",20.79],
  ["8090 008C00000",16.39],
 ].map(([code])=>{
  const product=products.find(row=>row.name.includes(String(code)));
  return [product?.name,product?.price];
 }),[
  ["8090 Gomito a 90° F/F — 1 (8090 008000000)",12.17],
  ["8090 Gomito a 90° F/F — 1 1/4 (8090 010000000)",20.79],
  ["8090 C Gomito a 90° F/F, cromato — 1 (8090 008C00000)",16.39],
 ]);
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
 assert.ok(products.every(product=>product.imageIndex===null),"page-only OCR image references are not treated as product assets");
});

test("OCR width-price matrices expand exact code and size variants with explicit image references",()=>{
 const source="Catalogo Sicutool\nSGORBIE PER INTAGLIO\n5234G 8\n![img-0.jpeg](img-0.jpeg)\nDescrizione di riferimento vedi Art. 5234G 1\n| Larghe | mm | 2 | 4 |\n| --- | --- | --- | --- |\n| 5234G 8 | Cad. | 52,70 | 50,80 |\n| Larghe | mm | 6 | 8 |\n| --- | --- | --- | --- |\n| 5234G 8 | Cad. | 50,80 | 50,80 |\n5234G 9\n![img-1.jpeg](img-1.jpeg)\nDescrizione di riferimento vedi Art. 5234G 1\n| Larghe | mm | 2 | 4 |\n| --- | --- | --- | --- |\n| 5234G 9 | Cad. | 56,30 | 54,50 |";
 const products=parseLocalCatalogProducts("Sicutool-Catalogo-2025.pdf",source);
 assert.equal(products.length,6);
 assert.deepEqual(products.slice(0,4).map(product=>product.name),[
  "5234G 8 — 2 mm","5234G 8 — 4 mm","5234G 8 — 6 mm","5234G 8 — 8 mm"]);
 assert.deepEqual(products.map(product=>product.imageIndex),[0,0,0,0,1,1]);
 assert.ok(products.every(product=>product.price===null&&product.priceQuote===""));
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
 assert.equal(catalogEvidenceIsValid({...products[0]!,price:999},source),false);
});

test("OCR lists with description, code, segment and price columns keep identifiers and categories as evidence",()=>{
 const source="Listino prezzi Vaillant\n| Codice | Descrizione | Segmento | Prezzo € |\n| --- | --- | --- | --- |\n| 0010007523 | ecoVIT exclusive VKK 656/4-7 | Basamento Condensing | 6.185,00 |";
 const products=parseMarkdownCatalogTable(source);
 assert.equal(products.length,1);
 assert.equal(products[0].name,"ecoVIT exclusive VKK 656/4-7");
 assert.equal(products[0].description,"0010007523 — Basamento Condensing");
 assert.equal(products[0].descriptionQuote,JSON.stringify(["0010007523","Basamento Condensing"]));
 assert.equal(products[0].price,6185);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(catalogEvidenceIsValid({...products[0],descriptionQuote:JSON.stringify(["0010007523","Segmento inventato"])},source),false);
});

test("generic filenames are recognized when OCR yields explicit code-and-price Markdown tables",()=>{
 const source=readFileSync(join(process.cwd(),"tests/fixtures/stanley-2026-page-54-ocr.md"),"utf8");
 assert.equal(looksLikeCatalog("document.pdf",source),true);
 assert.equal(looksLikeCatalog("document.pdf","| Codice | Prezzo € |\n| --- | --- |\n| ABC123 | 32,90 |\n| ABC124 | 35,00 |"),true);
 assert.equal(looksLikeCatalog("document.pdf","| Codice | Prezzo € |\n| --- | --- |\n| ABC123 | 32,90 |\n\nNote generali"),false);
 const products=parseLocalCatalogProducts("document.pdf",source);
 assert.equal(products.length,7);
 assert.deepEqual([
  ["FMHT38214-0",32.9],
  ["FMHT38217-0",36],
  ["FMHT38232-0",39.2],
 ].map(([code])=>{
  const product=products.find(row=>row.name.includes(String(code))||row.description.includes(String(code)));
  return [product?.name,product?.description,product?.price];
 }),[
  ["FATMAX® XTREME™ — 5 (FMHT38214-0)","LUNGHEZZA (M): 5; LARGHEZZA (MM): 32",32.9],
  ["FATMAX® XTREME™ — 8 (FMHT38217-0)","LUNGHEZZA (M): 8; LARGHEZZA (MM): 32",36],
  ["FATMAX® XTREME™ — 10 (FMHT38232-0)","LUNGHEZZA (M): 10; LARGHEZZA (MM): 32",39.2],
 ]);
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
});

test("native price tables with tab-separated measurements retain family, dimensions, prices and evidence",()=>{
 const source=readFileSync(join(process.cwd(),"tests/fixtures/stanley-2026-page-54-native.txt"),"utf8");
 const products=parseLocalCatalogProducts("Stanley-listino-2026-page-54.pdf",source);
 assert.equal(products.length,7);
 assert.deepEqual([
  ["FMHT38214-0",32.9],
  ["FMHT38217-0",36],
  ["FMHT38232-0",39.2],
 ].map(([code])=>{
  const product=products.find(row=>row.name.includes(String(code)));
  return [product?.name,product?.description,product?.price];
 }),[
  ["FATMAX® XTREME™ — 5 × 32 (FMHT38214-0)","LUNGHEZZA (M): 5; LARGHEZZA (MM): 32",32.9],
  ["FATMAX® XTREME™ — 8 × 32 (FMHT38217-0)","LUNGHEZZA (M): 8; LARGHEZZA (MM): 32",36],
  ["FATMAX® XTREME™ — 10 × 32 (FMHT38232-0)","LUNGHEZZA (M): 10; LARGHEZZA (MM): 32",39.2],
 ]);
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
});

test("OCR product matrices without prices import coded products and package evidence deterministically",()=>{
 const source="Catalogo prodotti\n| Cod. | Descrizione Prodotto | Contenuto | Barcode | ITF-14 | Pz Crt |\n| --- | --- | --- | --- | --- | --- |\n| AMMORBIDENTE DEO DUE | | | | | |\n| DD107 | DEO DUE MORBIDO FIORI D'ACQUA | 1 LT | 8388776980149 | 18388776980146 | 6 |\n| DD103 | DEO DUE MORBIDO FIORI ROSA | 1 LT | 8388776980026 | 18388776980023 | 6 |";
 const products=parseMarkdownCatalogTable(source);
 assert.equal(products.length,2);
 assert.equal(products[0].name,"DEO DUE MORBIDO FIORI D'ACQUA");
 assert.equal(products[0].description,"DD107 — 1 LT — 8388776980149");
 assert.equal(products[0].price,null);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(products[1].name,"DEO DUE MORBIDO FIORI ROSA");
 assert.equal(catalogEvidenceIsValid({...products[0],description:"DD999 — 2 LT"},source),false);
 const withoutMarkdownSeparator=source.replace("| --- | --- | --- | --- | --- | --- |\n","");
 const scannedRows=parseMarkdownCatalogTable(withoutMarkdownSeparator);
 assert.equal(scannedRows.length,2);
 assert.equal(catalogEvidenceIsValid(scannedRows[0],withoutMarkdownSeparator),true);
 assert.deepEqual(parseMarkdownCatalogTable("Catalogo\n| Cod. | Descrizione |\n| --- | --- |\n| DD107 | Nome prodotto |"),[]);
});

test("native PDF catalog tables with vertically extracted columns import coded products without OCR",()=>{
 const source="Catalogo 2026\nCod.\nDescrizione Prodotto\nContenuto\nBarcode\nAMMORBIDENTE DEO DUE\nDD107\n\nDEO DUE MORBIDO FIORI D'ACQUA\n\n1 LT\n\n8388776980149\n\n18388776980146\n6\nDD103\n\nDEO DUE MORBIDO FIORI ROSA\n\n1 LT\n\n8388776980026";
 const products=parseLocalCatalogProducts("Catalogo_DeoDue_2026.pdf",source);
 assert.equal(products.length,2);
 assert.deepEqual(products.map(product=>product.name),["DEO DUE MORBIDO FIORI D'ACQUA","DEO DUE MORBIDO FIORI ROSA"]);
 assert.equal(products[0].description,"DD107 — 1 LT");
 assert.equal(products[0].price,null);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(catalogEvidenceIsValid({...products[1],descriptionQuote:JSON.stringify(["DD999","2 LT"])},source),false);
 assert.deepEqual(parseLocalCatalogProducts("Catalogo.pdf","Cod.\nDescrizione Prodotto\nDD107\n1 LT\n8388776980149"),[]);
});

test("native PDF code/price tables import deterministic product variants with exact evidence",()=>{
 const source="Listino Prezzi Marzo 2026\nOMNIA LIFE M \tPotenza termica A7W35 / COP\tCodice\tPrezzo\n04\t4,50 kW / 5,15\t2CP100AF\t8.705,84\n06\t6,20 kW / 4,90\t2CP100BF\t9.760,40";
 const products=parseLocalCatalogProducts("Listino Ferroli",source);
 assert.equal(products.length,2);
 assert.equal(products[0].name,"OMNIA LIFE M 04 (2CP100AF)");
 assert.equal(products[0].price,8705.84);
 assert.equal(products[0].priceQuote,"8.705,84");
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(catalogEvidenceIsValid({...products[0],price:9000},source),false);
 assert.equal(products[1].name,"OMNIA LIFE M 06 (2CP100BF)");
 assert.equal(catalogEvidenceIsValid(products[1],source),true);
});

test("OCR tables with only dimensions, product code and euro price import verifiable items",()=>{
 const source="USAG catalog 2026\n| mm | mm | mm | Cod. | immagine | € |\n| --- | --- | --- | --- | --- | --- |\n| 15÷35 | 3,5 | 168 | U02820301 | ![img-0.jpg](img-0.jpg) | 25,00 |\n| 35÷50 | 4 | 202 | U02820302 | ![img-0.jpg](img-0.jpg) | 29,00 |";
 const products=parseLocalCatalogProducts("Catalogo USAG",source);
 assert.equal(looksLikeCatalog("Catalogo USAG",source),true);
 assert.equal(products.length,2);
 assert.equal(products[0].name,"U02820301");
 assert.equal(products[0].description,"15÷35 — 3,5 — 168");
 assert.equal(products[0].price,25);
 assert.equal(products[0].imageIndex,0);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(products[1].name,"U02820302");
 assert.equal(catalogEvidenceIsValid(products[1],source),true);
 const noPrice=source.replace("| 15÷35 | 3,5 | 168 | U02820301 | ![img-0.jpg](img-0.jpg) | 25,00 |","| 15÷35 | 3,5 | 168 | U02820301 | ![img-0.jpg](img-0.jpg) | |" );
 assert.equal(parseMarkdownCatalogTable(noPrice).some(product=>product.name==="U02820301"),false);
});

test("OCR product tables headed Codice, Descrizione and Listino import locally with exact code and price evidence",()=>{
 const source="LISTINO GUANTI 2025\n| Codice | Descrizione | Listino |\n| --- | --- | --- |\n| GUG00009 | ATLAS Conf=12 Pa | 138,65 € |\n| GUG14409 | ATLAS Conf=144 Pa | 1.569,60 € |\n| GUG00020 | BACHATA Conf=12 Pa | 61,70 € |";
 const products=parseMarkdownCatalogTable(source);
 assert.equal(products.length,3);
 assert.equal(products[0].name,"ATLAS Conf=12 Pa");
 assert.equal(products[0].description,"GUG00009");
 assert.equal(products[0].price,138.65);
 assert.equal(products[1].price,1569.6);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(catalogEvidenceIsValid({...products[0],price:138.66},source),false);
 const csv="Codice;Descrizione;Listino\nGUG00009;ATLAS Conf=12 Pa;138,65 €\nGUG14409;ATLAS Conf=144 Pa;1.569,60 €";
 const csvProducts=parseCsvCatalog(csv);
 assert.equal(csvProducts.length,2);
 assert.equal(csvProducts[0].name,"ATLAS Conf=12 Pa");
 assert.equal(csvProducts[0].description,"GUG00009");
 assert.equal(csvProducts[0].price,138.65);
 assert.equal(catalogEvidenceIsValid(csvProducts[0],csv),true);
});

test("OCR product image blocks retain exact variant labels, printed codes and image references",()=>{
 const source="# Acme Surface Cleaner\n## Product variations\n![img-0.jpeg](img-0.jpeg)\nBlue\nCod.AC-100\nEAN OCR noise\n\n![img-1.jpeg](img-1.jpeg)\nGreen\nCod.AC-101\nEAN OCR noise";
 const products=parseMarkdownImageVariants(source);
 assert.equal(products.length,2);
 assert.equal(products[0].name,"Acme Surface Cleaner Blue");
 assert.equal(products[0].description,"Cod.AC-100");
 assert.equal(products[0].price,null);
 assert.equal(products[0].imageIndex,0);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(products[1].name,"Acme Surface Cleaner Green");
 assert.equal(products[1].description,"Cod.AC-101");
 assert.equal(products[1].imageIndex,1);
 assert.equal(catalogEvidenceIsValid(products[1],source),true);
 assert.equal(catalogEvidenceIsValid({...products[0],name:"Invented Surface Cleaner Blue"},source),false);
 assert.deepEqual(parseMarkdownImageVariants("# Scheda tecnica 2026\n![img-0.jpeg](img-0.jpeg)\nBlue\nCod.AC-100"),[]);
});

test("OCR product cards import printed codes and package variants while linking the product image",()=>{
 const source="# LEMON PLUS\n![img-0.jpeg](img-0.jpeg)\n# Detergente stoviglie concentrato\nDetergente manuale\n# CAMPO D'IMPIEGO\nMense e cucine\nCodici Confezione\n10201000 cartone da 4 taniche\n10201001 tanica da 10 kg\n# PIATTI AGRUMI\n![img-2.jpeg](img-2.jpeg)\n# Detergente stoviglie\nFormula agli agrumi\n# CAMPO D'IMPIEGO\nMense e cucine\nCodici Confezione\n10201006 cartone da 4 taniche\n# SPEZIAL GEL\n# Sgrassante concentrato gel\nUso professionale\n# CAMPO D'IMPIEGO\nRistoranti e cucine\nCodici Confezione\n10203007 flacone da 750 ml";
 const products=parseMarkdownCatalogCards(source);
 assert.equal(parseLocalCatalogProducts("forgecy-elios-sample-20.pdf",source).length,3);
 assert.equal(products.length,3);
 assert.equal(products[0].name,"LEMON PLUS");
 assert.equal(products[0].description,"Detergente stoviglie concentrato — 10201000 cartone da 4 taniche — 10201001 tanica da 10 kg");
 assert.equal(products[0].imageIndex,0);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(products[1].name,"PIATTI AGRUMI");
 assert.equal(products[1].imageIndex,2);
 assert.equal(catalogEvidenceIsValid(products[1],source),true);
 assert.equal(products[2].name,"SPEZIAL GEL");
 assert.equal(products[2].imageIndex,null);
 assert.equal(catalogEvidenceIsValid(products[2],source),true);
 const incomplete=source.replace("10203007 flacone da 750 ml","Codice non leggibile");
 assert.deepEqual(parseMarkdownCatalogCards(incomplete),[]);
});

test("OCR family variant lists import every label/code pair and preserve only explicit image links",()=>{
 const source="[Pagine PDF 1–2]\n# Detergente concentrato\n![img-0.jpeg](img-0.jpeg)\nLavanda\nCod.ZX101\n![img-1.jpeg](img-1.jpeg)\nFresco\nCod.ZX102\n## Benefici\nTesto descrittivo\n# Detergente delicato\nNeutro\nCod.ZX103\nAgrumi\nCod.ZX104\nAlba\nCod.ZX105\n## Benefici\nTesto descrittivo";
 const products=parseMarkdownCatalogCodeVariants(source);
 assert.equal(products.length,5);
 assert.equal(parseLocalCatalogProducts("Catalogo detergenti.pdf",source).length,5);
 assert.equal(products[0].name,"Detergente concentrato — Lavanda");
 assert.equal(products[0].imageIndex,0);
 assert.equal(products[1].name,"Detergente concentrato — Fresco");
 assert.equal(products[1].imageIndex,1);
 assert.equal(products[2].name,"Detergente delicato — Neutro");
 assert.equal(products[2].imageIndex,null);
 assert.equal(products[2].price,null);
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
 assert.deepEqual(parseMarkdownCatalogCodeVariants("# Manuale tecnico\nVariante unica\nCod.AB123"),[]);
});

test("positioned PDF catalog rows join measurements, SKU and price within each column",()=>{
 const source="Catalogo USAG 282 SN 15÷35 3,5 168 U02820301 25,00 6x7 167 U02831302 9,15";
 const products=parsePositionedNativeCatalogRows("Catalogo USAG 2026.pdf",[
  {str:"15÷35",x:30,y:100},{str:"3,5",x:65,y:100},{str:"168",x:83,y:100},{str:"U02820301",x:115,y:100},{str:"1",x:160,y:100},{str:"25,00",x:187,y:100},
  {str:"6x7",x:220,y:100},{str:"167",x:265,y:100},{str:"U02831302",x:296,y:100},{str:"1",x:340,y:100},{str:"9,15",x:369,y:100}
 ]);
 assert.equal(products.length,2);
 assert.equal(products[0].name,"15÷35 3,5 168 (U02820301)");
 assert.equal(products[0].price,25);
 assert.equal(catalogEvidenceIsValid(products[0],source),true);
 assert.equal(products[1].name,"6x7 167 (U02831302)");
 assert.equal(products[1].price,9.15);
 assert.equal(catalogEvidenceIsValid(products[1],source),true);
});

test("positioned PDF rows reject ambiguous prices and unlabelled codes",()=>{
 assert.deepEqual(parsePositionedNativeCatalogRows("Catalogo.pdf",[
  {str:"U02820301",x:115,y:100},{str:"25,00",x:150,y:100},{str:"30,00",x:170,y:100},
  {str:"U02820302",x:115,y:90},{str:"25,00",x:150,y:90}
 ]),[]);
});

test("OCR plain-text width matrices retain evidenced variants without trusting possibly shifted prices",()=>{
 const source="Larg. mm 2 4 6\n5234G 1 Cad. 38,10 36,30\nLarg. mm 18 20 22\n5234G 1 Cad. 51,30 53,20 55,10";
 const products=parseMarkdownVariantPriceMatrices(source);
 assert.equal(products.length,6);
 assert.deepEqual(products.map(product=>[product.name,product.price]),[
  ["5234G 1 — 2 mm",null],["5234G 1 — 4 mm",null],["5234G 1 — 6 mm",null],
  ["5234G 1 — 18 mm",null],["5234G 1 — 20 mm",null],["5234G 1 — 22 mm",null]
 ]);
 assert.ok(products.every(product=>product.imageIndex===null&&product.priceQuote===""&&catalogEvidenceIsValid(product,source)));
});

test("OCR Markdown matrices honor leading blank columns and reject incomplete price rows",()=>{
 const source="| 5234G 33 | 500 | Descrizione riferimento | | | | | | |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| | | Larghe | mm | 6 | 8 | 10 | 12 | 16 |\n| | | 5234G 33 | Cad. | 33,70 | 33,70 | 33,70 | 36,10 | 37,10 |\n| 5234G 34 | 500 | Descrizione riferimento | | | | | | |\n| | | Larghe | mm | 2 | 4 | 6 | 8 | 10 | 12 |\n| | | 5234G 34 | Cad. | 56,30 | 54,50 | 54,50 | 54,50 | 58,40 | 60,30 |\n| 5234G 46 | 500 | Descrizione riferimento | | | | | | |\n| | | Larghe | mm | 2 | 4 | 6 | 8 | 10 | 12 |\n| | | 5234G 46 | Cad. | 65,30 | 63,50 | 63,50 | 63,50 | 80,20 | |";
 const products=parseMarkdownVariantPriceMatrices(source);
 assert.equal(products.length,17);
 assert.deepEqual(products.slice(0,5).map(product=>[product.name,product.price]),[
  ["5234G 33 — 6 mm",null],["5234G 33 — 8 mm",null],["5234G 33 — 10 mm",null],
  ["5234G 33 — 12 mm",null],["5234G 33 — 16 mm",null]
 ]);
 assert.equal(products.at(-1)?.name,"5234G 46 — 12 mm");
 assert.ok(products.every(product=>product.price===null&&product.priceQuote===""));
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
 assert.equal(hasVariantPriceMatrix(source),true);
 assert.equal(parseLocalCatalogProducts("Sicutool Catalogo.pdf",source).length,17);
});

test("variant matrix review warning recognizes padded Markdown and plain-text layouts",()=>{
 assert.equal(hasVariantPriceMatrix("| | Larghe | mm | 2 |\n| | 5234G 1 | Cad. | 38,10 |"),true);
 assert.equal(hasVariantPriceMatrix("Larg. mm 2 4\n5234G 1 Cad. 38,10 36,30"),true);
 assert.equal(hasVariantPriceMatrix("| Codice | Descrizione | Prezzo |\n| ABC123 | Guanto | 4,50 |"),false);
});

test("OCR catalog cards import inline SKU prices and keep accessory images unassigned",()=>{
 const source="# 5233TP\n![img-0.jpeg](img-0.jpeg)\nDescrizione di riferimento vedi Art. 5233TL\nLama con movimento a vite.\n| Lungh. totale | mm | 195 |\n| --- | --- | --- |\n| 5233TP | Cad. | 10,10 |\nLAME DI RICAMBIO per Art. 5233 TL - TP. Confezione minima fornibile 10 lame.\n| Larghezza lama | mm | 25 |\n| --- | --- | --- |\n| O5233TP | Cad. | 1,30 |";
 const products=parseMarkdownCatalogCodePriceCards(source);
 assert.equal(parseLocalCatalogProducts("Sicutool catalogo 2025.pdf",source).length,2);
 assert.equal(products.length,2);
 assert.equal(products[0]?.name,"5233TP");
 assert.equal(products[0]?.price,10.1);
 assert.equal(products[0]?.imageIndex,0);
 assert.equal(products[1]?.name,"O5233TP");
 assert.equal(products[1]?.price,1.3);
 assert.equal(products[1]?.imageIndex,null);
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
});

test("native text Sicutool product cards import inline unit and pack prices with row evidence",()=>{
 const source=readFileSync(join(process.cwd(),"tests/fixtures/sicutool-2025-page-1108-native.txt"),"utf8");
 const products=parseLocalCatalogProducts("Sicutool catalogo 2025 pagina 1108.pdf",source);
 assert.equal(products.length,9);
 assert.deepEqual(products.map(product=>[product.name.match(/\(([^)]+)\)$/u)?.[1],product.price]),[
  ["5233TE",30.9],["O5233TE",13.1],["5233TL",8.1],["5233TP",10.1],
  ["O5233TP",1.3],["5233V",23.8],["O5233V",11.1],["5234",18.5],["O5234",18.1],
 ]);
 assert.ok(products.every(product=>catalogEvidenceIsValid(product,source)));
});
