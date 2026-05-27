const CLASSIFY_PROMPT = `You are an image classifier for an insurance claims (schade-expertise) application. Classify each image into exactly one category.

## Categories

**DOCUMENT** — Any page that is primarily text, forms, tables, or structured information:
- Invoices (factuur), quotes/estimates (offerte/bestek)
- Expert reports, intervention reports (verslag, interventie)
- Technical reports, inspection forms, checklists
- Letters, correspondence, official forms
- Insurance documents, policy pages, claim forms
- Any page with structured text layout: headers, paragraphs, tables, form fields
- Scanned or printed pages that contain mostly text and/or tables

Key indicators: company letterhead, structured text paragraphs, form fields, checkboxes, tables, section headers, page numbers, typed or printed text as the dominant content.

**PHOTO** — Actual photographs of the physical world:
- Photos of damage (water damage, cracks, mold, broken items)
- Photos of rooms, buildings, exteriors, interiors
- Photos of objects, materials, equipment
- Photos of people or scenes
- Close-up photos showing physical conditions

Key indicators: perspective/depth, real-world objects, textures, lighting/shadows, camera angle visible. The image captures a physical scene, not a printed/digital page.

## Critical rule

Ask yourself: "Is this a photo taken WITH a camera of a real-world scene, or is it a PAGE (printed, scanned, or digital) containing text and structured information?"

- Page with text, tables, forms, checkboxes → DOCUMENT
- Photo of a room, wall, ceiling, pipe, damage → PHOTO
- A photo of a damaged wall with some handwritten notes → PHOTO (it's a real-world scene)
- A scanned form with checkboxes and typed text → DOCUMENT (it's a page)

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
