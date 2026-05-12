const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const MsgReader = require('msgreader');
const pdfParse = require('pdf-parse');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0' });
});

app.post('/api/parse', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files;
    const model = req.body.model || 'claude-sonnet-4-6';

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Geen bestanden ontvangen' });
    }

    const extractedTexts = [];

    for (const file of files) {
      const ext = file.originalname.split('.').pop().toLowerCase();
      let text = '';

      if (ext === 'msg') {
        text = extractMsgText(file.buffer, file.originalname);
      } else if (ext === 'pdf') {
        text = await extractPdfText(file.buffer, file.originalname);
      } else {
        text = file.buffer.toString('utf-8');
      }

      extractedTexts.push(`=== Bestand: ${file.originalname} ===\n${text}`);
    }

    const fullText = extractedTexts.join('\n\n');
    console.log(`[${model}] Parsing ${files.length} file(s), ${fullText.length} chars`);

    const anthropic = new Anthropic();
    const startTime = Date.now();

    const response = await anthropic.messages.create({
      model,
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
      console.error('JSON parse error:', parseErr.message);
      console.error('Raw response:', responseText.substring(0, 500));
      return res.status(500).json({ error: 'Claude response was geen geldig JSON', raw: responseText });
    }

    res.json({
      data: parsed,
      meta: {
        model: response.model,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        elapsed,
        filesProcessed: files.length
      }
    });

  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ error: err.message });
  }
});

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

        if (attName.toLowerCase().endsWith('.pdf')) {
          try {
            const attData = reader.getAttachment(i);
            if (attData && attData.content) {
              const pdfBuf = Buffer.from(attData.content);
              parts.push(`[PDF bijlage wordt apart verwerkt]`);
            }
          } catch (e) {
            console.warn(`Could not extract attachment ${attName}:`, e.message);
          }
        }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Charlie API running on port ${PORT}`);
  console.log(`Model support: claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-7`);
});
