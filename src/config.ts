/**
 * Product switches that change the shape of the first run.
 */

/**
 * When true, an account is required before anything else — no browsing, no deck.
 *
 * Note this is a deliberate departure from §7 of the spec, which makes guest
 * browsing the default and calls requiring signup up front "the most expensive
 * mistake in this category". The guest plumbing is all still in place (device
 * ids, anonymous swipe recording, claim_guest_history at signup), so flipping
 * this back to false restores the spec's flow without any other change.
 */
export const REQUIRE_ACCOUNT = true;
