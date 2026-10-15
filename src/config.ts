/**
 * Product switches that change the shape of the first run.
 */

/**
 * When true, an account is required before anything else — no browsing, no deck.
 *
 * Off, which is §7 of the spec: guests browse and swipe, and an account is asked
 * for only when there is something to keep (saving, publishing, reporting).
 * It is also what App Review expects — Guideline 5.1.1(v): "If your app doesn't
 * include significant account-based features, let people use it without a
 * login" — and what the Terms and Privacy Policy already promise ("You may
 * browse recipes without an account"). With this on, the app contradicted its
 * own legal pages.
 *
 * The guest plumbing (device ids, anonymous swipe recording, claim_guest_history
 * at signup) never went away, so this is the only switch.
 */
export const REQUIRE_ACCOUNT = false;
