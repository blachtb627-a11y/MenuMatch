import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY. Copy .env.example to .env.',
  );
}

/** Needed by callers that talk to an Edge Function without the SDK wrapper. */
export const SUPABASE_URL = url;
export const SUPABASE_KEY = key;

export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL bar to read a session out of.
    detectSessionInUrl: false,
    /**
     * Pinned, not left to the default, because password reset depends on it.
     *
     * A reset is asked for on a phone and finished wherever the mail gets
     * opened — often a laptop. PKCE stores a code verifier on the device that
     * made the request and requires it back when the link is opened, so a
     * reset that crosses devices fails with nothing useful to say. The
     * implicit flow carries everything it needs in the link itself.
     *
     * This is the current default too, which is exactly why it is written
     * down: a silent upstream change to PKCE would break reset for anyone who
     * does not read mail on their phone, and it would break it in the one
     * flow nobody tests twice.
     */
    flowType: 'implicit',
  },
});
