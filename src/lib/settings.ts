import { Platform } from 'react-native';
import { supabase } from './supabase';

/** Profile settings: preferences, blocking, and the §28.1 data export. */

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------------------------------------------------------------- preferences

export type Preferences = {
  dietaryTags: string[];
  favoriteCategories: string[];
  dislikedIngredients: string[];
  cuisines: string[];
  skillLevel: 'easy' | 'medium' | 'hard' | null;
  unitsPreference: 'original' | 'metric' | 'imperial';
  onboardingComplete: boolean;
};

export const myPreferences = () => rpc<Preferences>('my_preferences');

/** Sends only what changed; the server leaves anything absent alone. */
export const savePreferences = (patch: Partial<Preferences>) =>
  rpc<Preferences>('save_preferences', { p: patch });

// ---------------------------------------------------------------- blocking

export type BlockedAccount = {
  id: string; username: string; displayName: string; blockedAt: string;
};

export const myBlocks = () => rpc<BlockedAccount[]>('my_blocks');
export const blockUser = (id: string) => rpc<{ blocked: boolean }>('block_user', { p_user_id: id });
export const unblockUser = (id: string) =>
  rpc<{ blocked: boolean }>('unblock_user', { p_user_id: id });
export const isBlockedByMe = (id: string) =>
  rpc<boolean>('is_blocked_by_me', { p_user_id: id });

// ---------------------------------------------------------------- export

export const exportMyData = () => rpc<Record<string, unknown>>('export_my_data');

/**
 * Hands the export to the person it belongs to.
 *
 * On web that is a real file download. On native there is no filesystem picker
 * here, so the caller falls back to showing the JSON — returning false rather
 * than throwing, because "we could not save it for you" is a different message
 * from "the export failed".
 */
export function downloadJson(name: string, payload: unknown): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoked on the next tick: revoking synchronously can beat the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
