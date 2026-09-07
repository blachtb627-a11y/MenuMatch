import { supabase } from './supabase';
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

export type ScannedRecipe = Partial<Draft> & {
  confidence: 'high' | 'medium' | 'low';
  notes: string;
};

/**
 * Sends a photo of the creator's own recipe to the scan-recipe function, which
 * holds the model API key server-side. Returns fields to review, never to
 * publish blind — the rights confirmation is untouched by this.
 */
export async function scanRecipe(imageUrl: string): Promise<ScannedRecipe> {
  const { data, error } = await supabase.functions.invoke('scan-recipe', {
    body: { imageUrl },
  });

  if (error) {
    // Edge function errors carry a useful body; surface it rather than "failed".
    let detail = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (body?.message) detail = body.message;
      } catch {
        // keep the original message
      }
    }
    throw new Error(detail);
  }

  const result = data as { recipe?: ScannedRecipe; message?: string };
  if (!result?.recipe) throw new Error(result?.message ?? 'Nothing could be read from that photo.');
  return result.recipe;
}
