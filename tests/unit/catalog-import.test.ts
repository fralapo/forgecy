import assert from "node:assert/strict";
import {test} from "node:test";
import {catalogEvidenceIsValid,catalogExtractionModelSchema,catalogExtractionSchema,catalogNameSimilarity,looksLikeCatalog,normalizeCatalogName,parseCsvCatalog,parseMarkdownCatalogTable,parseMarkdownImageVariants} from "../../lib/catalog-import";

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
