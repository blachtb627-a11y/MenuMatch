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
  savedCount: number;
  isAdmin: boolean;
  preferences: { onboarding_complete?: boolean } | null;
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
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
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

    (async () => {
      // Register the device first so guest swipes have somewhere to land, then
      // restore any writes that outlived the last app termination.
      await registerDevice();
      await loadQueue();

      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(data.session);
      if (data.session) await refreshMe();
      setReady(true);
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
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw new Error(error.message);
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      refreshMe,
    }),
    [ready, session, me, pendingSave],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
