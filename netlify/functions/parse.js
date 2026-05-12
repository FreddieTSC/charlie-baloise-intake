const Anthropic = require('@anthropic-ai/sdk');
const MsgReaderModule = require('msgreader');
const pdfParse = require('pdf-parse');

const MsgReader = MsgReaderModule.default || MsgReaderModule;

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
  "Samenvatting": "Korte samenvatting in 2-4 zinnen: wie (schadelijder), wat (type schade), hoe (omstandigheden), wanneer (datum). Inclusief schadentype (bv. waterschade)."
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
- Samenvatting: ALTIJD genereren, ook als informatie beperkt is`;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { files, model } = JSON.parse(event.body);

    if (!files || files.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Geen bestanden ontvangen' }) };
    }

    const extractedTexts = [];

    for (const file of files) {
      const buffer = Buffer.from(file.data, 'base64');
      const ext = file.name.split('.').pop().toLowerCase();
      let text = '';

      if (ext === 'msg') {
        text = extractMsgText(buffer, file.name);
      } else if (ext === 'pdf') {
        text = await extractPdfText(buffer, file.name);
      } else {
        text = buffer.toString('utf-8');
      }

      extractedTexts.push(`=== Bestand: ${file.name} ===\n${text}`);
    }

    const fullText = extractedTexts.join('\n\n');
    const selectedModel = model || 'claude-sonnet-4-6';

    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY niet geconfigureerd op server' }) };
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const startTime = Date.now();

    const response = await anthropic.messages.create({
      model: selectedModel,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Analyseer de volgende documenten en extraheer alle velden voor het DossierRequest. Geef ALLEEN een geldig JSON object terug.\n\n${fullText}`
      }]
    });

    const elapsed = Date.now() - startTime;
    const responseText = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Claude response was geen geldig JSON', raw: responseText })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        data: parsed,
        meta: {
          model: response.model,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          elapsed,
          filesProcessed: files.length
        }
      })
    };

  } catch (err) {
    console.error('Parse error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

function extractMsgText(buffer, filename) {
  try {
    const reader = new MsgReader(buffer);
    const fileData = reader.getFileData();

    const parts = [];
    parts.push(`Bestandsnaam: ${filename}`);
    if (fileData.subject) parts.push(`Onderwerp: ${fileData.subject}`);
    if (fileData.senderName) parts.push(`Afzender: ${fileData.senderName}`);
    if (fileData.senderEmail) parts.push(`Afzender email: ${fileData.senderEmail}`);

    let body = fileData.body || '';
    if (!body && fileData.bodyHTML) {
      body = fileData.bodyHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (body) parts.push(`\nE-mail inhoud:\n${body}`);

    const attachments = fileData.attachments || [];
    if (attachments.length > 0) {
      parts.push(`\nBijlagen: ${attachments.length}`);
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const attName = att.fileName || att.name || `bijlage_${i + 1}`;
        parts.push(`- ${attName}`);
      }
    }

    return parts.join('\n');
  } catch (err) {
    console.error('MSG extraction error:', err);
    return `Bestandsnaam: ${filename}\n[Fout bij MSG extractie: ${err.message}]`;
  }
}

async function extractPdfText(buffer, filename) {
  try {
    const data = await pdfParse(buffer);
    return `Bestandsnaam: ${filename}\n\nPDF inhoud:\n${data.text}`;
  } catch (err) {
    console.error('PDF extraction error:', err);
    return `Bestandsnaam: ${filename}\n[Fout bij PDF extractie: ${err.message}]`;
  }
}
