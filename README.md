# Archivio Malattia

PWA locale per archiviare certificati di malattia da foto, PDF o inserimento manuale.

## Funzioni incluse
- PIN locale obbligatorio.
- Dati e allegati cifrati con AES-GCM.
- Derivazione chiave PIN con PBKDF2.
- Archivio IndexedDB sul dispositivo.
- Foto/PDF con OCR nel browser tramite Tesseract.js.
- Lettura diretta del testo nei PDF tramite PDF.js.
- Filtri, ricerca, conteggio giorni e avviso di fine prognosi.
- Backup cifrato, ripristino ed esportazione CSV.
- PWA installabile.

## Pubblicazione su GitHub Pages
1. Crea un nuovo repository, ad esempio `archivio-malattia`.
2. Carica tutti i file mantenendo la cartella `icons`.
3. Apri **Settings → Pages**.
4. Seleziona **Deploy from a branch**, ramo `main`, cartella `/root`.
5. Salva e apri l'indirizzo pubblicato da GitHub Pages.

## Sicurezza
I documenti non vengono inviati a un server dell'app. Le librerie OCR/PDF sono caricate da CDN; l'elaborazione del documento avviene nel browser. Il backup contiene dati cifrati e richiede il PIN originale.

Se il PIN viene dimenticato, i dati cifrati non sono recuperabili.
