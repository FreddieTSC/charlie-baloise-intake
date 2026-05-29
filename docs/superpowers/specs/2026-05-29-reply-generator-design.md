# Automatische Reply Generator — Design

**Datum:** 2026-05-29
**App:** Charlie Dossier Intake

## Doel

Charlie krijgt een tweede modus naast "Dossier aanmaken": een **Automatische Reply Generator**.
De beheerder sleept een inkomende vraag-mail (MSG) in de app. Charlie classificeert de mail
tegen de meest voorkomende maaltypes en toont automatisch het bijbehorende standaard-antwoord,
klaar om te kopiëren en door te sturen naar de maatschappij.

Start met twee maaltypes:
1. **Vraag over vrijstelling**
2. **Vraag over verslag**

## Entry point — keuzescherm na splash

Na de Charlie-splash verschijnt een keuzescherm met twee kaarten:
- **Dossier aanmaken** → huidige app (header + intake zone + formulier)
- **Reply Generator** → nieuwe view

Een "← terug" element laat de beheerder wisselen tussen beide modi.

## Reply Generator view

Centrale drop-zone ("Sleep de vraag-mail hier"). Bij het slepen van een MSG:
1. MSG-tekst lokaal extraheren (hergebruik bestaande `extractMsgClientSide`)
2. Tekst naar nieuwe lichte LLM-call sturen die classificeert: `vrijstelling`, `verslag`, of `geen_match`
3. Resultaat tonen

## Classificatie (LLM)

Nieuwe Netlify-functie `reply-classify.mjs` met een korte, goedkope prompt (gpt-4o-mini).
Input: mailtekst + lijst bekende types. Output: best passend type + confidence.
Bij lage confidence of geen match → "geen automatisch antwoord beschikbaar".

```json
{ "type": "vrijstelling|verslag|geen_match", "confidence": "high|medium|low", "reden": "korte uitleg" }
```

## Antwoord tonen

- **Match** → paneel/popup met de bijbehorende statische template-tekst, duidelijk leesbaar,
  met een "Kopiëren" knop.
- **Geen match** → nette melding dat dit maaltype (nog) niet ondersteund wordt, met de
  mailtekst zichtbaar zodat de beheerder zelf kan beslissen.

## Templates (statisch, client-side)

Opgeslagen als uitbreidbaar object `REPLY_TEMPLATES`. Beide templates zijn volledig statisch
(geen dynamische velden).

### vrijstelling
```
Beste,

We laten u graag weten dat we alle documenten aan de verzekeringsmaatschappij hebben bezorgd.
Ons dossier werd hiermee afgesloten.

Voor verdere opvolging of een update neemt u best even contact op met uw maatschappij.

We hopen u hiermee voldoende te hebben geïnformeerd.

Met vriendelijke groeten,
```

### verslag
```
Beste,

Naar afspraken met de verzekeringsmaatschappij, mogen wij de verslagen helaas niet
rechtstreeks aan u bezorgen.

Voor een kopie van het verslag neemt u best even contact op met uw maatschappij.

Met vriendelijke groeten,
```

## Uitbreidbaarheid

Een nieuw maaltype toevoegen = (1) nieuw type + template in `REPLY_TEMPLATES`, en
(2) één regel toevoegen aan de classify-prompt. Geen structurele wijzigingen nodig.

## Buiten scope (YAGNI)

- Geen directe verzending van mails (beheerder kopieert en stuurt zelf)
- Geen dynamische veld-invulling in templates
- Geen opslag/historiek van gegenereerde antwoorden
