/**
 * Serving scaling (§10, acceptance criterion 10).
 *
 * Quantities are stored as an exact fraction, and scaling multiplies two exact
 * fractions, so nothing accumulates float error. Rendering "0.3333 cups" is the
 * visible quality failure the spec calls out, so display snaps to the fractions
 * a cook actually reads off a measuring spoon.
 */

export type Quantity = { numerator: number; denominator: number };

/** Appendix C: imprecise units do not scale and never show a multiplied value. */
const IMPRECISE = new Set(['pinch', 'dash', 'to_taste', 'handful']);

/** Metric measures read as decimals; a cook does not want 7/8 of a gram. */
const METRIC = new Set(['g', 'kg', 'ml', 'l']);

export function isImpreciseUnit(unit: string | null | undefined): boolean {
  return unit != null && IMPRECISE.has(unit);
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function reduce(q: Quantity): Quantity {
  if (q.denominator === 0) return { numerator: q.numerator, denominator: 1 };
  const g = gcd(q.numerator, q.denominator);
  return { numerator: q.numerator / g, denominator: q.denominator / g };
}

export function toNumber(q: Quantity): number {
  return q.denominator === 0 ? 0 : q.numerator / q.denominator;
}

/**
 * Scales exactly: (n/d) * (to/from). Imprecise units are returned untouched by
 * the caller, which is why this takes no unit.
 */
export function scaleQuantity(q: Quantity, fromServings: number, toServings: number): Quantity {
  if (fromServings <= 0) return q;
  return reduce({
    numerator: q.numerator * toServings,
    denominator: q.denominator * fromServings,
  });
}

/** Denominators a cook can actually measure. */
const READABLE_DENOMINATORS = [2, 3, 4, 6, 8];

function formatFraction(value: number): string {
  const whole = Math.floor(value);
  const remainder = value - whole;

  if (remainder < 1 / 64) return String(whole);
  if (remainder > 1 - 1 / 64) return String(whole + 1);

  let best = { num: 1, den: 2, error: Infinity };
  for (const den of READABLE_DENOMINATORS) {
    const num = Math.round(remainder * den);
    if (num <= 0 || num >= den) continue;
    const error = Math.abs(remainder - num / den);
    // prefer the smaller denominator when two are equally close
    if (error < best.error - 1e-9) best = { num, den, error };
  }

  const fraction = `${best.num}/${best.den}`;
  return whole > 0 ? `${whole} ${fraction}` : fraction;
}

function formatMetric(value: number): string {
  if (value >= 100) return String(Math.round(value / 5) * 5);
  if (value >= 10) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

/**
 * Renders a scaled quantity for display. Returns null when there is no quantity
 * to show, so the row renders as just the ingredient ("sea salt, to taste").
 */
export function formatQuantity(
  q: Quantity | null | undefined,
  unit: string | null | undefined,
): string | null {
  if (!q || q.numerator == null) return null;
  const value = toNumber(q);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit && METRIC.has(unit)) return formatMetric(value);
  return formatFraction(value);
}

const UNIT_LABELS: Record<string, [string, string]> = {
  tsp: ['tsp', 'tsp'], tbsp: ['tbsp', 'tbsp'], fl_oz: ['fl oz', 'fl oz'],
  cup: ['cup', 'cups'], pint: ['pint', 'pints'], quart: ['quart', 'quarts'],
  gallon: ['gallon', 'gallons'], ml: ['ml', 'ml'], l: ['l', 'l'],
  oz: ['oz', 'oz'], lb: ['lb', 'lb'], g: ['g', 'g'], kg: ['kg', 'kg'],
  piece: ['', ''], clove: ['clove', 'cloves'], slice: ['slice', 'slices'],
  bunch: ['bunch', 'bunches'], can: ['can', 'cans'], package: ['pack', 'packs'],
  sprig: ['sprig', 'sprigs'], head: ['head', 'heads'], stalk: ['stalk', 'stalks'],
  pinch: ['pinch', 'pinches'], dash: ['dash', 'dashes'],
  to_taste: ['to taste', 'to taste'], handful: ['handful', 'handfuls'],
};

export function formatUnit(unit: string | null | undefined, value: number): string {
  if (!unit) return '';
  const pair = UNIT_LABELS[unit];
  if (!pair) return unit;
  return value > 1 ? pair[1] : pair[0];
}

export type IngredientRow = {
  quantity: Quantity | null;
  unit: string | null;
  ingredient: string;
  note: string | null;
};

/**
 * Counted things ("2 eggs", "1 onion") carry their number in the noun, and
 * scaling moves it: a recipe written for "1 egg" at two servings needs "2 eggs"
 * at four, and "3 limes" halved is "1 1/2 limes" but "3 limes" at a third is
 * "1 lime". Only rows with no unit or `piece` are touched; "2 cups flour" has
 * its plural in the unit already.
 *
 * English plurals are irregular enough that this stays deliberately narrow:
 * it changes the head noun only, knows the kitchen's irregulars, and leaves
 * anything uncountable alone rather than writing "2 rices".
 */
const IRREGULAR: Record<string, string> = {
  leaf: 'leaves', loaf: 'loaves', half: 'halves', knife: 'knives', calf: 'calves',
  potato: 'potatoes', tomato: 'tomatoes', mango: 'mangoes', avocado: 'avocados',
  chilli: 'chillies', chili: 'chilies', chile: 'chiles', cookie: 'cookies',
};
const SINGULAR = Object.fromEntries(Object.entries(IRREGULAR).map(([a, b]) => [b, a]));
const UNCOUNTABLE = new Set([
  'fish', 'shrimp', 'salmon', 'squid', 'cod', 'tuna', 'rice', 'cream', 'bread',
  'chocolate', 'cheese', 'butter', 'water', 'milk', 'garlic', 'ginger', 'tofu',
  'feta', 'halloumi', 'mozzarella', 'couscous', 'hummus', 'asparagus', 'spinach',
  'kale', 'lettuce', 'parsley', 'mint', 'basil', 'dill', 'coriander', 'cilantro',
  'thyme', 'rosemary', 'sage', 'oregano', 'ice', 'pasta', 'sushi', 'kimchi',
  'tea', 'coffee', 'juice', 'sauce', 'stock', 'broth', 'flour', 'sugar', 'salt',
  'yogurt', 'yoghurt', 'paneer', 'tempeh', 'seitan', 'beef', 'pork',
  'lamb', 'mince', 'bacon', 'ham', 'meat', 'dough', 'pastry', 'filo', 'nero',
]);

const looksPlural = (w: string) =>
  w in SINGULAR || (/s$/.test(w) && !/(ss|us|is)$/.test(w));

function pluralize(w: string): string {
  if (looksPlural(w)) return w;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/(s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

function singularize(w: string): string {
  if (!looksPlural(w)) return w;
  if (SINGULAR[w]) return SINGULAR[w];
  if (/[^aeiou]ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/oes$/.test(w)) return w.slice(0, -2);
  if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
  return w.slice(0, -1);
}

/**
 * Re-inflects the head noun of a counted ingredient for `value`. The head is
 * the last word before any comma or bracket ("ripe tomatoes, halved"), or the
 * word before "of" ("cloves of garlic").
 */
export function inflectCounted(text: string, value: number): string {
  // "corn on the cob" has its noun in the middle; better left as written.
  if (/\son the\s/i.test(text)) return text;
  const cut = text.search(/[,(]/);
  const head = cut === -1 ? text : text.slice(0, cut);
  const tail = cut === -1 ? '' : text.slice(cut);
  const ofAt = head.search(/\s+of\s+/i);
  const scope = ofAt === -1 ? head : head.slice(0, ofAt);
  const rest = ofAt === -1 ? '' : head.slice(ofAt);
  const m = scope.match(/([A-Za-z][A-Za-z'-]*)(\s*)$/);
  const word = m?.[1];
  if (!m || m.index == null || !word) return text;
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower) || word !== lower && word === word.toUpperCase()) return text;
  const next = value > 1 ? pluralize(lower) : singularize(lower);
  if (next === lower) return text;
  // Keep a leading capital ("Bramley apples") as written.
  const shaped = /^[A-Z]/.test(word) ? next.charAt(0).toUpperCase() + next.slice(1) : next;
  return scope.slice(0, m.index) + shaped + (m[2] ?? '') + rest + tail;
}

/** The full display string for one ingredient row at the chosen serving count. */
export function renderIngredient(
  row: IngredientRow,
  fromServings: number,
  toServings: number,
): string {
  // Imprecise units are left exactly as written, with no multiplied value.
  const scaled =
    isImpreciseUnit(row.unit) || !row.quantity
      ? row.quantity
      : scaleQuantity(row.quantity, fromServings, toServings);

  const amount = isImpreciseUnit(row.unit) ? null : formatQuantity(scaled, row.unit);
  const unitLabel = formatUnit(row.unit, scaled ? toNumber(scaled) : 0);

  const counted = !row.unit || row.unit === 'piece';
  const ingredient = counted && amount && scaled
    ? inflectCounted(row.ingredient, toNumber(scaled))
    : row.ingredient;

  const parts = [amount, unitLabel, ingredient].filter(
    (p): p is string => !!p && p.length > 0,
  );
  return parts.join(' ');
}
