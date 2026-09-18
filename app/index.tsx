import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Loading, Screen } from '@/components/ui';
import { useSession } from '@/state/session';
import { REQUIRE_ACCOUNT } from '@/config';
import { TUTORIAL_KEY } from './tutorial';

export const ONBOARDED_KEY = 'menumatch.onboarded';

/**
 * The single place that decides where a launch lands:
 *   no account    -> welcome (when REQUIRE_ACCOUNT)
 *   no taste pass -> onboarding
 *   no tutorial   -> tutorial
 *   otherwise     -> the deck
 *
 * The tutorial is checked here and not only at the end of onboarding, so
 * quitting part-way through means seeing it next launch rather than never.
 *
 * Whether someone has seen the tutorial is a fact about the person, not about
 * the phone they are holding, so for a signed-in user the account is the
 * authority and the stored flag is only a cache. On the device flag alone it
 * came back on a second device, in a new browser, after a reinstall or after
 * any storage eviction — and never appeared at all for the second person to
 * sign in on a shared device.
 *
 * The local flag still decides for guests, who have no account to record it
 * against, and it still short-circuits the signed-in case so the deck is not
 * held up on a round trip that has usually already happened.
 */
export default function Index() {
  const { ready, session, me } = useSession();
  const [seen, setSeen] = useState<{ onboarding: boolean; tutorial: boolean } | null>(null);

  useEffect(() => {
    void AsyncStorage.multiGet([ONBOARDED_KEY, TUTORIAL_KEY])
      .then((rows) => {
        const map = Object.fromEntries(rows);
        setSeen({ onboarding: map[ONBOARDED_KEY] === '1', tutorial: map[TUTORIAL_KEY] === '1' });
      })
      .catch(() => setSeen({ onboarding: false, tutorial: false }));
  }, []);

  // Wait for the stored session to be restored before routing, or a reload
  // would bounce a signed-in user back to the welcome screen.
  if (!ready || seen === null) return <Screen><Loading /></Screen>;

  if (REQUIRE_ACCOUNT && !session) return <Redirect href="/welcome" />;

  // Signed in, but `me` has not landed yet: hold rather than route on the
  // device flag, which is exactly the guess that showed the tutorial again.
  if (session && !me) return <Screen><Loading /></Screen>;

  const tutorialDone = me
    ? seen.tutorial || me.preferences?.tutorial_seen_at != null
    : seen.tutorial;
  const onboardingDone = me
    ? seen.onboarding || me.preferences?.onboarding_complete === true
    : seen.onboarding;

  if (!onboardingDone) return <Redirect href="/onboarding" />;
  if (!tutorialDone) return <Redirect href="/tutorial" />;
  return <Redirect href="/(tabs)" />;
}
