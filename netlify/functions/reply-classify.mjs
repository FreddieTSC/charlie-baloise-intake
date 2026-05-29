const CLASSIFY_PROMPT = `Je bent een e-mail classifier voor CED schadeverzekeringen. Je krijgt de tekst van een inkomende e-mail van een klant, makelaar of verzekeringsmaatschappij. Bepaal of de e-mail overeenkomt met één van de bekende veelvoorkomende vraagtypes, zodat er automatisch een standaard-antwoord kan worden voorgesteld.

BEKENDE TYPES:

1. "vrijstelling" — De afzender vraagt naar de stand van zaken / opvolging van het dossier, vraagt of alle documenten zijn doorgestuurd, vraagt naar de vrijstelling/franchise, of vraagt om een update over de afhandeling van het dossier.

2. "verslag" — De afzender vraagt om het expertiseverslag, het schadeverslag, een kopie van het verslag, of wil het verslag rechtstreeks ontvangen.

3. "geen_match" — De e-mail past bij geen van bovenstaande types (bv. een nieuwe opdracht, een factuur, een algemene vraag, iets anders).

Geef je antwoord UITSLUITEND als geldig JSON (geen markdown, geen uitleg):

{
  "type": "vrijstelling|verslag|geen_match",
  "confidence": "high|medium|low",
  "reden": "korte uitleg in 1 zin waarom dit type"
}

REGELS:
- "high" = de vraag is duidelijk en expliciet één van de types
- "medium" = waarschijnlijk dit type maar niet 100% zeker
- "low" = vermoeden, of de mail is vaag
- Bij twijfel tussen een type en geen_match: kies geen_match met confidence "low"
- Negeer handtekeningen, disclaimers en automatische voetteksten`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { text } = body;

    if (!text || text.trim().length < 5) {
      return Response.json({ error: 'Geen tekst ontvangen' }, { status: 400, headers: CORS_HEADERS });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'OPENROUTER_API_KEY niet geconfigureerd' }, { status: 500, headers: CORS_HEADERS });
    }

    console.log(`[ReplyClassify] Classifying ${text.length} chars`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://charlie-ced.netlify.app',
        'X-Title': 'Charlie Reply Classifier'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        max_tokens: 256,
        messages: [
          { role: 'system', content: CLASSIFY_PROMPT },
          { role: 'user', content: `Classificeer de volgende e-mail:\n\n${text.substring(0, 8000)}` }
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
    console.log(`[ReplyClassify] Raw response: ${raw}`);

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      console.error('[ReplyClassify] Parse failed, defaulting to geen_match');
      parsed = { type: 'geen_match', confidence: 'low', reden: 'Kon classificatie niet bepalen' };
    }

    const validTypes = ['vrijstelling', 'verslag', 'geen_match'];
    if (!validTypes.includes(parsed.type)) parsed.type = 'geen_match';
    if (!['high', 'medium', 'low'].includes(parsed.confidence)) parsed.confidence = 'low';

    console.log(`[ReplyClassify] Result: ${parsed.type} (${parsed.confidence})`);

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
