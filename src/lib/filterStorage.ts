import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DIET_OPTIONS, MEAL_OPTIONS, TIME_OPTIONS, NO_FILTERS, type DeckFilters,
} from './filters';

const STORAGE_KEY = 'menumatch.deckFilters.v1';

/**
 * Filters outlive the app being closed. Re-picking "lunch, under 30" on every
 * launch is the worse of the two failures, and the bar above the deck shows
 * everything that is on, so nothing is hidden the way a remembered filter
 * usually is.
 *
 * Anything unrecognised is dropped rather than trusted: a stored slug that no
 * longer exists would otherwise narrow the deck to nothing, behind a chip the
 * sheet has no control to clear.
 */
export async function loadFilters(): Promise<DeckFilters> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return NO_FILTERS;
    return sanitiseFilters(JSON.parse(raw));
  } catch {
    return NO_FILTERS;
  }
}

export async function saveFilters(f: DeckFilters): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    // A filter that does not survive a restart is not worth an error.
  }
}

/** Exported for its own sake: this is the part worth testing. */
export function sanitiseFilters(input: unknown): DeckFilters {
  const v = (input ?? {}) as Partial<DeckFilters>;
  const meals = Array.isArray(v.meals)
    ? v.meals.filter((m) => MEAL_OPTIONS.some((o) => o.slug === m))
    : [];
  const diets = Array.isArray(v.diets)
    ? v.diets.filter((d) => DIET_OPTIONS.some((o) => o.slug === d))
    : [];
  const maxMinutes = TIME_OPTIONS.some((o) => o.minutes === v.maxMinutes)
    ? (v.maxMinutes as number)
    : null;
  return { meals, diets, maxMinutes };
}
