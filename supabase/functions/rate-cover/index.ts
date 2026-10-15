/**
 * rate-cover — looks at one candidate cover photograph and says whether it
 * shows the dish, and how good a cover it would make.
 *
 * Scaffolding for supabase/seed/resolve-covers.sql, not part of the app. It is
 * deployed for a catalog load with verify_jwt off and a shared secret instead,
 * because the caller is the database (zz_rate), not a signed-in person — and it
 * is deleted again as soon as the load is done:
 *
 *   supabase secrets set RATE_COVER_SECRET=<random>
 *   supabase functions deploy rate-cover --no-verify-jwt
 *   ... load ...
 *   supabase functions delete rate-cover
 *
 * The image bytes are fetched here and sent as base64. Passing the Wikimedia URL
 * straight through does not work: the model's own URL fetcher is blocked by
 * upload.wikimedia.org on user agent and comes back "Unable to download".
 *
 * The old verify step answered one question — is this the dish? — and the
 * resolver took the first yes. That chose the first acceptable photograph, not
 * the best one. This also scores how appetising the photograph is, so the
 * resolver can rate every candidate and keep the highest.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@^0.70';

const MODEL = Deno.env.get('RATE_MODEL') ?? 'claude-opus-5-5';
const MODEL_TIMEOUT_MS = 90_000;

/** Wikimedia asks every client to identify itself; anonymous agents get throttled first. */
const USER_AGENT = 'SwipzyCoverResolver/1.0 (seed catalog load; contact via the app)';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });

const RATE_TOOL = {
  name: 'rate_cover',
  description: 'Record the verdict on one candidate cover photograph for a recipe.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['saw', 'is_the_dish', 'appeal', 'whole_dish_visible', 'issues'],
    properties: {
      saw: {
        type: 'string',
        description: 'One plain sentence: what the photograph actually shows.',
      },
      is_the_dish: {
        type: 'boolean',
        description:
          'True only if this is a photograph of the finished, served dish named. '
          + 'False for a different dish, raw ingredients, a cooking step, a painting '
          + 'or drawing, packaging, a sign or menu, or a person who shares the name.',
      },
      appeal: {
        type: 'integer',
        description:
          'How good a cover this would make on a recipe card, 1 to 10. '
          + '9-10: looks like a cookbook or magazine shot — appetising, sharp, '
          + 'well lit, the food fills the frame on a clean background. '
          + '6-8: good home or restaurant photo, clearly appetising, minor flaws. '
          + '3-5: usable but dull — flat or dim light, cluttered table, awkward crop, '
          + 'food small in the frame. 1-2: unappetising, blurry, very dark, or barely '
          + 'shows the food. Score the photograph, not the dish: a beautiful photo of '
          + 'a plain stew can score 9.',
      },
      whole_dish_visible: {
        type: 'boolean',
        description:
          'True if you can see the dish as a whole plate or bowl, rather than an '
          + 'extreme close-up or a corner cropped off.',
      },
      issues: {
        type: 'string',
        description:
          'Short list of anything that would make it a worse cover — watermark, '
          + 'text on the image, people, hands, logos, cluttered background, '
          + 'blur, harsh flash — or "none".',
      },
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = Deno.env.get('RATE_COVER_SECRET');
  if (!secret || req.headers.get('x-verify-secret') !== secret) {
    return json({ error: 'unauthorized' }, 401);
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'not_configured' }, 503);

  let payload: { imageUrl?: string; expect?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!payload.imageUrl || !payload.expect) return json({ error: 'missing_fields' }, 400);

  let base64: string;
  let mediaType: 'image/jpeg' | 'image/png';
  try {
    const res = await fetch(payload.imageUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return json({ error: 'image_fetch', status: res.status }, 502);
    mediaType = (res.headers.get('content-type') ?? '').includes('png') ? 'image/png' : 'image/jpeg';
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    base64 = btoa(binary);
  } catch (e) {
    return json({ error: 'image_fetch', message: e instanceof Error ? e.message : String(e) }, 502);
  }

  const anthropic = new Anthropic({ apiKey, timeout: MODEL_TIMEOUT_MS, maxRetries: 2 });

  try {
    // Server-side refusal fallback: if a safeguard declines (a false positive on
    // a food photo is possible), the same request is re-run on a fallback model
    // instead of failing the candidate.
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      tools: [RATE_TOOL],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          {
            type: 'text',
            text:
              `This is a candidate cover photograph for a recipe called "${payload.expect}" `
              + 'in a recipe app, where it will be shown as a full-bleed card that '
              + 'people swipe through. Look at it and call rate_cover once with your '
              + 'verdict. Judge only what is in the photograph.',
          },
        ],
      }],
      // `fallbacks`, `strict` and `output_config` postdate this SDK's types; the
      // SDK passes unknown fields through in the request body unchanged.
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

    if (response.stop_reason === 'refusal') return json({ error: 'refused' }, 422);

    const call = response.content.find((c) => c.type === 'tool_use');
    const input = call && 'input' in call ? call.input as Record<string, unknown> : null;
    if (!input || typeof input.is_the_dish !== 'boolean' || typeof input.appeal !== 'number') {
      return json({ error: 'no_verdict' }, 502);
    }

    return json({
      is_the_dish: input.is_the_dish,
      saw: String(input.saw ?? ''),
      appeal: Math.max(1, Math.min(10, Math.round(input.appeal))),
      whole_dish_visible: input.whole_dish_visible === true,
      issues: String(input.issues ?? ''),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('rate-cover failed:', message);
    return json({ error: 'model_failed', message }, 502);
  }
});
