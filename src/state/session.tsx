import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { registerDevice } from '@/lib/device';
import { claimGuestHistory } from '@/lib/api';
import { loadQueue, drain, queueSave } from '@/lib/queue';

type Me = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  bio: string | null;
  avatarUrl: string | null;
  savedCount: number;
  isAdmin: boolean;
  adminRole: 'moderator' | 'content_admin' | 'super_admin' | null;
  // me() returns the whole user_preferences row, so this is whatever is on it.
  preferences: {
    onboarding_complete?: boolean;
    /** Null or absent means this person has never been shown the tutorial. */
    tutorial_seen_at?: string | null;
  } | null;
};

type SessionState = {
  ready: boolean;
  session: Session | null;
  me: Me | null;
  isGuest: boolean;
  /** §7 step 4: the save that triggered the signup sheet, applied after signup. */
  pendingSave: { recipeId: string; source: string } | null;
  setPendingSave: (v: { recipeId: string; source: string } | null) => void;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Resolves to needsConfirmation=true when Supabase created the account but
   * withheld a session pending email confirmation. Callers must not treat that
   * as being signed in.
   */
  signUp: (email: string, password: string) => Promise<{
    needsConfirmation: boolean;
    /** The address already has an account; nothing was created or sent. */
    alreadyRegistered: boolean;
  }>;
  resendConfirmation: (email: string) => Promise<void>;
  /** Set when startup failed or timed out, so a screen can say so. */
  bootNote: string | null;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

/**
 * Nothing at startup is allowed to wait forever. Long enough that a slow
 * connection still succeeds, short enough that nobody decides the app is
 * broken and deletes it.
 */
const BOOT_TIMEOUT_MS = 8000;

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out`)), BOOT_TIMEOUT_MS)),
  ]);
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : 'could not reach Swipzy';
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  /** Why startup did not go cleanly, for the screen that is about to show. */
  const [bootNote, setBootNote] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [pendingSave, setPendingSave] = useState<SessionState['pendingSave']>(null);
  const pendingRef = useRef(pendingSave);
  pendingRef.current = pendingSave;

  async function refreshMe() {
    const { data } = await supabase.rpc('me');
    setMe((data as Me | null) ?? null);
  }

  useEffect(() => {
    let alive = true;

    /**
     * Startup, and the one rule it has to obey: `ready` must become true.
     *
     * It used to await registerDevice(), then loadQueue(), then getSession(),
     * and set `ready` on the last line with nothing guarding the path to it.
     * Three awaits, no catch around them and no timeout, so any one of them
     * hanging left the app on its spinner with no way out and nothing on
     * screen to say why — which is what it did on the first device build.
     * `await` on a promise that never settles is not an error; a try/catch
     * never fires, and the line that ends the spinner is simply never reached.
     *
     * Two things changed. Only the stored session gates the first screen now,
     * because it is the only thing the launch router actually reads. And
     * `ready` is set in a `finally` behind a timeout, so the worst a dead
     * network can do is open the app signed out instead of not at all.
     */
    (async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 'session');
        if (!alive) return;
        setSession(data.session);
        if (data.session) {
          // A profile that will not load is a degraded app, not a stuck one.
          try {
            await withTimeout(refreshMe(), 'profile');
          } catch (e) {
            setBootNote(describe(e));
          }
        }
      } catch (e) {
        // Treated as signed out: the welcome screen is somewhere to be.
        if (alive) setBootNote(describe(e));
      } finally {
        if (alive) setReady(true);
      }

      // Best effort, and deliberately after the app is on screen. The device
      // row is an upsert the swipe queue retries against, and the queue drains
      // on its own schedule; neither is a reason to hold the first paint.
      void registerDevice().catch(() => {});
      void loadQueue().catch(() => {});
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, next) => {
      setSession(next);
      if (!next) {
        setMe(null);
        return;
      }
      await refreshMe();

      if (event === 'SIGNED_IN') {
        // §7: merge the guest's swipe history, then apply the save that
        // prompted the signup so the recipe they wanted is not lost.
        await registerDevice();
        try {
          await claimGuestHistory();
        } catch {
          // a failed merge must not block sign-in
        }
        const pending = pendingRef.current;
        if (pending) {
          await queueSave(pending.recipeId, pending.source);
          setPendingSave(null);
        }
        void drain();
        await refreshMe();
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      ready,
      bootNote,
      session,
      me,
      isGuest: !session,
      pendingSave,
      setPendingSave,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      },
      async signUp(email, password) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw new Error(error.message);

        /**
         * Supabase does not tell you an address is taken.
         *
         * Signing up with an email that already has an account answers 200
         * with a user-shaped body, no session, no error — and an empty
         * `identities` array, which is the only thing that distinguishes it.
         * That is deliberate: saying "already registered" would let a stranger
         * probe which addresses have accounts. No email is sent either,
         * because the account is already confirmed.
         *
         * Taking that response at face value is what leaves someone staring
         * at "check your email" for a message that was never sent. The
         * existing "already registered" wording lives in a catch block and
         * never fires, because nothing is ever thrown.
         *
         * Tested for as an array rather than falsiness: an older client that
         * omits `identities` must not be read as "taken".
         */
        const identities = data.user?.identities;
        if (Array.isArray(identities) && identities.length === 0) {
          return { needsConfirmation: false, alreadyRegistered: true };
        }

        // With "Confirm email" enabled, Supabase returns a user and a null
        // session, and no error. Reporting that as success is what stranded
        // people on a signed-out deck being asked to sign up again.
        return { needsConfirmation: !data.session, alreadyRegistered: false };
      },
      async resendConfirmation(email) {
        const { error } = await supabase.auth.resend({ type: 'signup', email });
        if (error) throw new Error(error.message);
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      refreshMe,
    }),
    [ready, bootNote, session, me, pendingSave],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
