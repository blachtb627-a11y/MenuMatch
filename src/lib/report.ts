import { supabase } from './supabase';

/**
 * Reporting that does not start from a recipe (§20.2).
 *
 * The recipe report screen writes to the table directly because it always has
 * a target in hand. These two do not: an account report has to resolve a
 * username first, and an app report has no target at all, so both go through
 * an RPC that enforces the pairing server-side.
 */

/** The taxonomy, filtered per target — "not a recipe" is meaningless here. */
export const ACCOUNT_REASONS = [
  { code: 'impersonation', label: 'Impersonating someone',
    hint: 'Pretending to be another cook, a publication or a brand' },
  { code: 'harassment', label: 'Harassment or hate', hint: null },
  { code: 'sexual', label: 'Sexual content', hint: null },
  { code: 'copyright', label: 'Posting other people’s recipes',
    hint: 'Reposting someone else’s writing or photographs' },
  { code: 'spam', label: 'Spam', hint: 'Affiliate funnels, bulk reposting, engagement bait' },
  { code: 'unsafe_food', label: 'Repeatedly unsafe recipes', hint: null },
  { code: 'other', label: 'Something else', hint: null },
] as const;

export const APP_REASONS = [
  { code: 'unsafe_food', label: 'A safety problem',
    hint: 'Something in the app could get someone hurt' },
  { code: 'spam', label: 'Something is broken',
    hint: 'A screen, a button or a feature that does not work' },
  { code: 'other', label: 'Something else', hint: null },
] as const;

export type ProblemTarget = 'user' | 'app';

export async function reportProblem(
  target: ProblemTarget, targetId: string | null, reason: string, details: string,
): Promise<{ duplicate: boolean }> {
  const { data, error } = await supabase.rpc('report_problem', {
    p_target_type: target,
    p_target_id: targetId,
    p_reason: reason,
    p_details: details.trim() || null,
  });
  if (error) throw new Error(error.message);
  return { duplicate: !!(data as { duplicate?: boolean } | null)?.duplicate };
}
