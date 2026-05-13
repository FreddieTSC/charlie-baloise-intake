const CLASSIFY_PROMPT = `You are an image classifier. Classify each image into exactly one category.

## Categories

**DOCUMENT** — Only if the image is a photo/scan of a structured business document:
- Invoice (factuur)
- Quote/Estimate (offerte/bestek)

These have clear characteristics: company letterhead, line items with prices, totals, VAT numbers, document numbers, payment terms, structured tables with amounts.

**PHOTO** — Everything else, including:
- Photos of damage, objects, rooms, buildings, people, scenes
- Photos that happen to contain some text (street signs, labels, handwritten notes, annotations, watermarks, overlaid text)
- Screenshots of apps, chats, or websites
- Photos with captions, timestamps, or metadata overlays

## Critical rule

The presence of text does NOT make something a document. A photo of a damaged wall with a handwritten note "kitchen ceiling" is a PHOTO. A photo of a car with a license plate is a PHOTO. Only structured financial/commercial documents (invoices, quotes) qualify as DOCUMENT.

## Ask yourself

1. If I printed this on paper, would it look like a business document you'd file in accounting? → DOCUMENT
2. Is it a photograph of the real world that happens to contain some text? → PHOTO

You will receive multiple images. For EACH image, respond with its classification.
Respond ONLY with a valid JSON array of objects: [{"page": 1, "category": "PHOTO"}, {"page": 2, "category": "DOCUMENT"}]
No other text.`;

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
    const { images } = body; // Array of { page: number, dataUrl: string }

    if (!images || images.length === 0) {
      return Response.json({ error: 'Geen afbeeldingen ontvangen' }, { status: 400, headers: CORS_HEADERS });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'OPENROUTER_API_KEY niet geconfigureerd' }, { status: 500, headers: CORS_HEADERS });
    }

    console.log(`[Classify] Classifying ${images.length} images`);

    // Build vision message content: text prompt + all images
    const content = [
      { type: 'text', text: `Classify these ${images.length} images. Pages: ${images.map(i => i.page).join(', ')}` }
    ];

    for (const img of images) {
      content.push({
        type: 'image_url',
        image_url: {
          url: img.dataUrl,
          detail: 'low' // Low detail is faster and cheaper, sufficient for classification
        }
      });
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://charlie-ced.netlify.app',
        'X-Title': 'Charlie Image Classifier'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: CLASSIFY_PROMPT },
          { role: 'user', content }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Classify] OpenRouter error ${response.status}:`, errText);
      return Response.json({ error: `API fout (${response.status})` }, { status: 500, headers: CORS_HEADERS });
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content || '';

    console.log(`[Classify] Raw response: ${text}`);

    // Parse the JSON array from response
    let classifications;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      classifications = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (e) {
      console.error('[Classify] Failed to parse response, defaulting all to PHOTO');
      classifications = images.map(img => ({ page: img.page, category: 'PHOTO' }));
    }

    // Ensure every page has a classification
    const classMap = {};
    for (const c of classifications) {
      classMap[c.page] = c.category;
    }
    const finalClassifications = images.map(img => ({
      page: img.page,
      category: classMap[img.page] || 'PHOTO'
    }));

    console.log(`[Classify] Results: ${JSON.stringify(finalClassifications)}`);

    return Response.json({
      classifications: finalClassifications,
      model: result.model || 'gpt-4o-mini',
      usage: result.usage || {}
    }, { headers: CORS_HEADERS });

  } catch (err) {
    console.error('Classify error:', err);
    return Response.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
};
