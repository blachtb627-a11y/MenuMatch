import { supabase } from './supabase';
import { removeUploadedImage } from './media';
import type { ParsedIngredient } from './parseIngredients';

export type DraftIngredient = ParsedIngredient;

export type Draft = {
  id: string | null;
  title: string;
  description: string;
  coverImageUrl: string | null;
  category: string;
  cuisine: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number | null;
  difficulty: '' | 'easy' | 'medium' | 'hard';
  attribution: string;
  ingredients: DraftIngredient[];
  steps: string[];
  tags: string[];
  status?: string;
  rightsConfirmedAt?: string | null;
};

export const emptyDraft = (): Draft => ({
  id: null, title: '', description: '', coverImageUrl: null,
  category: '', cuisine: '', prepMinutes: null, cookMinutes: null,
  servings: 4, difficulty: '', attribution: '',
  ingredients: [
    { quantity: null, unit: '', ingredient: '', note: '' },
    { quantity: null, unit: '', ingredient: '', note: '' },
  ],
  steps: ['', ''],
  tags: [],
});

export type RecipeSummary = {
  id: string; title: string; status: string;
  coverImageUrl: string | null; totalMinutes: number;
  updatedAt: string; ingredientCount: number; stepCount: number;
};

export async function saveDraft(draft: Draft): Promise<{ id: string; savedAt: string }> {
  const { data, error } = await supabase.rpc('save_draft', { p: draft });
  if (error) throw new Error(error.message);
  return data as { id: string; savedAt: string };
}

export async function getDraft(id: string): Promise<Draft> {
  const { data, error } = await supabase.rpc('get_draft', { p_recipe_id: id });
  if (error) throw new Error(error.message);
  const d = data as Partial<Draft> | null;
  if (!d) throw new Error('Draft not found');
  return { ...emptyDraft(), ...d, id };
}

export async function listMyRecipes(): Promise<RecipeSummary[]> {
  const { data, error } = await supabase.rpc('my_recipes');
  if (error) throw new Error(error.message);
  return (data ?? []) as RecipeSummary[];
}

/**
 * Publishing is validated on the server (§15). A refusal comes back as the list
 * of what is missing, so the composer can point at the fields rather than
 * showing a generic failure.
 */
export async function publishRecipe(
  id: string, rightsConfirmed: boolean,
): Promise<{ published: boolean; missing?: string[] }> {
  const { data, error } = await supabase.rpc('publish_recipe', {
    p_recipe_id: id, p_rights_confirmed: rightsConfirmed,
  });
  if (error) throw new Error(error.message);
  return data as { published: boolean; missing?: string[] };
}

export async function unpublishRecipe(id: string): Promise<void> {
  const { error } = await supabase.rpc('unpublish_recipe', { p_recipe_id: id });
  if (error) throw new Error(error.message);
}

/**
 * Deletes a draft outright. The server refuses anything that has ever been
 * published — that is unpublishRecipe's job, since a published recipe may be
 * sitting in someone's Cookbook.
 *
 * The row goes first, transactionally; the cover image is then cleared through
 * the storage API, which is the only way files can be removed. That second step
 * is best effort, so a stray file never turns into a failed delete.
 */
export async function deleteDraft(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_draft', { p_recipe_id: id });
  if (error) throw new Error(error.message);
  await removeUploadedImage((data as { coverImageUrl?: string | null })?.coverImageUrl ?? null);
}

export type ScannedRecipe = Partial<Draft> & {
  confidence: 'high' | 'medium' | 'low';
  notes: string;
};

/** Long enough for a slow uplink, short enough not to look frozen. */
const SCAN_TIMEOUT_MS = 90_000;

/** Carries the function's error code so the caller can tell apart the reasons. */
export class ScanError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ScanError';
  }
}

/**
 * Sends a photo of the creator's own recipe to the scan-recipe function, which
 * holds the model API key server-side. Returns fields to review, never to
 * publish blind — the rights confirmation is untouched by this.
 *
 * The bytes go inline rather than via storage: a scan is a means to an end, so
 * the photo of someone's notebook has no business becoming a public URL that
 * outlives the request — and a failed scan then leaves nothing behind.
 */
export async function scanRecipe(image: {
  base64: string; mimeType: string;
}): Promise<ScannedRecipe> {
  const call = supabase.functions.invoke('scan-recipe', {
    body: { imageBase64: image.base64, mimeType: image.mimeType },
  });

  // Without this the spinner runs forever when a request never lands. Long
  // enough for a slow connection, short enough to admit defeat and say so.
  const { data, error } = await Promise.race([
    call,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ScanError(
        'That took too long. Try again on a stronger connection, or type the recipe in below.',
        'timeout',
      )), SCAN_TIMEOUT_MS)),
  ]);

  if (error) {
    // Edge function errors carry a useful body; surface it rather than "failed".
    let detail = error.message;
    let code = 'scan_failed';
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (body?.message) detail = body.message;
        if (body?.error) code = body.error;
      } catch {
        // keep the original message
      }
    }
    throw new ScanError(detail, code);
  }

  const result = data as { recipe?: ScannedRecipe; message?: string; error?: string };
  if (!result?.recipe) {
    throw new ScanError(
      result?.message ?? 'Nothing could be read from that photo.',
      result?.error ?? 'no_recipe_found',
    );
  }
  return result.recipe;
}
