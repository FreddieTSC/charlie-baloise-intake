const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Default base templates (fallback if client sends none)
const DEFAULT_TEMPLATES = {
  vrijstelling: {
    label: 'Vraag over vrijstelling / opvolging',
    description: 'De afzender vraagt naar de stand van zaken / opvolging van het dossier, of alle documenten zijn doorgestuurd, naar de vrijstelling/franchise, of een update over de afhandeling.',
    text: `Beste,\n\nWe laten u graag weten dat we alle documenten aan de verzekeringsmaatschappij hebben bezorgd.\nOns dossier werd hiermee afgesloten.\n\nVoor verdere opvolging of een update neemt u best even contact op met uw maatschappij.\n\nWe hopen u hiermee voldoende te hebben geïnformeerd.\n\nMet vriendelijke groeten,`
  },
  verslag: {
    label: 'Vraag over verslag',
    description: 'De afzender vraagt om het expertiseverslag, schadeverslag, een kopie van het verslag, of wil het verslag rechtstreeks ontvangen.',
    text: `Beste,\n\nNaar afspraken met de verzekeringsmaatschappij, mogen wij de verslagen helaas niet rechtstreeks aan u bezorgen.\n\nVoor een kopie van het verslag neemt u best even contact op met uw maatschappij.\n\nMet vriendelijke groeten,`
  }
};

function buildSystemPrompt(templates, corrections) {
  const typeKeys = Object.keys(templates);

  let typeSection = '';
  for (const key of typeKeys) {
    const t = templates[key];
    typeSection += `\n### type: "${key}" — ${t.label || key}\n`;
    if (t.description) typeSection += `Herken aan: ${t.description}\n`;
    typeSection += `BASIS-TEMPLATE (vertrekpunt voor het antwoord):\n"""\n${t.text || ''}\n"""\n`;
  }

  let correctionSection = '';
  if (Array.isArray(corrections) && corrections.length > 0) {
    correctionSection = `\n\nGELEERDE CORRECTIES VAN DE DOSSIERBEHEERDER (gebruik deze om je classificatie én antwoord te verbeteren; recentste eerst):\n`;
    corrections.slice(0, 12).forEach((c, i) => {
      correctionSection += `\n--- Correctie ${i + 1} ---\n`;
      if (c.mailExcerpt) correctionSection += `Inkomende mail (fragment): ${String(c.mailExcerpt).substring(0, 400)}\n`;
      if (c.detectedType && c.correctedType && c.detectedType !== c.correctedType) {
        correctionSection += `HERKENNING: door Charlie geclassificeerd als "${c.detectedType}", maar moest "${c.correctedType}" zijn.\n`;
      } else if (c.correctedType) {
        correctionSection += `Type: "${c.correctedType}".\n`;
      }
      if (c.generatedReply && c.finalReply && c.generatedReply.trim() !== c.finalReply.trim()) {
        correctionSection += `ANTWOORD — Charlie genereerde:\n"""\n${String(c.generatedReply).substring(0, 800)}\n"""\nDe beheerder verbeterde dit naar:\n"""\n${String(c.finalReply).substring(0, 800)}\n"""\n`;
      }
      if (c.comment) correctionSection += `Opmerking beheerder: ${c.comment}\n`;
    });
    correctionSection += `\nPas deze lessen consequent toe: classificeer zoals gecorrigeerd in vergelijkbare gevallen, en neem de stijl/inhoudswijzigingen van de beheerder over in je antwoord.`;
  }

  return `Je bent een e-mail antwoord-assistent voor CED schadeverzekeringen. Je krijgt de tekst van een inkomende e-mail (van een klant, makelaar of maatschappij). Je doet twee dingen:

1. CLASSIFICEER de mail in exact één bekend type, of "geen_match".
2. GENEREER een Nederlands antwoord op basis van de BASIS-TEMPLATE van dat type, bijgeschaafd volgens de geleerde correcties.

BEKENDE TYPES:${typeSection}
- type: "geen_match" — de mail past bij geen van bovenstaande types (bv. een nieuwe opdracht, factuur, of andere vraag). Geef dan een leeg antwoord.
${correctionSection}

Geef je antwoord UITSLUITEND als geldig JSON (geen markdown, geen uitleg):

{
  "type": "${typeKeys.join('|')}|geen_match",
  "confidence": "high|medium|low",
  "reden": "korte uitleg in 1 zin waarom dit type",
  "antwoord": "het volledige antwoord in het Nederlands, of lege string bij geen_match"
}

REGELS:
- "high" = de vraag is duidelijk en expliciet één van de types
- "medium" = waarschijnlijk dit type maar niet 100% zeker
- "low" = vermoeden, of de mail is vaag
- Bij twijfel tussen een type en geen_match: kies geen_match met confidence "low" en leeg antwoord
- Het antwoord blijft dicht bij de basis-template; wijk enkel af waar de geleerde correcties dat aangeven
- Negeer handtekeningen, disclaimers en automatische voetteksten in de inkomende mail`;
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { text, templates, corrections } = body;

    if (!text || text.trim().length < 5) {
      return Response.json({ error: 'Geen tekst ontvangen' }, { status: 400, headers: CORS_HEADERS });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'OPENROUTER_API_KEY niet geconfigureerd' }, { status: 500, headers: CORS_HEADERS });
    }

    const tpl = (templates && Object.keys(templates).length > 0) ? templates : DEFAULT_TEMPLATES;
    const corr = Array.isArray(corrections) ? corrections : [];
    const systemPrompt = buildSystemPrompt(tpl, corr);

    console.log(`[ReplyClassify] ${text.length} chars, ${corr.length} learned corrections`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://charlie-ced.netlify.app',
        'X-Title': 'Charlie Reply Generator'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        max_tokens: 800,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Classificeer en beantwoord de volgende e-mail:\n\n${text.substring(0, 8000)}` }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[ReplyClassify] OpenRouter error ${response.status}:`, errText);
      return Response.json({ error: `API fout (${response.status})` }, { status: 500, headers: CORS_HEADERS });
    }

    const result = await response.json();
    const raw = result.choices?.[0]?.message?.content || '';
    console.log(`[ReplyClassify] Raw response: ${raw.substring(0, 200)}`);

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      console.error('[ReplyClassify] Parse failed, defaulting to geen_match');
      parsed = { type: 'geen_match', confidence: 'low', reden: 'Kon classificatie niet bepalen', antwoord: '' };
    }

    const validTypes = [...Object.keys(tpl), 'geen_match'];
    if (!validTypes.includes(parsed.type)) parsed.type = 'geen_match';
    if (!['high', 'medium', 'low'].includes(parsed.confidence)) parsed.confidence = 'low';
    if (typeof parsed.antwoord !== 'string') parsed.antwoord = '';
    // Safety: geen_match should not carry an answer
    if (parsed.type === 'geen_match') parsed.antwoord = '';

    console.log(`[ReplyClassify] Result: ${parsed.type} (${parsed.confidence}), antwoord ${parsed.antwoord.length} chars`);

    return Response.json({
      ...parsed,
      model: result.model || 'gpt-4o-mini',
      usage: result.usage || {}
    }, { headers: CORS_HEADERS });

  } catch (err) {
    console.error('ReplyClassify error:', err);
    return Response.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
};
