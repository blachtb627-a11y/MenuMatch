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
 */
export default function Index() {
  const { ready, session } = useSession();
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
  if (!seen.onboarding) return <Redirect href="/onboarding" />;
  if (!seen.tutorial) return <Redirect href="/tutorial" />;
  return <Redirect href="/(tabs)" />;
}
