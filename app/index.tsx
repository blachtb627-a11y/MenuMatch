import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Loading, Screen } from '@/components/ui';
import { useSession } from '@/state/session';
import { REQUIRE_ACCOUNT } from '@/config';

export const ONBOARDED_KEY = 'menumatch.onboarded';

/**
 * The single place that decides where a launch lands:
 *   no account   -> welcome (when REQUIRE_ACCOUNT)
 *   no taste pass -> onboarding
 *   otherwise     -> the deck
 */
export default function Index() {
  const { ready, session } = useSession();
  const [seenOnboarding, setSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDED_KEY).then((v) => setSeenOnboarding(v === '1'));
  }, []);

  // Wait for the stored session to be restored before routing, or a reload
  // would bounce a signed-in user back to the welcome screen.
  if (!ready || seenOnboarding === null) return <Screen><Loading /></Screen>;

  if (REQUIRE_ACCOUNT && !session) return <Redirect href="/welcome" />;
  if (!seenOnboarding) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
