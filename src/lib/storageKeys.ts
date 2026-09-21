import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_PREFIX = 'menumatch.';
const PREFIX = 'swipzy.';

/**
 * Local storage keys, and the one-time move from the old name to the new one.
 *
 * Renaming a key is not a cosmetic change: to the device it is a different
 * key, so the old value is still sitting there and the app reads an empty one.
 * That would have signed nobody out — the session lives under Supabase's own
 * key — but it would have handed every existing install a new device id
 * (losing the guest swipe history that signup merges in), dropped whatever was
 * waiting in the offline write queue, and replayed onboarding and the tutorial
 * at people who had already sat through both. The tutorial in particular we
 * have fixed once already.
 *
 * So the old keys are copied across on first launch after the rename and then
 * deleted. `storageReady()` is a memoised promise rather than a boot step:
 * every reader awaits the same run, so there is no ordering requirement
 * between this and whatever mounts first, and no second pass once the old keys
 * are gone.
 *
 * An existing new-style key always wins — if both spellings are present,
 * something has already written under the new name and that is the live value.
 */
export function key(suffix: string): string {
  return PREFIX + suffix;
}

let run: Promise<void> | null = null;

export function storageReady(): Promise<void> {
  // Failure here must not take the app down with it: the worst case is the
  // state this was meant to carry over, which is the same as not having run.
  run ??= migrate().catch(() => {});
  return run;
}

async function migrate(): Promise<void> {
  const all = await AsyncStorage.getAllKeys();
  const legacy = all.filter((k) => k.startsWith(LEGACY_PREFIX));
  if (legacy.length === 0) return;

  const taken = new Set(all);
  const rows = await AsyncStorage.multiGet(legacy);

  const carry: [string, string][] = [];
  for (const [oldKey, value] of rows) {
    if (value === null) continue;
    const newKey = PREFIX + oldKey.slice(LEGACY_PREFIX.length);
    if (!taken.has(newKey)) carry.push([newKey, value]);
  }

  if (carry.length > 0) await AsyncStorage.multiSet(carry);
  await AsyncStorage.multiRemove(legacy);
}
