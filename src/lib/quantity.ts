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

  const parts = [amount, unitLabel, row.ingredient].filter(
    (p): p is string => !!p && p.length > 0,
  );
  return parts.join(' ');
}
