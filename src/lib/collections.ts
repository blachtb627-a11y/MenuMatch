import { supabase } from './supabase';
import type { RecipeCard } from './types';

export type Collection = {
  id: string;
  name: string;
  visibility: 'private' | 'public';
  recipeCount: number;
  coverImageUrl: string | null;
};

export type CollectionDetail = {
  id: string;
  name: string;
  visibility: 'private' | 'public';
  recipes: (RecipeCard & { position: number; unavailable: boolean })[];
};

/** §12 offers these on first creation rather than inventing them for the user. */
export const SUGGESTED_COLLECTIONS = [
  'Weeknight Dinners', 'Meal Prep', 'Want to Try', 'Desserts',
];

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const myCollections = () => rpc<Collection[]>('my_collections');
/**
 * A collection drops entries whose recipe is gone, for the same reason the
 * Cookbook does: a tile that cannot be opened is not worth the row it takes.
 * The count follows the list rather than the stale membership.
 */
export const collectionDetail = async (id: string): Promise<CollectionDetail> => {
  const detail = await rpc<CollectionDetail>('collection_detail', { p_id: id });
  const recipes = (detail.recipes ?? []).filter((r) => !r.unavailable);
  return { ...detail, recipes };
};
export const recipeCollections = (recipeId: string) =>
  rpc<string[]>('recipe_collections', { p_recipe_id: recipeId });

export const createCollection = (name: string) =>
  rpc<{ id: string; existed: boolean }>('create_collection', { p_name: name });
export const renameCollection = (id: string, name: string) =>
  rpc<{ ok: boolean; name: string }>('rename_collection', { p_id: id, p_name: name });
export const deleteCollection = (id: string) =>
  rpc<{ ok: boolean }>('delete_collection', { p_id: id });

/** Replaces membership wholesale — what the picker needs. */
export const setRecipeCollections = (recipeId: string, collectionIds: string[]) =>
  rpc<{ ok: boolean }>('set_recipe_collections', {
    p_recipe_id: recipeId, p_collection_ids: collectionIds,
  });

/**
 * Files several recipes at once, which is what the Cookbook's multi-select
 * needs. Unlike setRecipeCollections this only ever adds: each selected recipe
 * has its own memberships elsewhere and none of them should be disturbed.
 */
export type BulkAddResult = {
  ok: boolean;
  /** The collection's name, so the caller does not have to look it up again. */
  name: string;
  added: number;
  already: number;
  skipped: number;
};

export const addRecipesToCollection = (collectionId: string, recipeIds: string[]) =>
  rpc<BulkAddResult>('add_recipes_to_collection', {
    p_collection_id: collectionId, p_recipe_ids: recipeIds,
  });

/** What to tell someone after a bulk add — the three cases read differently. */
export function describeBulkAdd(r: BulkAddResult, selected: number): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} added to ${r.name}`);
  if (r.already) parts.push(`${r.already} already there`);
  if (r.skipped) parts.push(`${r.skipped} no longer available`);
  if (!parts.length) return `Nothing to add to ${r.name}`;
  // A plain "all N were already in it" reads better than the itemised form.
  if (!r.added && r.already === selected) {
    return selected === 1
      ? `Already in ${r.name}`
      : `All ${selected} were already in ${r.name}`;
  }
  return parts.join(' · ');
}

export const removeFromCollection = (collectionId: string, recipeId: string) =>
  rpc<{ ok: boolean }>('remove_from_collection', {
    p_collection_id: collectionId, p_recipe_id: recipeId,
  });

export const reorderCollectionItem = (
  collectionId: string, recipeId: string, direction: -1 | 1,
) => rpc<{ ok: boolean; moved: boolean }>('reorder_collection_item', {
  p_collection_id: collectionId, p_recipe_id: recipeId, p_direction: direction,
});
