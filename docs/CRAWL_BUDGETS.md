# Acquisizione di siti e limiti

L'acquisizione web è attiva per impostazione predefinita e può essere disabilitata impostando `ENABLE_WEBSITE_INGEST=false`. Una scansione legge fino a 100 pagine, esamina fino a 500 indirizzi da sitemap e raccoglie al massimo 48 immagini e 12 documenti. Cerca prima le pagine aziendali e di catalogo; i siti più grandi possono richiedere una nuova scansione. Le prenotazioni sono conservate nel workspace SQLite locale e soggette a finestre temporali per client.

La convalida applicativa limita schema URL, destinazioni locali, redirect, pagine e dimensioni. L'importazione accetta solo siti pubblici in HTTPS, rispetta `robots.txt`, resta sullo stesso host e non segue redirect. Prodotti e file diventano bozze/fonti da controllare prima dell'uso. Non esporre l'app in rete e acquisisci solo siti che sei autorizzato a consultare.

Non c'è un contatore condiviso tra computer: usa un solo workspace alla volta e sincronizza prima di passare da un dispositivo all'altro. Le quote non sono un limite economico per OpenRouter.
