import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const DEVICE_KEY_STORAGE = 'menumatch.deviceKey';

/**
 * §7: guest swipe activity is recorded against an anonymous device id and
 * merged into the account's history at signup. §28.2 requires it to be
 * deletable and not to outlive account deletion, so it is a random opaque
 * value we generate, never a hardware identifier.
 */
export function newOpaqueId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let cached: string | null = null;

export async function getDeviceKey(): Promise<string> {
  if (cached) return cached;
  let key = await AsyncStorage.getItem(DEVICE_KEY_STORAGE);
  if (!key) {
    key = newOpaqueId();
    await AsyncStorage.setItem(DEVICE_KEY_STORAGE, key);
  }
  cached = key;
  return key;
}

export async function forgetDevice(): Promise<void> {
  cached = null;
  await AsyncStorage.removeItem(DEVICE_KEY_STORAGE);
}

export async function registerDevice(): Promise<string> {
  const deviceKey = await getDeviceKey();
  // Best effort: a failure here must never block the first deck.
  try {
    await supabase.rpc('register_device', {
      p_device_key: deviceKey,
      p_platform: Platform.OS,
      p_app_version: '0.1.0',
    });
  } catch {
    // swallowed deliberately; the deck still works and this retries next launch
  }
  return deviceKey;
}
