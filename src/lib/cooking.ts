import { queueCook, queueUnsave } from './queue';

/**
 * Marking a recipe cooked takes it out of the Cookbook.
 *
 * The Cookbook is a shortlist of things to cook, not an archive of things you
 * have cooked. Leaving every cooked recipe in it means the list only ever
 * grows, and the recipes you actually still mean to make sink underneath the
 * ones you have already had twice. Taking a cooked recipe out is what keeps
 * the list worth opening.
 *
 * It is not silent, though — a list that empties itself without asking is a
 * list nobody trusts. Both places that log a cook confirm first, and both use
 * the wording below, because two screens describing the same consequence
 * differently is how people end up unsure what either of them does.
 *
 * Logging the cook is not undone by saving the recipe again: you did cook it,
 * and the count other people see is the honest one either way.
 */
export const COOKED_TITLE = 'Cooked it?';

export const COOKED_BODY =
  'This logs the cook and takes the recipe out of your Cookbook, including '
  + 'any collections you filed it in. The recipe stays on Swipzy — you can '
  + 'save it again whenever you like.';

/** What the confirming button says, in both places. */
export const COOKED_CONFIRM = 'Cooked it';

/**
 * Both writes go through the offline queue, so this works on a bad connection
 * and retries itself. The order matters only for what a partial send leaves
 * behind: a logged cook with the recipe still saved is a smaller wrong than a
 * recipe removed from the Cookbook with no record of why.
 */
export async function logCook(
  recipeId: string,
  clearFromCookbook: boolean,
): Promise<void> {
  await queueCook(recipeId);
  if (clearFromCookbook) await queueUnsave(recipeId);
}
