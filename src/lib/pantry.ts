import { supabase } from './supabase';
import { SUPABASE_KEY, SUPABASE_URL } from './supabase';
import type { RecipeCard } from './types';

/**
 * The pantry, and recipes ranked by what it is missing.
 *
 * All the matching lives in the database, where the ingredient text already is
 * — pulling a thousand ingredient rows to the phone to compare them would be
 * slower and no more accurate. The client's job is to make adding things
 * painless and to be honest about what the match does and does not know.
 */

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type PantryItem = { id: string; name: string; createdAt: string };

export type PantryMatch = {
  card: RecipeCard;
  /** Ingredients the recipe needs, excluding none — the full count. */
  total: number;
  /** How many of them the pantry (plus staples) covers. */
  have: number;
  /** The ones it does not, by name. */
  missing: string[];
};

export const myPantry = () => rpc<PantryItem[]>('my_pantry');

export const addPantryItems = (names: string[]) =>
  rpc<{ ok: boolean; added: number; skipped: number }>('add_pantry_items', {
    p_names: names,
  });

export const removePantryItem = (id: string) =>
  rpc<{ ok: boolean }>('remove_pantry_item', { p_id: id });

export const clearPantry = () => rpc<{ ok: boolean; removed: number }>('clear_pantry');

export const cookFromPantry = (
  maxMissing = 3, limit = 30, useStaples = true,
) => rpc<PantryMatch[]>('cook_from_pantry', {
  p_max_missing: maxMissing, p_limit: limit, p_use_staples: useStaples,
});

/** What the staples toggle is actually promising. Mirrors app_config. */
export const STAPLE_NAMES = 'salt, pepper, water, oil and sugar';

/**
 * Splits typed input into separate items.
 *
 * People type "eggs, milk, bread" or one per line without being told to, and a
 * field that only accepts one at a time makes filling a pantry a chore nobody
 * finishes.
 */
export function splitItems(input: string): string[] {
  return input
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 60);
}

/**
 * Tidies an ingredient line for display in a "you still need" list.
 *
 * Most ingredient_text is the name alone, but seeded and pasted recipes
 * sometimes carry a quantity in the text, and "(3 fl oz/80 ml) dry sherry"
 * reads as noise next to "cucumber".
 */
export function tidyMissing(text: string): string {
  return text
    .replace(/^\s*\([^)]*\)\s*/, '')
    .replace(/^\s*[\d\s./-]+\s*(kg|g|lb|lbs|oz|ml|l|cups?|tbsp|tsp|cloves?|cans?|tins?)?\b\s*/i, '')
    .trim() || text.trim();
}

/** "You can make this" / "You need 2 more things", in one line. */
export function describeMatch(m: PantryMatch): string {
  const short = m.total - m.have;
  if (short === 0) return 'You have everything';
  const names = m.missing.slice(0, 3).map(tidyMissing).join(', ');
  const rest = m.missing.length > 3 ? ` +${m.missing.length - 3} more` : '';
  return `Need ${names}${rest}`;
}

// ------------------------------------------------------------------ scanning

const SCAN_TIMEOUT_MS = 60_000;
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

export class PantryScanError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Sends a photo of a shelf, a counter or a bag of shopping to the scan-pantry
 * function, which holds the model API key server-side.
 *
 * The bytes go inline rather than through storage: a photo of the inside of
 * someone's fridge has no business becoming a public URL that outlives the
 * request, and a failed scan then leaves nothing behind.
 *
 * A plain fetch rather than supabase.functions.invoke, for the same reason
 * scanRecipe uses one: the SDK picks its own headers and has added new ones
 * over releases, and any header the function's CORS list does not name makes
 * the browser refuse to send the request at all — a scan that hangs with no
 * server-side trace.
 */
export async function scanPantry(image: {
  base64: string; mimeType: string;
}): Promise<string[]> {
  const bytes = Math.round(image.base64.length * 0.75);
  if (bytes > MAX_SCAN_BYTES) {
    throw new PantryScanError(
      'That photo is too large to send. Try one taken at a lower resolution.',
      'too_large',
    );
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new PantryScanError('Sign in again to scan.', 'unauthorized');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/scan-pantry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageBase64: image.base64, mimeType: image.mimeType }),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new PantryScanError(
      aborted
        ? 'That took too long. Try again on a stronger connection, or type the items in.'
        : 'Could not reach the scanner. Check your connection and try again.',
      aborted ? 'timeout' : 'unreachable',
    );
  } finally {
    clearTimeout(timer);
  }

  let payload: { items?: string[]; message?: string; error?: string } = {};
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body means it failed before reaching our code.
  }

  if (!response.ok) {
    throw new PantryScanError(
      payload.message ?? `The scanner returned ${response.status}.`,
      payload.error ?? `http_${response.status}`,
    );
  }
  if (!payload.items?.length) {
    throw new PantryScanError(
      payload.message ?? 'No food could be made out in that photo.',
      payload.error ?? 'nothing_found',
    );
  }
  return payload.items;
}
