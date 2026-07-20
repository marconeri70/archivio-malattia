# Archivio Malattia 2.0

PWA personale per archiviare certificati di malattia da foto, PDF, condivisione Android o inserimento manuale.

## Novità della versione 2.0

- PIN da 6 a 10 cifre, tentativi rallentati e blocco automatico.
- Cambio PIN con ricifratura completa dell’archivio.
- Dati e allegati cifrati con AES-GCM; chiave derivata con PBKDF2.
- Backup cifrato con controllo di integrità e verifica del PIN prima del ripristino.
- Importazione di più foto/PDF per ogni certificato.
- Compressione automatica delle fotografie.
- Ritaglio, rotazione, contrasto, bianco e nero e correzione automatica della prospettiva.
- OCR italiano e lettura PDF eseguiti con librerie incluse nella cartella `vendor`.
- Lettura delle pagine dei PDF scansionati, con evidenziazione dei campi da controllare.
- Collegamento tra certificato iniziale, continuazioni e ricadute.
- Avvisi per sovrapposizioni, interruzioni e continuazioni senza certificato iniziale.
- Comunicazione all’azienda, visita fiscale, categoria e giornate lavorative.
- Statistiche mensili, annuali, categorie e calendario.
- Esportazione CSV, PDF, stampa, condivisione e promemoria `.ics`.
- Procedura guidata per scaricare il PDF dal portale INPS senza salvare SPID/CIE.
- Share Target Android: dopo l’installazione, immagini e PDF possono essere condivisi con l’app.
- Indicatore dello spazio occupato e richiesta di archiviazione persistente.

## Pubblicazione su GitHub Pages

1. Estrai lo ZIP.
2. Crea un repository GitHub, ad esempio `archivio-malattia`.
3. Carica **tutti** i file e le cartelle, inclusa la cartella `vendor`.
4. Apri **Settings → Pages**.
5. Seleziona **Deploy from a branch**, ramo `main`, cartella `/root`.
6. Salva e attendi la pubblicazione.

La cartella `vendor` è grande perché contiene OCR italiano, PDF.js, OpenCV e generazione PDF. Non eliminarla e non rinominare i file.

## Aggiornamento dalla versione 1

Puoi sostituire i file del repository con quelli della versione 2. Il database IndexedDB e i certificati esistenti vengono mantenuti. Il vecchio PIN da 4 cifre continua a sbloccare l’archivio; quando usi **Cambia PIN**, il nuovo PIN deve avere almeno 6 cifre.

Prima di aggiornare è consigliato creare un backup dalla versione precedente.

## Sicurezza e limiti

- I dati restano nel browser e vengono cifrati prima del salvataggio in IndexedDB.
- Il backup contiene dati cifrati ma va comunque conservato con attenzione.
- I PDF di riepilogo, i CSV e i file stampati **non sono cifrati**.
- Senza PIN e senza backup valido i dati non sono recuperabili.
- La lettura OCR può commettere errori: confronta sempre i campi con il certificato originale.
- L’app non accede automaticamente all’area personale INPS e non deve memorizzare credenziali SPID/CIE.
