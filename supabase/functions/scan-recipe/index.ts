/**
 * scan-recipe — turns a photo of a recipe into the composer's structured fields.
 *
 * Runs server-side so the model API key never reaches the client. The caller
 * must present a valid Supabase session; anonymous callers are rejected.
 *
 * On §18.2: this exists to save a creator typing out a recipe they already
 * wrote — a handwritten card, a notebook page, their own printout. It does not
 * relieve anyone of the rights confirmation at publish, and it deliberately
 * never fills in `attribution` or pre-confirms rights on the creator's behalf.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@^0.70';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const MODEL = 'claude-opus-5';

// Mirrors the measurement_unit enum. Anything outside this set is dropped.
const UNITS = [
  'tsp', 'tbsp', 'fl_oz', 'cup', 'pint', 'quart', 'gallon', 'ml', 'l',
  'oz', 'lb', 'g', 'kg',
  'piece', 'clove', 'slice', 'bunch', 'can', 'package', 'sprig', 'head', 'stalk',
  'pinch', 'dash', 'to_taste', 'handful',
];

// The full set the Supabase SDK may attach — it has grown over releases, and a
// single header the browser asks for that is not named here makes the preflight
// fail, so the POST is never sent and nothing reaches this function at all.
const ALLOWED_HEADERS = [
  'authorization', 'x-client-info', 'apikey', 'content-type',
  'x-retry-count', 'x-region', 'traceparent', 'tracestate', 'baggage',
].join(', ');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

/**
 * Answers the preflight by echoing back exactly what the browser asked for.
 * A static list goes stale the moment a client adds a header; reflecting cannot.
 * Safe here because the endpoint carries no cookies and still requires a valid
 * JWT — allowing a header to be *sent* grants nothing on its own.
 */
function preflight(req: Request): Response {
  const asked = req.headers.get('Access-Control-Request-Headers');
  return new Response('ok', {
    headers: {
      ...cors,
      'Access-Control-Allow-Headers': asked || ALLOWED_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
}

function recipeSchema(categories: string[], tags: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'ingredients', 'steps'],
    properties: {
      title: { type: 'string', description: 'The dish name, as written.' },
      description: {
        type: 'string',
        description:
          'A one or two sentence headnote, only if the source has one. Do not invent one.',
      },
      category: { type: 'string', enum: categories },
      cuisine: { type: 'string', description: 'e.g. Italian, Thai. Omit if unclear.' },
      prepMinutes: { type: 'integer', minimum: 0, maximum: 6000 },
      cookMinutes: { type: 'integer', minimum: 0, maximum: 6000 },
      servings: { type: 'integer', minimum: 1, maximum: 100 },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      ingredients: {
        type: 'array',
        description: 'One entry per ingredient line, in the order written.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ingredient'],
          properties: {
            // Quantities stay exact fractions so 1/3 cup survives scaling.
            numerator: { type: 'integer', minimum: 0 },
            denominator: { type: 'integer', minimum: 1 },
            unit: { type: 'string', enum: UNITS },
            ingredient: { type: 'string' },
            note: { type: 'string', description: 'e.g. "finely chopped", "skin on".' },
          },
        },
      },
      steps: {
        type: 'array',
        description: 'One entry per instruction step, in order.',
        items: { type: 'string' },
      },
      tags: { type: 'array', items: { type: 'string', enum: tags } },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'How legible the source was. Low means the creator should check every field.',
      },
      notes: {
        type: 'string',
        description: 'Anything unreadable or ambiguous the creator should check.',
      },
    },
  };
}

const SYSTEM = `You transcribe a photograph of a recipe into structured fields for a
recipe app's composer.

Transcribe only. Do not improve, rewrite, modernise, or add anything that is not
in the image. If the image does not show a recipe, say so via the tool with an
empty ingredients and steps array and confidence "low".

Rules:
- Quantities are exact fractions: "1 1/2" is numerator 3, denominator 2; "1/3" is
  numerator 1, denominator 3; "2" is numerator 2, denominator 1.
- Use only units from the provided enum. If a unit is not in it (for example
  "knob" or "splash"), leave the unit out and keep the wording in the note.
- Separate preparation from the ingredient: "2 cloves garlic, crushed" becomes
  ingredient "garlic", unit "clove", numerator 2, note "crushed".
- Keep step text as written, one step per entry. Do not merge or split steps.
- Omit any field the image does not show. Never guess times, servings or
  difficulty; leaving them out is correct and expected.
- Set confidence honestly. Handwriting you had to interpret is medium at best.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Logged on entry: if a scan is failing before this line, the request never
  // arrived, which points at the network rather than anything below.
  console.log(`scan-recipe: POST received, ${req.headers.get('content-length') ?? '?'} bytes`);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json({
      error: 'not_configured',
      message:
        'Recipe scanning is not set up yet. An ANTHROPIC_API_KEY secret needs to be added to this project.',
    }, 503);
  }

  // The caller must be a signed-in user; this endpoint costs money to run.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: 'unauthorized' }, 401);

  let payload: { imageUrl?: string; imageBase64?: string; mimeType?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!payload.imageUrl && !payload.imageBase64) {
    return json({ error: 'missing_image' }, 400);
  }
  // Logged because a scan that never arrives is otherwise invisible: an
  // oversized image is the first thing to check when one hangs.
  const started = Date.now();
  const imageKb = Math.round((payload.imageBase64?.length ?? 0) * 0.75 / 1024);

  // Categories and tags are backend-configured (§6), so the allowed values come
  // from the database rather than being frozen into this function.
  const [{ data: cats }, { data: tagRows }] = await Promise.all([
    supabase.from('categories').select('slug').eq('is_enabled', true),
    supabase.from('tags').select('slug').in('type', ['dietary', 'equipment', 'occasion']),
  ]);
  const categories = (cats ?? []).map((c: { slug: string }) => c.slug)
    .filter((s: string) => !['for_you', 'following'].includes(s));
  const tags = (tagRows ?? []).map((t: { slug: string }) => t.slug);

  const image = payload.imageBase64
    ? {
        type: 'base64' as const,
        media_type: (payload.mimeType ?? 'image/jpeg') as 'image/jpeg',
        data: payload.imageBase64,
      }
    : { type: 'url' as const, url: payload.imageUrl! };

  const anthropic = new Anthropic({ apiKey });

  try {
    // Streamed so a longer recipe cannot trip the request timeout, then
    // collected — nothing here is shown to the creator until it is complete.
    const response = await anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      // Transcription is mechanical: reading the page is the whole task, so
      // reasoning about it first only adds latency. Opus 5 thinks by default,
      // hence turning it off explicitly.
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: SYSTEM,
      tools: [{
        name: 'record_recipe',
        description: 'Records the recipe transcribed from the image.',
        input_schema: recipeSchema(categories, tags),
        // Guarantees the arguments validate against the schema exactly.
        strict: true,
      }],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: image },
          {
            type: 'text',
            text: 'Transcribe this recipe and record it by calling record_recipe.',
          },
        ],
      }],
    }).finalMessage();

    if (response.stop_reason === 'refusal') {
      return json({ error: 'refused', message: 'That image could not be processed.' }, 422);
    }

    const call = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'record_recipe',
    );
    if (!call) {
      return json({
        error: 'no_recipe_found',
        message: 'No recipe could be read from that photo. Try a clearer, straight-on shot.',
      }, 422);
    }

    console.log(`scan-recipe ok: ${imageKb}kb image, ${Date.now() - started}ms, ` +
      `${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
    return json({ recipe: normalise(call.input as Record<string, unknown>) });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error(`scan-recipe failed after ${Date.now() - started}ms ` +
      `on a ${imageKb}kb image:`, message);
    return json({ error: 'scan_failed', message }, 502);
  }
});

/** Reshapes the model's output into exactly what save_draft expects. */
function normalise(input: Record<string, unknown>) {
  const ingredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  const steps = Array.isArray(input.steps) ? input.steps : [];

  return {
    title: typeof input.title === 'string' ? input.title.slice(0, 100) : '',
    description: typeof input.description === 'string' ? input.description.slice(0, 1000) : '',
    category: typeof input.category === 'string' ? input.category : '',
    cuisine: typeof input.cuisine === 'string' ? input.cuisine : '',
    prepMinutes: Number.isInteger(input.prepMinutes) ? input.prepMinutes : null,
    cookMinutes: Number.isInteger(input.cookMinutes) ? input.cookMinutes : null,
    servings: Number.isInteger(input.servings) ? input.servings : null,
    difficulty: typeof input.difficulty === 'string' ? input.difficulty : '',
    ingredients: ingredients.map((raw) => {
      const r = raw as Record<string, unknown>;
      const numerator = Number.isInteger(r.numerator) ? (r.numerator as number) : null;
      const denominator = Number.isInteger(r.denominator) && (r.denominator as number) > 0
        ? (r.denominator as number)
        : 1;
      return {
        quantity: numerator === null ? null : { numerator, denominator },
        unit: typeof r.unit === 'string' && UNITS.includes(r.unit) ? r.unit : '',
        ingredient: typeof r.ingredient === 'string' ? r.ingredient.slice(0, 120) : '',
        note: typeof r.note === 'string' ? r.note.slice(0, 120) : '',
      };
    }).filter((i) => i.ingredient.trim() !== ''),
    steps: steps
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.slice(0, 2000)),
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string') : [],
    confidence: typeof input.confidence === 'string' ? input.confidence : 'medium',
    notes: typeof input.notes === 'string' ? input.notes : '',
  };
}
