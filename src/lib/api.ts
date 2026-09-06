import { supabase } from './supabase';
import { getDeviceKey } from './device';
import { readCache, writeCache } from './cache';
import type { AppConfig, Category, FeedPage, Recipe, RecipeCard } from './types';

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

/**
 * §6: categories are backend-configured. The client renders whatever this
 * returns and never hard-codes the list.
 */
export async function fetchConfig(): Promise<AppConfig> {
  const cached = await readCache<AppConfig>('config');
  try {
    const { data, error } = await supabase.rpc('get_config');
    const config = unwrap<AppConfig>(data, error);
    await writeCache('config', config);
    return config;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

export async function fetchFeed(args: {
  category: string;
  limit?: number;
  exclude?: string[];
}): Promise<FeedPage> {
  const deviceKey = await getDeviceKey();
  const { data, error } = await supabase.rpc('get_feed', {
    p_category: args.category,
    p_limit: args.limit ?? 20,
    p_device_key: deviceKey,
    p_exclude: args.exclude ?? [],
  });
  return unwrap<FeedPage>(data, error);
}

export async function fetchRecipe(id: string): Promise<Recipe> {
  try {
    const { data, error } = await supabase.rpc('get_recipe', { p_recipe_id: id });
    const recipe = unwrap<Recipe>(data, error);
    if (!recipe.unavailable) await writeCache(`recipe.${id}`, recipe);
    return recipe;
  } catch (e) {
    const cached = await readCache<Recipe>(`recipe.${id}`);
    if (cached) return cached;
    throw e;
  }
}

/** §8.2: "show me less like this" writes an explicit negative signal. */
export async function lessLikeThis(
  kind: 'creator' | 'ingredient' | 'cuisine',
  value: string,
): Promise<void> {
  const { error } = await supabase.rpc('less_like_this', { p_kind: kind, p_value: value });
  if (error) throw new Error(error.message);
}

export async function undoSwipe(recipeId: string): Promise<void> {
  const deviceKey = await getDeviceKey();
  const { error } = await supabase.rpc('undo_swipe', {
    p_recipe_id: recipeId,
    p_device_key: deviceKey,
  });
  if (error) throw new Error(error.message);
}

/** §7: guest history is merged into the account immediately after signup. */
export async function claimGuestHistory(): Promise<number> {
  const deviceKey = await getDeviceKey();
  const { data, error } = await supabase.rpc('claim_guest_history', { p_device_key: deviceKey });
  if (error) throw new Error(error.message);
  return (data as { merged: number } | null)?.merged ?? 0;
}

export type SavedRecipe = RecipeCard & { savedAt: string; unavailable?: boolean };

/**
 * The Cookbook (§12). Reads through the saves table, which RLS scopes to the
 * caller, and joins the card fields. §17: a save whose recipe was removed
 * still returns a row, marked unavailable, rather than disappearing silently.
 */
export async function fetchCookbook(): Promise<SavedRecipe[]> {
  try {
    const { data, error } = await supabase
      .from('saves')
      .select('recipe_id, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { recipe_id: string; created_at: string }[];
    const cards = await Promise.all(
      rows.map(async (row) => {
        const recipe = await fetchRecipe(row.recipe_id);
        return { ...(recipe as unknown as RecipeCard), savedAt: row.created_at,
                 unavailable: recipe.unavailable } as SavedRecipe;
      }),
    );
    await writeCache('cookbook', cards);
    return cards;
  } catch (e) {
    const cached = await readCache<SavedRecipe[]>('cookbook');
    if (cached) return cached;
    throw e;
  }
}

export type Collection = {
  id: string;
  name: string;
  visibility: 'private' | 'public';
  recipeCount: number;
};

export async function fetchCollections(): Promise<Collection[]> {
  const { data, error } = await supabase
    .from('collections')
    .select('id, name, visibility, collection_items(count)')
    .order('position');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as {
    id: string; name: string; visibility: 'private' | 'public';
    collection_items: { count: number }[];
  }[]).map((c) => ({
    id: c.id,
    name: c.name,
    visibility: c.visibility,
    recipeCount: c.collection_items?.[0]?.count ?? 0,
  }));
}

export async function createCollection(name: string): Promise<void> {
  const { data: me, error: meErr } = await supabase.rpc('me');
  if (meErr) throw new Error(meErr.message);
  const userId = (me as { id: string } | null)?.id;
  if (!userId) throw new Error('authentication required');
  const { error } = await supabase.from('collections').insert({ user_id: userId, name });
  if (error) throw new Error(error.message);
}

export async function addToCollection(collectionId: string, recipeId: string): Promise<void> {
  const { error } = await supabase
    .from('collection_items')
    .upsert({ collection_id: collectionId, recipe_id: recipeId });
  if (error) throw new Error(error.message);
}

export async function removeFromCollection(collectionId: string, recipeId: string): Promise<void> {
  const { error } = await supabase
    .from('collection_items')
    .delete()
    .eq('collection_id', collectionId)
    .eq('recipe_id', recipeId);
  if (error) throw new Error(error.message);
}

export async function savePreferences(prefs: {
  favoriteCategories: string[];
  cuisines: string[];
  dietaryTags: string[];
}): Promise<void> {
  const { data: me, error: meErr } = await supabase.rpc('me');
  if (meErr) throw new Error(meErr.message);
  const userId = (me as { id: string } | null)?.id;
  if (!userId) return;
  const { error } = await supabase.from('user_preferences').update({
    favorite_categories: prefs.favoriteCategories,
    cuisines: prefs.cuisines,
    dietary_tags: prefs.dietaryTags,
    onboarding_complete: true,
  }).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export type { Category };
