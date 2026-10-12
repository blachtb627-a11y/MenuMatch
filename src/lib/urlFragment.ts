/**
 * Getting Supabase's tokens out of the address bar, and keeping them out.
 *
 * Every auth link Supabase sends comes back with the session in the URL
 * fragment — recovery and signup confirmation alike. Those are live
 * credentials until they are spent, and a fragment left in place persists in
 * browser history, in anything the tab gets shared with, and in whatever a
 * later navigation sends as a referrer. On the confirmation page that is
 * sharper than it sounds: it tells people to close the tab, which is exactly
 * the moment nobody is going to tidy up the URL themselves.
 *
 * The subtlety, and the reason this is a helper rather than one line at each
 * call site: a single replaceState does not hold. expo-router syncs the
 * browser URL from its own router state shortly after mount and puts the
 * fragment straight back, so the strip read correctly in the source and
 * achieved nothing. Only watching the real page showed it.
 *
 * So the strip is re-asserted across the window in which the router settles,
 * then stops. Bounded rather than permanent, because a page that rewrote the
 * URL forever would fight anything that legitimately set a fragment later.
 */
const SETTLE_MS = 3000;
const RECHECK_MS = 100;

/** Returns a cleanup that stops the re-assertion; safe to call on any platform. */
export function stripUrlFragment(): () => void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return () => {};

  const clear = () => {
    if (window.location.hash) {
      window.history.replaceState(
        null, '', window.location.pathname + window.location.search);
    }
  };

  clear();
  const retry = setInterval(clear, RECHECK_MS);
  const stop = setTimeout(() => clearInterval(retry), SETTLE_MS);
  return () => { clearInterval(retry); clearTimeout(stop); };
}
