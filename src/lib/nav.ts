import { router, type Href } from 'expo-router';

/**
 * Leaves the current screen.
 *
 * `router.back()` alone is a no-op whenever the current screen is the first
 * entry in the navigation state — a refreshed page on the web build, a deep
 * link, a shared URL, anything that opened the screen without pushing onto an
 * existing stack. The back arrow then looks broken: the user taps it, nothing
 * moves, and there is no way out of the screen at all.
 *
 * So every back control names where it belongs instead, and falls back to that
 * when there is no history to pop.
 */
export function goBack(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
