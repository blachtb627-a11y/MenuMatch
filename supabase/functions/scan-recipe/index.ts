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

// Sonnet over Opus deliberately: this is transcription from a clear photo, not
// reasoning, and the edge runtime kills a worker on wall-clock time — a scan
// that returns in a few seconds beats a slightly better one that never returns.
const MODEL = 'claude-sonnet-5';

/**
 * Hard ceiling on the model call. The platform terminates the worker on wall
 * clock with no chance to reply, which is what made scans hang forever with
 * nothing in the logs; failing our own deadline first turns that into an error
 * the creator can actually see.
 */
const MODEL_TIMEOUT_MS = 45_000;

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

/** The `sub` claim, without verifying — the gateway already did that. */
function subjectOf(authHeader: string): string | null {
  const token = authHeader.replace(/^Bearer /i, '');
  const body = token.split('.')[1];
  if (!body) return null;
  try {
    const pad = body.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)));
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Categories and tags are backend-configured (§6), so the allowed values come
 * from the database rather than being frozen into this function — but they
 * change rarely, so a warm worker reuses them instead of paying two round trips
 * on every scan. A lookup failure falls back to the last known good set rather
 * than failing the scan.
 */
let taxonomyCache: { at: number; categories: string[]; tags: string[] } | null = null;
const TAXONOMY_TTL_MS = 10 * 60 * 1000;

async function taxonomy(authHeader: string) {
  if (taxonomyCache && Date.now() - taxonomyCache.at < TAXONOMY_TTL_MS) return taxonomyCache;
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const [{ data: cats }, { data: tagRows }] = await Promise.all([
      supabase.from('categories').select('slug').eq('is_enabled', true),
      supabase.from('tags').select('slug').in('type', ['dietary', 'equipment', 'occasion']),
    ]);
    taxonomyCache = {
      at: Date.now(),
      categories: (cats ?? []).map((c: { slug: string }) => c.slug)
        .filter((slug: string) => !['for_you', 'following'].includes(slug)),
      tags: (tagRows ?? []).map((t: { slug: string }) => t.slug),
    };
  } catch {
    taxonomyCache ??= { at: Date.now(), categories: [], tags: [] };
  }
  return taxonomyCache;
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
      // An empty enum is not a valid schema, so the field is dropped entirely
      // rather than shipped broken if the taxonomy lookup came back empty.
      ...(categories.length ? { category: { type: 'string', enum: categories } } : {}),
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
      ...(tags.length ? { tags: { type: 'array', items: { type: 'string', enum: tags } } } : {}),
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
  // The gateway has already verified the signature (verify_jwt), so reading the
  // subject out of the token is enough — and unlike auth.getUser() it is not a
  // network call, which matters inside a worker that is racing a wall clock.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!subjectOf(authHeader)) return json({ error: 'unauthorized' }, 401);

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

  const { categories, tags } = await taxonomy(authHeader);

  const image = payload.imageBase64
    ? {
        type: 'base64' as const,
        media_type: (payload.mimeType ?? 'image/jpeg') as 'image/jpeg',
        data: payload.imageBase64,
      }
    : { type: 'url' as const, url: payload.imageUrl! };

  const anthropic = new Anthropic({
    apiKey,
    timeout: MODEL_TIMEOUT_MS,
    // A retry storm inside a worker that is already against the clock turns one
    // slow call into a guaranteed timeout.
    maxRetries: 1,
  });
  console.log(`scan-recipe: ${imageKb}kb image, config loaded at ${Date.now() - started}ms`);

  try {
    // Streamed so a longer recipe cannot trip the request timeout, then
    // collected — nothing here is shown to the creator until it is complete.
    const response = await anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      // Transcription is mechanical: reading the page is the whole task, so
      // reasoning about it first only adds latency. These models think by
      // default, hence turning it off explicitly.
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
    console.log(`scan-recipe: model replied at ${Date.now() - started}ms`);

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
    const timedOut = /timeout|timed out|aborted/i.test(message);
    return json({
      error: timedOut ? 'model_timeout' : 'scan_failed',
      message: timedOut
        ? 'The scanner took too long to read that photo. Try a clearer, straight-on shot.'
        : message,
    }, timedOut ? 504 : 502);
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
