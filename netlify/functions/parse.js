const Anthropic = require('@anthropic-ai/sdk');
const MsgReaderModule = require('msgreader');
const CFB = require('cfb');
const AdmZip = require('adm-zip');
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
- Samenvatting: ALTIJD genereren, ook als informatie beperkt is
- Het "Claim Snapshot" PDF bevat de schadeclaim details (bedragen, franchise, partijen)
- Het "Informatie in geval van schade" PDF bevat polis- en dekkingsinfo (kapitaal gebouw, verzekerde bedragen)
- KapitaalGebouw = verzekerd bedrag gebouw/huurdersaansprakelijkheid uit de polisinfo PDF`;

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
        text = await extractMsgDeep(buffer, file.name);
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

// ============================================================
// DEEP MSG EXTRACTION
// Extracts ALL content from Baloise MSG files:
// 1. Top-level email body + metadata
// 2. Nested/forwarded email bodies (via CFB deep parsing)
// 3. ZIP attachments → extracts PDFs inside
// 4. Direct PDF attachments
// ============================================================

async function extractMsgDeep(buffer, filename) {
  const parts = [];

  try {
    // Step 1: Basic metadata via msgreader
    const reader = new MsgReader(buffer);
    const fileData = reader.getFileData();

    parts.push(`Bestandsnaam: ${filename}`);
    if (fileData.subject) parts.push(`Onderwerp: ${fileData.subject}`);
    if (fileData.senderName) parts.push(`Afzender: ${fileData.senderName}`);
    if (fileData.senderEmail) parts.push(`Afzender email: ${fileData.senderEmail}`);
    if (fileData.recipients && fileData.recipients.length > 0) {
      parts.push(`Ontvanger: ${fileData.recipients.map(r => r.name + ' <' + r.email + '>').join(', ')}`);
    }

    // Step 2: Deep extraction via CFB
    const cfb = CFB.read(buffer);
    const entries = cfb.FileIndex;
    const paths = cfb.FullPaths;

    // Step 2a: Extract ALL email bodies from all nesting levels
    const bodies = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].name === '__substg1.0_1000001F' && entries[i].size > 100) {
        const entry = CFB.find(cfb, paths[i]);
        if (entry && entry.content) {
          const text = Buffer.from(entry.content).toString('utf16le').trim();
          // Skip signature-only bodies and very short texts
          const isSignatureOnly = text.length < 300 && /Met vriendelijke groeten|Cordialement/i.test(text);
          if (!isSignatureOnly && text.length > 30) {
            bodies.push({ text, path: paths[i], size: entries[i].size });
          }
        }
      }
    }

    // Sort by size descending - largest body first (most content)
    bodies.sort((a, b) => b.size - a.size);

    // Deduplicate similar bodies
    const uniqueBodies = [];
    for (const b of bodies) {
      const isDuplicate = uniqueBodies.some(ub => {
        const overlap = b.text.substring(0, 200);
        return ub.text.includes(overlap) || overlap.includes(ub.text.substring(0, 200));
      });
      if (!isDuplicate) uniqueBodies.push(b);
    }

    if (uniqueBodies.length > 0) {
      parts.push(`\n${'='.repeat(60)}`);
      parts.push(`E-MAIL INHOUD (${uniqueBodies.length} berichten gevonden)`);
      parts.push('='.repeat(60));
      uniqueBodies.forEach((b, i) => {
        parts.push(`\n--- E-mail bericht ${i + 1} (${b.size} bytes) ---`);
        parts.push(b.text);
      });
    }

    // Step 2b: Find and extract all attachment binaries
    // Map attachment directories to find ZIPs and PDFs
    const attachDirs = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].name && entries[i].name.startsWith('__attach_version1.0_')) {
        attachDirs.push({ index: i, path: paths[i] });
      }
    }

    const embeddedDocs = [];
    const seenAttachments = new Set(); // Deduplicate by filename+size

    for (const dir of attachDirs) {
      let attFilename = '';
      let mimeType = '';
      let dataBuf = null;

      for (let i = 0; i < entries.length; i++) {
        if (!paths[i].startsWith(dir.path) || paths[i] === dir.path) continue;
        // Only look at direct children, not deeper nested
        const relPath = paths[i].substring(dir.path.length);
        if (relPath.includes('/') && !relPath.endsWith('/')) continue;

        const name = entries[i].name;
        // Long filename (Unicode)
        if (name === '__substg1.0_3707001F') {
          const entry = CFB.find(cfb, paths[i]);
          if (entry && entry.content) attFilename = Buffer.from(entry.content).toString('utf16le').trim();
        }
        // Short filename fallback
        if (!attFilename && name === '__substg1.0_3704001F') {
          const entry = CFB.find(cfb, paths[i]);
          if (entry && entry.content) attFilename = Buffer.from(entry.content).toString('utf16le').trim();
        }
        // MIME type
        if (name === '__substg1.0_370E001F') {
          const entry = CFB.find(cfb, paths[i]);
          if (entry && entry.content) mimeType = Buffer.from(entry.content).toString('utf16le').trim();
        }
        // Binary data
        if (name === '__substg1.0_37010102' && entries[i].size > 100) {
          const entry = CFB.find(cfb, paths[i]);
          if (entry && entry.content) dataBuf = Buffer.from(entry.content);
        }
      }

      if (dataBuf && attFilename) {
        const ext = attFilename.split('.').pop().toLowerCase();
        const dedupeKey = `${attFilename}:${dataBuf.length}`;

        if (!seenAttachments.has(dedupeKey)) {
          seenAttachments.add(dedupeKey);

          if (ext === 'zip') {
            embeddedDocs.push({ type: 'zip', name: attFilename, data: dataBuf });
          } else if (ext === 'pdf') {
            embeddedDocs.push({ type: 'pdf', name: attFilename, data: dataBuf });
          }
        }
        // Skip images (png, jpg) - not useful for text extraction
      }
    }

    // Step 3: Process embedded documents
    const pdfTexts = [];

    for (const doc of embeddedDocs) {
      if (doc.type === 'zip') {
        // Extract PDFs from ZIP
        try {
          const zip = new AdmZip(doc.data);
          const zipEntries = zip.getEntries();
          for (const ze of zipEntries) {
            if (ze.entryName.toLowerCase().endsWith('.pdf') && !ze.isDirectory) {
              try {
                const pdfBuf = ze.getData();
                const pdfData = await pdfParse(pdfBuf);
                if (pdfData.text && pdfData.text.trim().length > 20) {
                  pdfTexts.push({
                    name: ze.entryName,
                    text: pdfData.text,
                    source: `ZIP: ${doc.name}`
                  });
                }
              } catch (pdfErr) {
                console.error('PDF parse error in ZIP:', ze.entryName, pdfErr.message);
              }
            }
          }
        } catch (zipErr) {
          console.error('ZIP extraction error:', doc.name, zipErr.message);
        }
      } else if (doc.type === 'pdf') {
        try {
          const pdfData = await pdfParse(doc.data);
          if (pdfData.text && pdfData.text.trim().length > 20) {
            pdfTexts.push({
              name: doc.name,
              text: pdfData.text,
              source: 'bijlage'
            });
          }
        } catch (pdfErr) {
          console.error('PDF parse error:', doc.name, pdfErr.message);
        }
      }
    }

    // Add PDF content to output
    if (pdfTexts.length > 0) {
      parts.push(`\n${'='.repeat(60)}`);
      parts.push(`PDF DOCUMENTEN (${pdfTexts.length} gevonden)`);
      parts.push('='.repeat(60));
      pdfTexts.forEach((pdf, i) => {
        parts.push(`\n--- PDF ${i + 1}: ${pdf.name} (bron: ${pdf.source}) ---`);
        parts.push(pdf.text);
      });
    }

    // Step 4: List all attachments for reference
    const attachments = fileData.attachments || [];
    if (attachments.length > 0) {
      parts.push(`\nBijlagen overzicht: ${attachments.length}`);
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const attName = att.fileName || att.name || `bijlage_${i + 1}`;
        const isInner = att.innerMsgContent ? ' [geneste e-mail]' : '';
        parts.push(`- ${attName}${isInner}`);
      }
    }

  } catch (err) {
    console.error('Deep MSG extraction error:', err);
    parts.push(`[Fout bij MSG extractie: ${err.message}]`);
  }

  return parts.join('\n');
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
