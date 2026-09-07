/**
 * Paste-a-list parser (§15).
 *
 * "The single largest friction reducer in the composer." A creator pastes their
 * ingredient list as written and gets structured rows back to correct, rather
 * than filling three fields per line by hand.
 *
 * Deliberately conservative: when a line is ambiguous, the whole line becomes
 * the ingredient text. A wrong quantity is worse than an absent one, because a
 * creator will scan past a filled field and not past an empty one.
 */

export type ParsedIngredient = {
  quantity: { numerator: number; denominator: number } | null;
  unit: string;
  ingredient: string;
  note: string;
};

/** Written forms mapped to the measurement_unit enum. */
const UNIT_ALIASES: Record<string, string> = {
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  pint: 'pint', pints: 'pint', quart: 'quart', quarts: 'quart',
  gallon: 'gallon', gallons: 'gallon',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml',
  l: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  g: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  piece: 'piece', pieces: 'piece',
  clove: 'clove', cloves: 'clove',
  slice: 'slice', slices: 'slice',
  bunch: 'bunch', bunches: 'bunch',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  package: 'package', packages: 'package', pack: 'package', packs: 'package', pkg: 'package',
  sprig: 'sprig', sprigs: 'sprig',
  head: 'head', heads: 'head',
  stalk: 'stalk', stalks: 'stalk',
  pinch: 'pinch', pinches: 'pinch',
  dash: 'dash', dashes: 'dash',
  handful: 'handful', handfuls: 'handful',
};

const VULGAR: Record<string, [number, number]> = {
  '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4],
  '⅕': [1, 5], '⅙': [1, 6], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8],
};

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function reduce(n: number, d: number) {
  const g = gcd(n, d);
  return { numerator: n / g, denominator: d / g };
}

/** Reads a leading amount: "2", "1 1/2", "1/3", "½", "1.5", "2-3" (takes 3). */
function takeQuantity(tokens: string[]): {
  quantity: ParsedIngredient['quantity'];
  rest: string[];
} {
  if (tokens.length === 0) return { quantity: null, rest: tokens };
  let i = 0;
  let whole = 0;
  let frac: { numerator: number; denominator: number } | null = null;

  const readFraction = (t: string) => {
    const m = /^(\d+)\/(\d+)$/.exec(t);
    if (m) return reduce(Number(m[1]), Number(m[2]));
    if (VULGAR[t]) return reduce(VULGAR[t]![0], VULGAR[t]![1]);
    return null;
  };

  // A range ("2-3 cloves") takes the upper bound, matching how people shop.
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(tokens[0] ?? '');
  if (range) {
    return { quantity: reduce(Number(range[2]), 1), rest: tokens.slice(1) };
  }

  const first = tokens[0] ?? '';
  const firstFrac = readFraction(first);
  if (firstFrac) {
    frac = firstFrac;
    i = 1;
  } else if (/^\d+$/.test(first)) {
    whole = Number(first);
    i = 1;
    const second = readFraction(tokens[1] ?? '');
    if (second) { frac = second; i = 2; }
  } else if (/^\d*\.\d+$/.test(first)) {
    // 1.5 -> 3/2, via a denominator of 100 then reduced
    const value = Number(first);
    i = 1;
    return { quantity: reduce(Math.round(value * 100), 100), rest: tokens.slice(1) };
  } else {
    // "1½" written without a space
    const glued = /^(\d+)([½⅓⅔¼¾⅕⅙⅛⅜⅝⅞])$/.exec(first);
    if (glued) {
      whole = Number(glued[1]);
      frac = reduce(VULGAR[glued[2]!]![0], VULGAR[glued[2]!]![1]);
      i = 1;
    } else {
      return { quantity: null, rest: tokens };
    }
  }

  const denominator = frac ? frac.denominator : 1;
  const numerator = whole * denominator + (frac ? frac.numerator : 0);
  return { quantity: reduce(numerator, denominator), rest: tokens.slice(i) };
}

/** Parses one written ingredient line into structured fields. */
export function parseIngredientLine(line: string): ParsedIngredient | null {
  const cleaned = line
    .replace(/^\s*[-•*•]\s*/, '')      // list bullets
    .replace(/^\s*\d+[.)]\s+/, '')          // "1. " numbering
    .trim();
  if (!cleaned) return null;

  // Anything after the first comma is preparation, not the ingredient.
  const commaAt = cleaned.indexOf(',');
  const head = commaAt === -1 ? cleaned : cleaned.slice(0, commaAt);
  const note = commaAt === -1 ? '' : cleaned.slice(commaAt + 1).trim();

  // "400g flour" written without a space between amount and unit.
  const glued = /^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|oz|lb)\b/i.exec(head);
  const normalisedHead = glued
    ? head.replace(glued[0], `${glued[1]} ${glued[2]!.toLowerCase()} `)
    : head;

  const tokens = normalisedHead.split(/\s+/).filter(Boolean);
  let { quantity, rest } = takeQuantity(tokens);

  // "a pinch of salt": an article in front of a unit means one of that unit.
  // Only when a unit actually follows — "a few sprigs" names no quantity, and
  // guessing one there would be exactly the wrong kind of help.
  if (!quantity && /^an?$/i.test(rest[0] ?? '')
      && UNIT_ALIASES[(rest[1] ?? '').toLowerCase().replace(/\.$/, '')]) {
    quantity = { numerator: 1, denominator: 1 };
    rest = rest.slice(1);
  }

  let unit = '';
  let words = rest;
  const maybeUnit = (rest[0] ?? '').toLowerCase().replace(/\.$/, '');
  if (maybeUnit && UNIT_ALIASES[maybeUnit]) {
    unit = UNIT_ALIASES[maybeUnit]!;
    words = rest.slice(1);
  } else if (maybeUnit === 'fl' && (rest[1] ?? '').toLowerCase().startsWith('oz')) {
    unit = 'fl_oz';
    words = rest.slice(2);
  }

  // "of" survives the unit ("2 cups of flour") and reads wrong in a row.
  if ((words[0] ?? '').toLowerCase() === 'of') words = words.slice(1);

  const ingredient = words.join(' ').trim();
  if (!ingredient) {
    // Nothing left to name — keep the original line rather than emit a bare unit.
    return { quantity: null, unit: '', ingredient: cleaned, note: '' };
  }

  return { quantity, unit, ingredient, note };
}

/** Parses a pasted block, one ingredient per line. */
export function parseIngredientList(text: string): ParsedIngredient[] {
  return text
    .split(/\r?\n/)
    .map(parseIngredientLine)
    .filter((r): r is ParsedIngredient => r !== null);
}

/** Splits pasted method text into steps, tolerating numbering or blank lines. */
export function parseSteps(text: string): string[] {
  const byLine = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // A single pasted paragraph is split on sentence ends instead.
  if (byLine.length === 1 && byLine[0]!.length > 200) {
    return byLine[0]!
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return byLine.map((l) =>
    l.replace(/^\s*(?:step\s*)?\d+[.):]?\s+/i, '').replace(/^\s*[-•*]\s*/, '').trim(),
  ).filter(Boolean);
}
