/**
 * What still stands between a draft and Discover, said in words a creator can
 * act on.
 *
 * publish_recipe (0011_composer.sql) is the authority and checks the same
 * things; this mirrors it so the composer can say what is wrong before the
 * round trip, and point at the field. The server's answer still wins: anything
 * it reports that this missed is shown too, through `fromServer`.
 */

export type PublishField =
  | 'cover' | 'title' | 'category' | 'cuisine' | 'ingredients' | 'steps' | 'rights';

export type PublishProblem = { field: PublishField; message: string };

/** The parts of a Draft the check reads — structural, so this has no app imports. */
export type PublishableDraft = {
  title: string;
  coverImageUrl: string | null;
  category: string;
  cuisine: string;
  ingredients: { ingredient: string }[];
  steps: string[];
};

const MESSAGES: Record<PublishField, string> = {
  cover: 'Add a cover photo. Scanning a recipe page fills in the words, not the photo.',
  title: 'Give it a title of at least 3 letters.',
  category: 'Pick a meal.',
  cuisine: 'Pick a cuisine.',
  ingredients: 'Add at least 2 ingredients.',
  steps: 'Add at least 2 steps.',
  rights: 'Tick the box confirming this recipe and photo are yours to publish.',
};

/** Same order as the form, top to bottom, so the list reads like the page. */
const ORDER: PublishField[] = ['cover', 'title', 'category', 'cuisine', 'ingredients', 'steps', 'rights'];

/** publish_recipe's `missing` strings, mapped onto the fields they name. */
const SERVER_KEYS: Record<string, PublishField> = {
  'cover photo': 'cover',
  'title': 'title',
  'meal category': 'category',
  'cuisine': 'cuisine',
  'at least 2 ingredients': 'ingredients',
  'at least 2 steps': 'steps',
  'rights confirmation': 'rights',
};

const filled = (s: string | null | undefined) => (s ?? '').trim() !== '';

export function checkPublishable(draft: PublishableDraft, rightsConfirmed: boolean): PublishProblem[] {
  const title = draft.title.trim();
  const failing = new Set<PublishField>();
  if (!filled(draft.coverImageUrl)) failing.add('cover');
  if (title.length < 3 || title === 'Untitled recipe') failing.add('title');
  if (!filled(draft.category)) failing.add('category');
  if (!filled(draft.cuisine)) failing.add('cuisine');
  // Blank rows are dropped on save, so they do not count here either.
  if (draft.ingredients.filter((i) => filled(i.ingredient)).length < 2) failing.add('ingredients');
  if (draft.steps.filter(filled).length < 2) failing.add('steps');
  if (!rightsConfirmed) failing.add('rights');
  return ORDER.filter((f) => failing.has(f)).map((field) => ({ field, message: MESSAGES[field] }));
}

/**
 * The server's list as problems. A string this does not know is kept as it
 * came, so a new server rule still shows up rather than vanishing.
 */
export function fromServer(missing: string[]): (PublishProblem | { field: null; message: string })[] {
  return missing.map((m) => {
    const field = SERVER_KEYS[m.trim().toLowerCase()];
    return field
      ? { field, message: MESSAGES[field] }
      : { field: null, message: m.charAt(0).toUpperCase() + m.slice(1) + '.' };
  });
}

/** An error from saving or publishing, as something a person can do about it. */
export function describePublishError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('authentication required') || m.includes('jwt')) {
    return 'You need to be signed in to publish. Sign in, then tap Publish again — your draft is kept.';
  }
  if (m.includes('recipe not found') || m.includes('draft not found')) {
    return 'This draft could not be found on your account. Go back to Create and open it again.';
  }
  if (m.includes('network') || m.includes('fetch') || m.includes('timed out') || m.includes('timeout')) {
    return 'Could not reach Swipzy. Check your connection and tap Publish again.';
  }
  return `Publishing failed: ${message}`;
}
