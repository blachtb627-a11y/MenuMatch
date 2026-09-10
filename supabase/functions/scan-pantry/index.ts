/**
 * scan-pantry — turns a photo of a fridge shelf, a counter or a bag of shopping
 * into a list of ingredient names for the pantry.
 *
 * Runs server-side so the model API key never reaches the client. The caller
 * must present a valid Supabase session; anonymous callers are rejected.
 *
 * It names foods and nothing else. A photo of someone's kitchen contains their
 * kitchen — people, post, a laptop — and none of that belongs in a list of
 * things to cook with, so the schema has one field and the prompt says so.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@^0.70';

/**
 * Naming what is in a photograph is recognition, not reasoning, and the output
 * is a couple of dozen short strings — so the fast tier is the right default
 * and the wait is what the person actually feels. Overridable with a
 * SCAN_MODEL secret, shared with scan-recipe.
 */
const MODEL = Deno.env.get('SCAN_MODEL') ?? 'claude-haiku-4-5-20251001';

/**
 * `output_config.effort` and `thinking: {type:'disabled'}` arrived with the 4.6
 * generation; sending either to a 4.5-generation model is a 400.
 */
const TUNABLE_MODELS = new Set([
  'claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-fable-5-1',
]);
const tuning = TUNABLE_MODELS.has(MODEL)
  ? { thinking: { type: 'disabled' as const }, output_config: { effort: 'low' as const } }
  : {};

const MODEL_TIMEOUT_MS = 45_000;

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

const PANTRY_TOOL = {
  name: 'record_items',
  description: 'Record the food items visible in the photo.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        description:
          'Every distinct food or drink ingredient you can see, as the plain '
          + 'name someone would write on a shopping list. Lower case, singular, '
          + 'no quantities, no brand names, no packaging words. '
          + '"eggs" not "1 dozen Happy Hen free-range eggs"; '
          + '"cheddar" not "block of Cathedral City mature cheddar". '
          + 'Name the food inside a container when the label says what it is. '
          + 'Skip anything that is not an ingredient — people, pets, utensils, '
          + 'appliances, paperwork, phones. Skip anything you cannot identify '
          + 'rather than guessing at it.',
        items: { type: 'string' },
      },
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('scan-pantry: ANTHROPIC_API_KEY is not set on this project');
    return json({
      error: 'not_configured',
      message:
        'Scanning is not set up yet. An ANTHROPIC_API_KEY secret needs to be added to this project.',
    }, 503);
  }

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

  const started = Date.now();
  const imageKb = Math.round((payload.imageBase64?.length ?? 0) * 0.75 / 1024);

  const image = payload.imageBase64
    ? {
        type: 'base64' as const,
        media_type: (payload.mimeType ?? 'image/jpeg') as 'image/jpeg',
        data: payload.imageBase64,
      }
    : { type: 'url' as const, url: payload.imageUrl! };

  const anthropic = new Anthropic({ apiKey, timeout: MODEL_TIMEOUT_MS, maxRetries: 1 });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [PANTRY_TOOL],
      tool_choice: { type: 'tool', name: 'record_items' },
      ...tuning,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: image },
          {
            type: 'text',
            text:
              'List the food items in this photo so they can be added to a '
              + 'kitchen inventory. Include what is clearly visible and '
              + 'identifiable, including labelled containers and packets. '
              + 'Leave out anything that is not food, and leave out anything '
              + 'you are guessing at — a short accurate list is more use than a '
              + 'long one the cook has to correct.',
          },
        ],
      }],
    });

    const call = response.content.find((c) => c.type === 'tool_use');
    if (!call) {
      return json({
        error: 'nothing_found',
        message: 'No food could be made out in that photo. Try a closer, brighter shot.',
      }, 422);
    }

    const raw = (call.input as { items?: unknown }).items;
    const items = normalise(Array.isArray(raw) ? raw : []);

    if (!items.length) {
      return json({
        error: 'nothing_found',
        message: 'No food could be made out in that photo. Try a closer, brighter shot.',
      }, 422);
    }

    console.log(`scan-pantry ok: ${MODEL}, ${imageKb}kb image, ${Date.now() - started}ms, `
      + `${items.length} items, ${response.usage.input_tokens} in / `
      + `${response.usage.output_tokens} out`);
    return json({ items });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error(`scan-pantry failed after ${Date.now() - started}ms `
      + `on a ${imageKb}kb image:`, message);
    const timedOut = /timeout|timed out|aborted/i.test(message);
    return json({
      error: timedOut ? 'model_timeout' : 'scan_failed',
      message: timedOut
        ? 'The scanner took too long. Try a closer shot of fewer things.'
        : message,
    }, timedOut ? 504 : 502);
  }
});

/**
 * Cleans and bounds the list.
 *
 * The database will drop anything that reduces to no searchable stems, but a
 * name that arrives with a quantity or a brand on it would be stored that way
 * and shown back to the cook, so it is tidied here rather than there.
 */
function normalise(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const name = value
      .toLowerCase()
      // leading counts and units: "2 lb chicken", "500g flour", "a dozen eggs"
      .replace(/^\s*(\d+[\d./]*\s*)?(kg|g|lb|lbs|oz|ml|l|litres?|liters?|cups?|packs?|packets?|tins?|cans?|jars?|bottles?|bunch(es)?|dozen|a|an|some)\b\s*/i, '')
      .replace(/[^a-z0-9 '-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (name.length < 2) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    // A shelf holds what it holds; a list of eighty is a photo of a supermarket
    // and nobody is going to review it.
    if (out.length >= 40) break;
  }
  return out;
}
