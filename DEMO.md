# Charlie — Demo & standalone

Documentatie van de presentatie-demo ("de film") in `index.html`, de offline standalone, en het deploy-proces.

## Wat is de demo?

Een gescripte, geanimeerde rondleiding ("film") die Charlie toont. Volledig **client-side**: gebruikt ingebouwde voorbeelddata (`SAMPLE_DOSSIER`, `buildDemoMedia()`), geen API-calls. Start via de landingspagina → **"Watch the demo"**.

**Besturing (presentatie-klikker / toetsenbord):**
- `→` of `spatie` = volgende · `←` = terug · `F` = fullscreen · `Esc` / `X` = sluiten

## Live & download

| | URL |
|---|---|
| Live demo | https://charlie-ced.netlify.app |
| Offline standalone (download) | https://charlie-ced.netlify.app/charlie-demo-standalone.html |

## Offline standalone (voor presentaties zonder WiFi)

Eén self-contained HTML-bestand, **nul netwerk-requests**. Inter-font én de 3 demo-foto's zitten als base64 ingebed; de Google Fonts-link, de 3 CDN-scripts (cfb/pdf.js/jszip, alleen voor échte uploads) en alle externe paden zijn eruit.

**Bouwen / verversen** (na elke wijziging aan `index.html`):
```bash
node build-standalone.js          # schrijft charlie-demo-standalone.html (~3 MB)
npx netlify deploy --prod --dir . # ook de download-URL verversen
```
Het bouwscript haalt het font online op (heeft internet nodig tijdens het bouwen). De standalone zelf is git-ignored; alleen `build-standalone.js` staat in de repo.

**Gebruik:** dubbelklik het bestand → opent in de browser → werkt volledig offline.

## Deployen — BELANGRIJK

De live-site wordt **via de Netlify CLI** gedeployed, niet via git auto-deploy. Een `git push` werkt de live-site **niet** bij. Na committen altijd:
```bash
npx netlify deploy --prod --dir .
```
(Site `charlie-ced`, team Freddie, siteId `fc6db1df-05f0-4273-9a79-6930ab9b58b6`.)

## Demo-structuur (23 stappen)

Elke stap is `demoStep('<scene>', async () => {...})` in `buildDemoSteps()` — de scene-tag reist mee met de stap (geen losse parallelle lijst meer). `DEMO_SECONDS` = duur per stap; chapter-ticks markeren de acts.

| # | Stap | Scene |
|--|------|-------|
| 0–1 | The problem · Meet Charlie | choice |
| 2 | **ACT 1** — Charlie builds the file | chapter |
| 3 | One drop in (lege dropzone) | buildex |
| 4 | From Outlook (nep-Outlook venster) | outlook |
| 5 | .msg vliegt naar dropzone → form vult vanzelf in | outlook |
| 6 | A complete file (samenvatting) | buildex |
| 7 | Documents — AI hernoemt + ballon "Renamed automatically" | buildex |
| 8 | Photos (Multimedia-tab, 3 foto's) | buildex |
| 9 | You stay in control — velden **licht** oranje | buildex |
| 10 | One click onward — velden worden **donker** oranje | buildex |
| 11 | Done — muis → "Push to BuildeX" → klik → popup | buildex |
| 12 | **ACT 2** — Charlie answers the mail (subtitel 2 regels) | chapter |
| 13 | A customer writes in (inkomende mail) | reply |
| 14 | Trained on the routine | reply |
| 15 | The answer, instantly (gedraft antwoord) | reply |
| 16 | **ACT 3** — It gets better every day | chapter |
| 17 | You tweak, it learns (Save & learn) | reply |
| 18 | The same for every file — muis → Edit → polis hernoemen | buildex |
| 19–21 | The old way · The Charlie way · In time, fully automatic | concept |
| 22 | Eindslide — *That's Charlie.* (editorial, geen ballon) | chapter |

**Geanimeerde muis-cursor** (`demoCursorTo` / `demoCursorClick`): bij stap 11 (Push to BuildeX) en stap 18 (Edit-knop → veld).

## Belangrijke functies in index.html

- `buildDemoSteps()` — de stappenlijst · `runDemoFilm()` — de runner · `demoScene(tag)` — basis-view per scene
- `demoSetCaption` / `demoChapter` — narratie-ballon / chapter-kaart (sub rendert HTML)
- `demoCursorTo` / `demoCursorClick` / `demoCursorHide` — geanimeerde muis
- `SAMPLE_DOSSIER` (incl. `Confidence`) · `buildDemoMedia()` — demo-foto's (`demo/*.jpg`)

## Sessie-changelog (2026-06-03)

Van oudste naar nieuwste:
- Mock Outlook-slide vóór het invullen (sleep-vanuit-Outlook), fictieve mail verwijderd
- Invullen start meteen wanneer de .msg in de dropzone landt (drag + fill samengevoegd)
- Scene-tags geco-located per stap (fragiele `DEMO_SCENES`-array verwijderd → uitlijn-bug onmogelijk)
- Confidence-slide: lichtoranje weg → daarna 3-traps progressie (licht → donker → popup)
- Oranje velden blijven staan vóór de "sent"-popup (stap gesplitst)
- Documenten & foto's niet meer dubbel (snelle pass tijdens fill verwijderd)
- Ballon op de documenten-slide ("Renamed automatically")
- ACT 2-subtitel op twee regels, 'routine' + 'one click' gehighlight
- Slide "Trained on the routine" toegevoegd; voorbeeld toegevoegd en weer verwijderd
- Editorial eindslide "That's Charlie."; "no IT in the loop" en "No IT"-kicker verwijderd
- Geanimeerde muis-cursor bij Push to BuildeX en bij de Edit-actie
- Offline standalone gebouwd (`build-standalone.js`) met font + foto's ingebed, als download op de site

Volledige commit-historie: `git log 953cd69..HEAD`.
