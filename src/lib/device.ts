import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { key, storageReady } from './storageKeys';

const DEVICE_KEY_STORAGE = key('deviceKey');

/** Guarantees two ids minted by this process can never match. */
let minted = 0;

/**
 * §7: guest swipe activity is recorded against an anonymous device id and
 * merged into the account's history at signup. §28.2 requires it to be
 * deletable and not to outlive account deletion, so it is a random opaque
 * value we generate, never a hardware identifier.
 *
 * This used to call `crypto.getRandomValues` directly, which exists in a
 * browser and does not exist in React Native — Hermes has no global `crypto`.
 * On device it threw "Property 'crypto' doesn't exist" the moment anyone
 * signed in, because signing in registers the device, which mints an id.
 *
 * So the browser's generator is used when it is there and a fallback is built
 * when it is not. The fallback is weaker and that is a deliberate, bounded
 * trade: every caller needs ids that do not *collide*, not ids that cannot be
 * *guessed*. They are a device key, idempotency keys, upload paths and a deck
 * session id — none is a secret, none authenticates anything, and the one
 * thing that does is the access token, which Supabase issues. Folding in the
 * clock and a counter makes a collision inside one process impossible and a
 * collision across two devices require the same millisecond and the same
 * draws.
 *
 * The feature test is the point: install react-native-get-random-values (or
 * expo-crypto) in the next native build and it registers a real
 * `crypto.getRandomValues`, which this picks up with no change here.
 */
export function newOpaqueId(): string {
  const bytes = new Uint8Array(16);
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;

  if (typeof source?.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    const stamp = Date.now();
    const n = (minted += 1);
    bytes[0] = stamp & 0xff;
    bytes[1] = (stamp >>> 8) & 0xff;
    bytes[2] = (stamp >>> 16) & 0xff;
    bytes[3] = (stamp >>> 24) & 0xff;
    bytes[4] = n & 0xff;
    bytes[5] = (n >>> 8) & 0xff;
  }

  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let cached: string | null = null;

export async function getDeviceKey(): Promise<string> {
  if (cached) return cached;
  // Before the read, not after: minting a fresh id here would throw away the
  // guest swipe history the old key still points at.
  await storageReady();
  let stored = await AsyncStorage.getItem(DEVICE_KEY_STORAGE);
  if (!stored) {
    stored = newOpaqueId();
    await AsyncStorage.setItem(DEVICE_KEY_STORAGE, stored);
  }
  cached = stored;
  return stored;
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
      // Read from the manifest rather than typed here. A hardcoded version
      // reports whatever it said the day it was written, which is worse than
      // no version at all when you are trying to work out which build a
      // problem came from.
      p_app_version: Constants.expoConfig?.version ?? 'unknown',
    });
  } catch {
    // swallowed deliberately; the deck still works and this retries next launch
  }
  return deviceKey;
}
