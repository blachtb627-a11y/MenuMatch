import { supabase } from './supabase';

/**
 * §13 search, and the creator pages it leads to.
 *
 * Both go through RPCs rather than client-side table queries: the ranking, the
 * §20.1 block rules and the join across recipes and users all belong on the
 * server, and the previous client query could only ever find recipes.
 */

export type SearchRecipe = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  totalMinutes: number;
  cuisine: string | null;
  saveCount: number;
  creator: { id: string; username: string; displayName: string };
};

export type SearchCreator = {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isSeedAccount: boolean;
  recipes: number;
  saves: number;
};

export type SearchResults = { recipes: SearchRecipe[]; creators: SearchCreator[] };

export async function searchAll(
  query: string, maxMinutes: number | null,
): Promise<SearchResults> {
  const { data, error } = await supabase.rpc('search_all', {
    p_query: query, p_max_minutes: maxMinutes, p_limit: 30,
  });
  if (error) throw new Error(error.message);
  const r = data as Partial<SearchResults> | null;
  return { recipes: r?.recipes ?? [], creators: r?.creators ?? [] };
}

export type CreatorProfile = {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isSeedAccount: boolean;
  joinedAt: string;
  saves: number;
  recipes: {
    id: string; title: string; coverImageUrl: string | null;
    totalMinutes: number; cuisine: string | null; saveCount: number;
  }[];
};

export async function fetchCreator(id: string): Promise<CreatorProfile> {
  const { data, error } = await supabase.rpc('creator_profile', { p_creator: id });
  if (error) throw new Error(error.message);
  return data as CreatorProfile;
}

/** "1.2k" past a thousand: an exact count stops meaning anything up there. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
}
