/**
 * estimate-nutrition — per-serving macros for a recipe, from its ingredients.
 *
 * §19.3 is unambiguous that MenuMatch does not verify nutrition, and this does
 * not change that: what comes back is an estimate, is stored labelled as one,
 * and is shown to cooks with the standing disclaimer. The creator can edit
 * every number before publishing, and can publish without any of them.
 *
 * Text only, no image, so it is much faster than a scan — the wait a creator
 * feels here is a few seconds rather than the tens a photograph costs.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@^0.70';

const MODEL = Deno.env.get('NUTRITION_MODEL') ?? 'claude-haiku-4-5-20251001';
const MODEL_TIMEOUT_MS = 30_000;

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

const SYSTEM = `You estimate the nutrition of a home recipe from its ingredient
list, for a recipe app that labels the result as an estimate.

Work per serving, dividing the whole recipe by the serving count given.

- Use ordinary reference values for common foods. Assume everything listed is
  eaten unless it is plainly not — a brine, a poaching liquid discarded, oil for
  deep frying of which little is absorbed.
- "Salt to taste", water, and other zero-calorie items contribute nothing.
- If an amount is missing, assume a normal home quantity for that ingredient in
  a dish this size rather than skipping it, and say so in assumptions.
- Round calories to the nearest 5 and grams to the nearest whole number. False
  precision reads as authority the number does not have.
- confidence "low" whenever key amounts were missing or the ingredients are
  vague enough that the total could be out by more than a third.

Do not refuse an ordinary recipe. If the list is not food at all, return zeros
with confidence "low" and say so in assumptions.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['calories', 'proteinG', 'carbsG', 'fatG', 'confidence'],
  properties: {
    calories: { type: 'integer', description: 'Calories per serving.' },
    proteinG: { type: 'integer', description: 'Protein grams per serving.' },
    carbsG: { type: 'integer', description: 'Carbohydrate grams per serving.' },
    fatG: { type: 'integer', description: 'Fat grams per serving.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    assumptions: {
      type: 'string',
      description: 'Anything you had to assume, in one sentence, for the creator to check.',
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('estimate-nutrition: ANTHROPIC_API_KEY is not set on this project');
    return json({
      error: 'not_configured',
      message: 'Nutrition estimates are not switched on for this app yet.',
    }, 503);
  }

  if (!subjectOf(req.headers.get('Authorization') ?? '')) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: { ingredients?: string[]; servings?: number; title?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const lines = (payload.ingredients ?? [])
    .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
    .slice(0, 60);
  if (lines.length < 2) {
    return json({
      error: 'not_enough_ingredients',
      message: 'Add a few ingredients first — there is nothing to estimate from yet.',
    }, 400);
  }
  const servings = Number.isInteger(payload.servings) && payload.servings! > 0
    ? Math.min(payload.servings!, 100)
    : 4;

  const started = Date.now();
  const anthropic = new Anthropic({ apiKey, timeout: MODEL_TIMEOUT_MS, maxRetries: 1 });

  try {
    const response = await anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      tools: [{
        name: 'record_nutrition',
        description: 'Records the per-serving nutrition estimate.',
        input_schema: SCHEMA,
        strict: true,
      }],
      messages: [{
        role: 'user',
        content:
          `Recipe: ${payload.title || 'untitled'}\nServes: ${servings}\n\n`
          + `Ingredients:\n${lines.join('\n')}\n\n`
          + 'Estimate the per-serving nutrition and record it by calling record_nutrition.',
      }],
    }).finalMessage();

    const call = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === 'record_nutrition',
    );
    if (!call) {
      return json({
        error: 'no_estimate',
        message: 'Could not estimate from that ingredient list.',
      }, 422);
    }

    const raw = call.input as Record<string, unknown>;
    const num = (v: unknown, max: number) =>
      Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max
        ? (v as number) : null;

    console.log(`estimate-nutrition ok: ${MODEL}, ${lines.length} ingredients, `
      + `${Date.now() - started}ms, ${response.usage.output_tokens} out`);

    return json({
      nutrition: {
        perServing: true,
        calories: num(raw.calories, 20000),
        proteinG: num(raw.proteinG, 2000),
        carbsG: num(raw.carbsG, 2000),
        fatG: num(raw.fatG, 2000),
        source: 'estimated',
      },
      confidence: typeof raw.confidence === 'string' ? raw.confidence : 'medium',
      assumptions: typeof raw.assumptions === 'string' ? raw.assumptions.slice(0, 400) : '',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error(`estimate-nutrition failed after ${Date.now() - started}ms:`, message);
    const timedOut = /timeout|timed out|aborted/i.test(message);
    return json({
      error: timedOut ? 'model_timeout' : 'estimate_failed',
      message: timedOut ? 'That took too long. Try again.' : message,
    }, timedOut ? 504 : 502);
  }
});
