import assert from "node:assert/strict";
import {test} from "node:test";
import {catalogEvidenceIsValid,catalogExtractionSchema,catalogNameSimilarity,looksLikeCatalog,normalizeCatalogName,parseCsvCatalog} from "../../lib/catalog-import";

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
});
