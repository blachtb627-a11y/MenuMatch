/**
 * What the deck is currently narrowed to.
 *
 * The old filter strip was one flat row mixing three unrelated things — meal
 * (Dinner, Lunch), time (Quick) and diet (Vegetarian, High Protein) — so
 * picking any one of them cleared the others. They are separate axes here, and
 * `get_feed` ANDs them, which is what makes "lunch, under 30 minutes" sayable.
 *
 * Within a group the two sensible readings differ, so they differ here too:
 * meals are OR (lunch *or* dinner is a reasonable thing to want), diets are AND
 * (someone who picks vegetarian and gluten-free needs both to hold).
 */
export type DeckFilters = {
  /** Recipe categories. Empty means every meal. */
  meals: string[];
  /** Cap on prep + cook. Null means no cap. */
  maxMinutes: number | null;
  /** Tag slugs, every one of which must be present. */
  diets: string[];
};

export const NO_FILTERS: DeckFilters = { meals: [], maxMinutes: null, diets: [] };

export const MEAL_OPTIONS = [
  { slug: 'breakfast', label: 'Breakfast' },
  { slug: 'lunch', label: 'Lunch' },
  { slug: 'dinner', label: 'Dinner' },
  { slug: 'snacks', label: 'Snacks' },
  { slug: 'dessert', label: 'Dessert' },
  { slug: 'drinks', label: 'Drinks' },
] as const;

/**
 * Round numbers people actually think in. 15 is "before the kettle boils",
 * 30 is the weeknight line the Quick tab used to draw silently, 60 is "I have
 * an evening". Anything above that is not a filter, it is the whole catalog.
 */
export const TIME_OPTIONS = [
  { minutes: 15, label: 'Under 15 min' },
  { minutes: 30, label: 'Under 30 min' },
  { minutes: 45, label: 'Under 45 min' },
  { minutes: 60, label: 'Under 1 hour' },
] as const;

export const DIET_OPTIONS = [
  { slug: 'vegetarian', label: 'Vegetarian' },
  { slug: 'vegan', label: 'Vegan' },
  { slug: 'gluten-free', label: 'Gluten-free' },
  { slug: 'dairy-free', label: 'Dairy-free' },
  { slug: 'high-protein', label: 'High protein' },
] as const;

export function filterCount(f: DeckFilters): number {
  return f.meals.length + f.diets.length + (f.maxMinutes === null ? 0 : 1);
}

export function isFiltered(f: DeckFilters): boolean {
  return filterCount(f) > 0;
}

/** The active filters as chips, in the order the sheet presents them. */
export function describeFilters(f: DeckFilters): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const m of MEAL_OPTIONS) {
    if (f.meals.includes(m.slug)) out.push({ key: `meal:${m.slug}`, label: m.label });
  }
  if (f.maxMinutes !== null) {
    const t = TIME_OPTIONS.find((o) => o.minutes === f.maxMinutes);
    out.push({ key: 'time', label: t?.label ?? `Under ${f.maxMinutes} min` });
  }
  for (const d of DIET_OPTIONS) {
    if (f.diets.includes(d.slug)) out.push({ key: `diet:${d.slug}`, label: d.label });
  }
  return out;
}

/** Removes one chip. The key is whatever describeFilters handed out. */
export function withoutFilter(f: DeckFilters, key: string): DeckFilters {
  if (key === 'time') return { ...f, maxMinutes: null };
  if (key.startsWith('meal:')) {
    const slug = key.slice(5);
    return { ...f, meals: f.meals.filter((m) => m !== slug) };
  }
  if (key.startsWith('diet:')) {
    const slug = key.slice(5);
    return { ...f, diets: f.diets.filter((d) => d !== slug) };
  }
  return f;
}

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * A stable key for the current selection, so the deck reloads when the filters
 * change and not merely when the object identity does. Sorted, because picking
 * lunch then dinner is the same deck as dinner then lunch.
 */
export function filterKey(f: DeckFilters): string {
  return JSON.stringify({
    meals: [...f.meals].sort(),
    maxMinutes: f.maxMinutes,
    diets: [...f.diets].sort(),
  });
}

/** The shape get_feed expects. Empty groups are omitted rather than sent. */
export function toRpcFilters(f: DeckFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.meals.length) out.meals = f.meals;
  if (f.diets.length) out.diets = f.diets;
  if (f.maxMinutes !== null) out.maxMinutes = f.maxMinutes;
  return out;
}

/**
 * A short phrase for the active filters, for the banner and the empty state:
 * "lunch under 30 min", "vegetarian dinner". Not a list of chips — that is
 * what the bar is for — but enough that an empty deck says what it is empty
 * *of*.
 */
export function describeDeck(f: DeckFilters): string {
  const diet = DIET_OPTIONS.filter((d) => f.diets.includes(d.slug))
    .map((d) => d.label.toLowerCase());
  const meal = MEAL_OPTIONS.filter((m) => f.meals.includes(m.slug))
    .map((m) => m.label.toLowerCase());

  const head = [...diet, ...(meal.length ? [joinOr(meal)] : [])].join(' ');
  const time = f.maxMinutes === null ? '' : `under ${f.maxMinutes} min`;

  if (head && time) return `${head} ${time}`;
  if (head) return head;
  if (time) return `recipes ${time}`;
  return 'recipes';
}

function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}
