import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * §27: saved recipes are cached locally so the Cookbook and Cook Mode keep
 * working offline for recipes the user has already opened.
 */
const PREFIX = 'menumatch.cache.';

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // A full cache is not a user-facing failure.
  }
}
