import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `Je bent een document-parser voor CED schadeverzekeringen. Je analyseert tekst uit Baloise verzekeringsdocumenten (e-mails en PDF-snapshots) en extraheert alle relevante velden voor het aanmaken van een dossier.

Geef je antwoord UITSLUITEND als een geldig JSON object (geen markdown, geen uitleg) met dit schema:

{
  "DossierCode": "string (format: 26-XXXXX, uit bestandsnaam of onderwerp)",
  "DatumOntvangst": "YYYY-MM-DD of null",
  "DatumSchade": "YYYY-MM-DD of null",
  "DatumEersteContact": "YYYY-MM-DD of null",
  "Schadelijder": {
    "Info": {
      "Type": "Schadelijder",
      "Naam": "achternaam",
      "Voornaam": "voornaam",
      "Polis": "polisnummer",
      "Taal": "NLD/FRA/DEU/ENG",
      "Telefoon": "",
      "Email": "",
      "Locatie": { "Straat": "", "Huisnummer": "", "Postcode": "", "Woonplaats": "", "Land": "BE" }
    },
    "Partijen": []
  },
  "LocatieSchade": { "Straat": "", "Huisnummer": "", "Postcode": "", "Woonplaats": "", "Land": "BE" },
  "SchadeTypeH": "Brand|BA Bedrijven|BA Bouw|Woning|Auto|Alle Risico's|Technische Verzekering",
  "SchadeTypeS": "bv. Waterschade, Stormschade, Brandschade...",
  "Schadebedrag": "number of null",
  "Claim": "number of null",
  "Vrijstelling": "number of null",
  "KapitaalGebouw": "number of null",
  "Verhaal": "tekst over verhaalsmogelijkheden",
  "BAVrijeTekst": "omstandigheden van het schadegeval",
  "ExpertiseMethode": "Tegensprekelijk|Eenzijdig|Minnelijk",
  "ExpertiseMethodeProcedure": "",
  "Tarificatie": "Standaard|Klantenvoordeel",
  "RoerendOnroerend": "Onroerend|Roerend|Beide",
  "Derden": [
    {
      "Info": {
        "Type": "Maatschappij|Makelaar|Derde aansprakelijk|Expert tegenpartij|Getuige",
        "Naam": "", "Voornaam": "", "Code": "", "Polis": "", "Referte": "",
        "Correspondent": "", "Email": "", "Telefoon": "",
        "Locatie": { "Straat": "", "Huisnummer": "", "Postcode": "", "Woonplaats": "", "Land": "BE" }
      },
      "Partijen": []
    }
  ],
  "Notas": ["relevante opmerkingen uit het document"],
  "Samenvatting": "Korte samenvatting in 2-4 zinnen: wie (schadelijder), wat (type schade), hoe (omstandigheden), wanneer (datum). Inclusief schadentype (bv. waterschade).",
  "Documenten": [
    {
      "titel": "[dossiernummer]_[document-type]",
      "type": "opdracht|polis|schadeaangifte|factuur|foto's|samenvatting|ingebrekestelling|mail|offerte|verzekeringscontract|aangifte|brief|overzicht|bestek|[specifiek]",
      "paginas": "1-3",
      "bron": "naam van het bronbestand (PDF/MSG)",
      "beschrijving": "korte beschrijving van de inhoud",
      "bedrag": "number of null (alleen voor factuur/offerte)"
    }
  ],
  "FotoPages": [5, 8, 9]
}

Regels:
- Datums altijd in YYYY-MM-DD formaat converteren (van DD/MM/YYYY of DD.MM.YYYY)
- Bedragen als decimale getallen zonder valutasymbolen
- Lege velden als null (getallen) of lege string (tekst)
- Adressen splitsen in componenten: "Kerkstraat 15, 2000 Antwerpen" → Straat: "Kerkstraat", Huisnummer: "15", Postcode: "2000", Woonplaats: "ANTWERPEN"
- Woonplaats altijd in HOOFDLETTERS
- Land standaard "BE" tenzij anders vermeld
- Bij naam splitsen: voornaam en achternaam apart. Bij bedrijfsnamen (BV, BVBA, NV, SA) alles in Naam
- Maatschappij is altijd "BALOISE" met Type "Maatschappij"
- Baloise referentie (B-nummer) gaat in Derden[Maatschappij].Info.Referte
- Makelaar apart herkennen met Type "Makelaar"
- ExpertiseMethode detecteren uit woorden: tegensprekelijk, eenzijdig, minnelijk
- SchadeTypeH classificeren op basis van product/polis type
- SchadeTypeS specificeren: waterschade, stormschade, brandschade, etc.
- Klantenvoordeel detecteren voor Tarificatie
- Notas: relevante losse opmerkingen, polisperiodes, betreft-regels
- Samenvatting: ALTIJD genereren, ook als informatie beperkt is
- Het "Claim Snapshot" PDF bevat de schadeclaim details (bedragen, franchise, partijen)
- Het "Informatie in geval van schade" PDF bevat polis- en dekkingsinfo (kapitaal gebouw, verzekerde bedragen)
- KapitaalGebouw = verzekerd bedrag gebouw/huurdersaansprakelijkheid uit de polisinfo PDF

DOCUMENT STRUCTUUR REGELS:
- Analyseer ELKE PDF en identificeer de subdocumenten erin (opdracht, polis, facturen, foto's, etc.)
- Gebruik het patroon [dossiernummer]_[document-type] voor de titel
- Bij facturen en offertes: ALTIJD het bedrag in de titel zetten, bv. "26-555127_factuur CA Heating 876,80 EUR"
- Bij mails: context toevoegen, bv. "26-555127_mail AG Insurance - info dossier"
- Pagina-bereiken (paginas) moeten ALLE pagina's dekken — geen pagina mag ontbreken of dubbel voorkomen
- Sorteer documenten chronologisch (vroegste datum eerst)
- FotoPages: geef een array van paginanummers (1-based) die foto's/afbeeldingen bevatten
- Foto-pagina's herkennen aan: weinig tekst maar veel afbeeldingsinhoud, onderschriften als "foto", "beeld", "afbeelding"
- Als een PDF pagina's bevat met hoofdzakelijk foto's (bv. schadefoto's, situatiefotos), neem die paginanummers op in FotoPages`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export default async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { text, model } = body;

    if (!text || text.trim().length < 10) {
      return Response.json({ error: 'Geen tekst ontvangen' }, { status: 400, headers: CORS_HEADERS });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'ANTHROPIC_API_KEY niet geconfigureerd' }, { status: 500, headers: CORS_HEADERS });
    }

    const anthropic = new Anthropic({ apiKey });
    const selectedModel = model || 'claude-sonnet-4-6';
    const startTime = Date.now();

    console.log(`[Parse] Streaming ${text.length} chars to ${selectedModel}`);

    // Use STREAMING to prevent Netlify inactivity timeout
    // Each chunk keeps the connection alive
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await anthropic.messages.create({
            model: selectedModel,
            max_tokens: 8192,
            stream: true,
            system: SYSTEM_PROMPT,
            messages: [{
              role: 'user',
              content: `Analyseer de volgende documenten en extraheer alle velden voor het DossierRequest. Geef ALLEEN een geldig JSON object terug.\n\n${text}`
            }]
          });

          let fullText = '';
          let inputTokens = 0;
          let outputTokens = 0;
          let responseModel = selectedModel;

          for await (const event of response) {
            if (event.type === 'message_start' && event.message) {
              responseModel = event.message.model || selectedModel;
              inputTokens = event.message.usage?.input_tokens || 0;
            }
            if (event.type === 'content_block_delta' && event.delta?.text) {
              fullText += event.delta.text;
              // Send progress event to keep connection alive
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', chars: fullText.length })}\n\n`));
            }
            if (event.type === 'message_delta' && event.usage) {
              outputTokens = event.usage.output_tokens || 0;
            }
          }

          const elapsed = Date.now() - startTime;

          // Parse the completed JSON response
          let parsed;
          try {
            const jsonMatch = fullText.match(/\{[\s\S]*\}/);
            parsed = JSON.parse(jsonMatch ? jsonMatch[0] : fullText);
          } catch (parseErr) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              error: 'Claude response was geen geldig JSON',
              raw: fullText.substring(0, 500)
            })}\n\n`));
            controller.close();
            return;
          }

          // Send the final result
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'result',
            data: parsed,
            meta: {
              model: responseModel,
              inputTokens,
              outputTokens,
              elapsed,
              filesProcessed: 1
            }
          })}\n\n`));

          console.log(`[Parse] Done: ${inputTokens} in / ${outputTokens} out, ${elapsed}ms`);

        } catch (err) {
          console.error('Stream error:', err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: err.message
          })}\n\n`));
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (err) {
    console.error('Parse error:', err);
    return Response.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
};
