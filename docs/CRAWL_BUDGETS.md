# Acquisizione di siti e limiti

L'acquisizione web è una funzione opzionale disattivata per impostazione predefinita. Quando abilitata, i limiti e le prenotazioni sono conservati nel workspace SQLite locale e comprendono il numero massimo di pagine e finestre temporali per client. Le richieste non valide non consumano quote; una prenotazione confermata viene mantenuta anche se il sito non risponde.

La convalida applicativa limita schema URL, destinazioni locali e redirect e applica tetti a pagine e dimensioni. Poiché il server effettua richieste verso URL forniti dall'utente, mantieni `ENABLE_WEBSITE_INGEST=false` se non ti serve. Non esporre l'app in rete e non usare la funzione su destinazioni interne o non autorizzate.

Non c'è un contatore condiviso tra computer: usa un solo workspace alla volta e sincronizza prima di passare da un dispositivo all'altro. Le quote non sono un limite economico per OpenRouter.
