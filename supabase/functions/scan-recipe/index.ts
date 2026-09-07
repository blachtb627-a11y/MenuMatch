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

/**
 * Scanning is latency-bound on output generation, so the model choice is the
 * biggest single lever on how long a creator waits. Haiku by default: reading a
 * photograph of a page is not a reasoning task, and it generates several times
 * faster than the Sonnet tier.
 *
 * Overridable with a SCAN_MODEL secret, so a swap back to
 * `claude-sonnet-5` for accuracy on bad handwriting needs no deploy.
 */
const MODEL = Deno.env.get('SCAN_MODEL') ?? 'claude-haiku-4-5-20251001';

/**
 * `output_config.effort` and `thinking: {type:'disabled'}` arrived with the 4.6
 * generation; sending either to a 4.5-generation model is a 400. Haiku 4.5 does
 * not think by default, so omitting them there is also the behaviour we want.
 */
const TUNABLE_MODELS = new Set([
  'claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-fable-5-1',
]);
const tuning = TUNABLE_MODELS.has(MODEL)
  ? { thinking: { type: 'disabled' as const }, output_config: { effort: 'low' as const } }
  : {};

/**
 * Hard ceiling on the model call, well inside the runtime's own limit, so a
 * stalled upstream becomes an error the creator can read rather than a request
 * that never answers.
 */
const MODEL_TIMEOUT_MS = 45_000;


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

/**
 * Fields the model works out when the page does not state them. Every one is
 * required, so a scan comes back with the composer filled in rather than with
 * half of it blank — and every one is listed back in `estimated`, so the
 * creator is told which numbers came from the page and which came from us.
 */
const ESTIMABLE = [
  'description', 'category', 'cuisine', 'prepMinutes', 'cookMinutes',
  'servings', 'difficulty', 'tags', 'nutrition',
] as const;

function recipeSchema(categories: string[], tags: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    // Required, not optional: an omitted field used to mean "the page did not
    // say", which left the creator typing it in themselves. Now the model has
    // to commit to a value and declare it as read or estimated.
    required: [
      'title', 'ingredients', 'steps', 'description', 'cuisine', 'prepMinutes',
      'cookMinutes', 'servings', 'difficulty', 'nutrition', 'estimated',
      'confidence',
      ...(categories.length ? ['category'] : []),
      ...(tags.length ? ['tags'] : []),
    ],
    properties: {
      title: { type: 'string', description: 'The dish name, as written.' },
      description: {
        type: 'string',
        description:
          'A one or two sentence headnote. Use the source\'s own if it has one; '
          + 'otherwise write one from the dish itself.',
      },
      // An empty enum is not a valid schema, so the field is dropped entirely
      // rather than shipped broken if the taxonomy lookup came back empty.
      ...(categories.length ? { category: { type: 'string', enum: categories } } : {}),
      cuisine: {
        type: 'string',
        description: 'Adjectival: Italian, Thai, Sicilian. Infer it from the '
          + 'ingredients and method when the page does not say.',
      },
      // Strict tool use rejects minimum/maximum on an integer, so the ranges
      // are enforced in normalise() on the way out instead.
      prepMinutes: {
        type: 'integer',
        description: 'Minutes of hands-on prep. Estimate it from the '
          + 'ingredient list if the page does not state it.',
      },
      cookMinutes: {
        type: 'integer',
        description: 'Minutes of cooking. Add up the times in the method if '
          + 'the page does not state a total.',
      },
      servings: {
        type: 'integer',
        description: 'How many it serves. Estimate from the quantities if the '
          + 'page does not say.',
      },
      difficulty: {
        type: 'string',
        enum: ['easy', 'medium', 'hard'],
        description: 'Judge it from the technique and the number of steps.',
      },
      // Plain lines rather than structured objects. Latency here is almost
      // entirely output-token generation, and the JSON scaffolding around every
      // ingredient cost roughly three times what the line itself does. The app
      // parses these with the same code that handles a pasted ingredient list.
      ingredients: {
        type: 'array',
        description:
          'One entry per ingredient line, exactly as written, in order. '
          + 'Include the amount, unit and any preparation note, e.g. '
          + '"1 1/2 lb bone-in chicken thighs, skin on" or "2 cloves garlic, crushed".',
        items: { type: 'string' },
      },
      steps: {
        type: 'array',
        description:
          'One action per step, in order. Split a run-on method into separate '
          + 'steps; keep every time, temperature and doneness cue verbatim.',
        items: { type: 'string' },
      },
      ...(tags.length ? {
        tags: {
          type: 'array',
          description: 'Every tag that genuinely applies to the dish, whether '
            + 'or not the page uses the word.',
          items: { type: 'string', enum: tags },
        },
      } : {}),
      nutrition: {
        type: 'object',
        additionalProperties: false,
        required: ['perServing', 'calories', 'proteinG', 'carbsG', 'fatG'],
        description:
          'Per serving. Read it off the page when printed; otherwise work it '
          + 'out from the ingredients and the serving count.',
        properties: {
          perServing: { type: 'boolean', description: 'True when the figures are per serving.' },
          calories: { type: 'integer' },
          proteinG: { type: 'integer' },
          carbsG: { type: 'integer' },
          fatG: { type: 'integer' },
        },
      },
      // The honest half of estimating everything: the creator is told which
      // fields the page stated and which the model worked out, so "check this"
      // points somewhere specific instead of at the whole form.
      estimated: {
        type: 'array',
        description:
          'Every field you worked out rather than read off the page. Name the '
          + 'field exactly. Leave a field out of this list only when the '
          + 'photograph actually states it.',
        items: { type: 'string', enum: [...ESTIMABLE] },
      },
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

const SYSTEM = `You read a photograph of a recipe and fill in every field of a
recipe app's composer, for the person who wrote it.

There are two jobs here and they have opposite rules. The recipe itself — the
ingredients and the method — is transcribed and never invented. Everything
around it — times, servings, difficulty, cuisine, category, tags, nutrition, a
headnote — is filled in whether or not the page states it, estimating where it
does not. The creator reviews all of it before publishing, so a sensible
estimate they can correct beats an empty field they have to research.

INGREDIENTS — copy exactly.
One line per ingredient, in the order written, with the amount, unit and any
preparation note kept together: "2 cloves garlic, crushed". Never convert, round,
scale or correct a measurement. If an amount is unreadable, give the line without
it rather than guessing.

METHOD — read faithfully, then structure it.
A recipe written for a page is usually a wall of text. Turn it into steps a cook
can follow one at a time, looking up from the phone between each:
- One action per step. Split a run-on paragraph wherever a new action starts, and
  never merge two actions into one step.
- Imperative and present tense. "Brown the beef in batches", not "the beef should
  then be browned in batches".
- Cut filler — "now", "at this point", "you will want to" — but never cut an
  instruction. Every action on the page appears in your steps.
- Keep every time, temperature, quantity and doneness cue exactly as given.
  "180C", "simmer 20 minutes", "until the juices run clear" are safety
  information, not phrasing, and survive word for word.
- Add no technique, equipment or seasoning the page does not give, however
  obvious the omission seems.

EVERYTHING ELSE — fill it in, estimating where the page is silent.
- prepMinutes: hands-on work. Count the chopping, mixing and shaping in the
  ingredient list and the method.
- cookMinutes: time on heat or in the oven. Add up the durations the method
  gives; where it says "until tender", judge it from the ingredient and the cut.
- servings: from the quantities. A pound of pasta serves four; a whole chicken
  serves four; a tray bake serves what the tin holds.
- difficulty: easy if it is one pan and no technique; medium for several
  components or a technique that can fail; hard for pastry, tempering,
  emulsions, laminating, or anything with a step that ruins the dish.
- cuisine: adjectival — "Italian", "Sicilian", "Tex-Mex" — inferred from the
  ingredients and method. Say what a cook would say, not the nearest country.
- category and tags: everything that genuinely applies to the finished dish,
  whether or not the page uses the word. Tag an allergen only when it is
  actually in the ingredients, and a dietary tag only when nothing in the list
  contradicts it — stock, butter and fish sauce all count.
- description: the source's own headnote when it has one; otherwise one or two
  plain sentences on what the dish is and why it is worth cooking. No sales
  copy.
- nutrition: per serving. Read it off the page when printed; otherwise work it
  out from the ingredients and your serving count. Round calories to the
  nearest 5 and grams to the nearest whole number — false precision reads as
  authority these numbers have not earned.

ESTIMATED — say which ones you worked out.
List in "estimated" every field you inferred rather than read. A field belongs
in that list unless the photograph actually states it. This is what lets the app
tell the creator which numbers to check, so being honest here matters more than
looking thorough: claiming you read a time you guessed is the one failure that
misleads someone.

Set confidence from how legible the source was, not from how sure you are of
your estimates: handwriting you had to interpret is medium at best, and anything
you could not read cleanly is low, with what was unclear in notes.

If the image is not a recipe, return empty ingredients and steps with confidence
"low".`;

/**
 * Reading a finished dish is not the same job as reading a page, and the two
 * prompts have to disagree.
 *
 * A written recipe has a source to be faithful to, so the rule there is "copy
 * exactly, add nothing". A photograph of dinner has no source at all: the
 * ingredients, the amounts and the method are all reconstruction. Handing the
 * page prompt a plate would produce a confident transcription of something
 * nobody wrote.
 */
const SYSTEM_DISH = `You are looking at a photograph of a finished dish, taken by
the person who cooked it. Reconstruct a recipe that would produce what you can
see, for them to correct.

Everything you return here is inference. There is no written source, so nothing
is being transcribed — you are proposing a recipe, and the cook reviews every
line of it before anything is published. A specific, plausible recipe they can
correct is far more use than a vague one that avoids committing.

WHAT THE DISH IS.
Name it the way a cook would write it on their own recipe — "Charred cabbage
with brown butter", not "Vegetable Dish". Say what you can actually see, and do
not claim a regional specificity the photograph does not support: if it could
be one of several closely related dishes, choose the plainest name that is true.

INGREDIENTS.
List what the dish visibly contains, plus what it must contain to look like
that — a glossy pan sauce implies fat and an acid, a crumb implies a binder.
Give a real amount and unit for every line, sized to the serving count you
choose. "Some olive oil" is not usable; "2 tbsp olive oil" is. Order them the
way a cook would shop for them: the main components first, seasonings last.
Do not invent an ingredient you cannot see and the dish does not require.

METHOD.
Write the steps that produce it, one action per step, imperative and present
tense — the same shape as any other recipe in this app.
- Give real times and temperatures. A method without them cannot be cooked.
- Where an ingredient carries a food-safety threshold, state it: poultry cooked
  through, pork and mince to temperature, eggs set unless the dish is meant to
  be soft. Never leave that to inference, and never soften it.
- Do not pad. A dish that is genuinely six steps should not be written as
  twelve.

EVERYTHING ELSE.
Fill in times, servings, difficulty, cuisine, category, tags, a headnote and
per-serving nutrition, exactly as you would for a written recipe. Base them on
the reconstruction you just produced, so the numbers and the ingredient list
agree with each other.

CONFIDENCE.
Here it means how sure you are of the dish, not how legible anything was. High
only when the dish is unmistakable and its components are visible. Medium when
you have the category right but the specifics are open — which sauce, which
cut, which spice. Low when the photograph is dark, partial, or could be several
different things. Put what you were unsure of in notes: "could be pork or
veal", "there may be a stock in the sauce I cannot see". That note is the most
useful thing you produce, because it tells the cook exactly where to look
first.

If the photograph is not food, return empty ingredients and steps with
confidence "low".`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Logged on entry: if a scan is failing before this line, the request never
  // arrived, which points at the network rather than anything below.
  console.log(`scan-recipe: POST received, ${req.headers.get('content-length') ?? '?'} bytes`);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('scan-recipe: ANTHROPIC_API_KEY is not set on this project');
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

  let payload: {
    imageUrl?: string; imageBase64?: string; mimeType?: string;
    mode?: 'page' | 'dish';
  };
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
  // Anything other than an explicit 'dish' reads as a written page, so an old
  // client that does not know about modes keeps its existing behaviour.
  const mode: 'page' | 'dish' = payload.mode === 'dish' ? 'dish' : 'page';

  const { categories, tags } = await taxonomy(authHeader);

  const image = payload.imageBase64
    ? {
        type: 'base64' as const,
        media_type: (payload.mimeType ?? 'image/jpeg') as 'image/jpeg',
        data: payload.imageBase64,
      }
    : { type: 'url' as const, url: payload.imageUrl! };

  /**
   * Every HTTP attempt is logged, not just the outcome. Two scans with
   * identical input have differed by 2.5x in wall time, which no amount of
   * token counting explains — but a 429 and the SDK's backoff would, and that
   * is invisible from the outside.
   *
   * The response streams, so this fetch resolves at the first byte: the number
   * below is time-to-first-token, and the gap between it and the total is
   * generation. Which of the two moves tells you where a slow scan went.
   */
  let attempt = 0;
  const anthropic = new Anthropic({
    apiKey,
    timeout: MODEL_TIMEOUT_MS,
    // A retry storm inside a worker already against the clock turns one slow
    // call into a guaranteed timeout.
    maxRetries: 1,
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const n = ++attempt;
      const at = Date.now();
      const res = await fetch(url as string, init);
      const remaining = res.headers.get('anthropic-ratelimit-input-tokens-remaining');
      const retryAfter = res.headers.get('retry-after');
      console.log(
        `scan-recipe: attempt ${n} -> ${res.status}, first byte ${Date.now() - at}ms`
        + (retryAfter ? `, retry-after ${retryAfter}s` : '')
        + (remaining ? `, input-tokens-remaining ${remaining}` : '')
        + `, req ${res.headers.get('request-id') ?? '?'}`,
      );
      return res;
    },
  });
  console.log(`scan-recipe: ${mode} mode, ${imageKb}kb image, config loaded at ${Date.now() - started}ms`);

  try {
    // Streamed so a longer recipe cannot trip the request timeout, then
    // collected — nothing here is shown to the creator until it is complete.
    const response = await anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      // Reading the page is the whole task, so reasoning about it first is pure
      // latency. Only sent to models that accept these parameters.
      ...tuning,
      system: mode === 'dish' ? SYSTEM_DISH : SYSTEM,
      tools: [{
        name: 'record_recipe',
        description: mode === 'dish'
          ? 'Records the recipe reconstructed from a photograph of the dish.'
          : 'Records the recipe transcribed from the image.',
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
            text: mode === 'dish'
              ? 'Work out how this dish was made and record it by calling record_recipe.'
              : 'Transcribe this recipe and record it by calling record_recipe.',
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

    console.log(`scan-recipe ok: ${mode}, ${MODEL}, ${imageKb}kb image, ${Date.now() - started}ms, ` +
      `${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
    return json({ recipe: normalise(call.input as Record<string, unknown>, mode) });
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

/**
 * Nutrition, tagged with where it came from.
 *
 * `scanned` and `estimated` display under the same §19.3 disclaimer but are not
 * the same claim, and the recipe screen says which — so the distinction the old
 * "never calculate it" rule protected is kept by labelling rather than by
 * leaving the field empty.
 */
function nutritionOf(raw: unknown, wasEstimated: boolean) {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const macros = {
    calories: intInRange(n.calories, 0, 20000),
    proteinG: intInRange(n.proteinG, 0, 2000),
    carbsG: intInRange(n.carbsG, 0, 2000),
    fatG: intInRange(n.fatG, 0, 2000),
  };
  if (Object.values(macros).every((v) => v === null)) return null;
  return {
    ...macros,
    perServing: n.perServing !== false,
    source: wasEstimated ? 'estimated' : 'scanned',
  };
}

/** Bounds an integer, or drops it. Carries the ranges the schema cannot. */
function intInRange(value: unknown, min: number, max: number): number | null {
  if (!Number.isInteger(value)) return null;
  const n = value as number;
  return n < min || n > max ? null : n;
}

/** Reshapes the model's output into exactly what save_draft expects. */
function normalise(input: Record<string, unknown>, mode: 'page' | 'dish') {
  const ingredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  const steps = Array.isArray(input.steps) ? input.steps : [];
  // From a dish there is nothing to have read, so every field is estimated by
  // construction and the model is not asked to be the judge of that. From a
  // page its answer is filtered against the known names, because a stray value
  // would tell the creator to check a field that is not on the screen.
  const estimated = mode === 'dish'
    ? [...ESTIMABLE]
    : (Array.isArray(input.estimated) ? input.estimated : [])
        .filter((f): f is string => typeof f === 'string'
          && (ESTIMABLE as readonly string[]).includes(f));

  return {
    title: typeof input.title === 'string' ? input.title.slice(0, 100) : '',
    description: typeof input.description === 'string' ? input.description.slice(0, 1000) : '',
    category: typeof input.category === 'string' ? input.category : '',
    cuisine: typeof input.cuisine === 'string' ? input.cuisine : '',
    prepMinutes: intInRange(input.prepMinutes, 0, 6000),
    cookMinutes: intInRange(input.cookMinutes, 0, 6000),
    servings: intInRange(input.servings, 1, 100),
    difficulty: typeof input.difficulty === 'string' ? input.difficulty : '',
    // Lines, not structured rows: the app parses them with the same code that
    // handles a pasted ingredient list, so there is one parser, not two.
    ingredients: ingredients
      .filter((i): i is string => typeof i === 'string' && i.trim() !== '')
      .map((i) => i.trim().slice(0, 200)),
    steps: steps
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.slice(0, 2000)),
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string') : [],
    nutrition: nutritionOf(input.nutrition, estimated.includes('nutrition')),
    estimated,
    mode,
    confidence: typeof input.confidence === 'string' ? input.confidence : 'medium',
    notes: typeof input.notes === 'string' ? input.notes : '',
  };
}
