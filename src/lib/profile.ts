import { supabase } from './supabase';
import { removeUploadedImage } from './media';

/**
 * Editing your own profile (§28.1).
 *
 * A plain table update rather than an RPC: 0005 already grants authenticated
 * UPDATE on exactly these columns and the users_update_self policy scopes it
 * to your own row, so the database is enforcing this without a function in the
 * middle. Username is deliberately not here — it is a citext unique that other
 * people's mental model of you depends on, and changing it needs its own
 * flow.
 */
export type ProfilePatch = {
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
};

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    const name = patch.displayName.trim();
    if (!name) throw new Error('A display name cannot be empty.');
    if (name.length > 60) throw new Error('Keep the display name under 60 characters.');
    row.display_name = name;
  }
  if (patch.bio !== undefined) {
    const bio = (patch.bio ?? '').trim();
    if (bio.length > 300) throw new Error('Keep the bio under 300 characters.');
    row.bio = bio || null;
  }
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  if (Object.keys(row).length === 0) return;

  const { error } = await supabase.from('users').update(row).eq('id', userId);
  if (error) throw new Error(error.message);
}

/**
 * Points the profile at a new avatar and drops the old file.
 *
 * The row is updated first: an orphaned image costs storage, whereas deleting
 * the old one before the new URL is saved would leave the profile pointing at
 * a file that no longer exists.
 */
export async function replaceAvatar(
  userId: string, nextUrl: string | null, previousUrl: string | null,
): Promise<void> {
  await updateProfile(userId, { avatarUrl: nextUrl });
  if (previousUrl && previousUrl !== nextUrl) await removeUploadedImage(previousUrl);
}
