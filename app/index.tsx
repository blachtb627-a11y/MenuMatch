import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Loading } from '@/components/ui';
import { Screen } from '@/components/ui';

export const ONBOARDED_KEY = 'menumatch.onboarded';

export default function Index() {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDED_KEY).then((v) => setSeen(v === '1'));
  }, []);

  if (seen === null) return <Screen><Loading /></Screen>;
  // §7: no account is required to reach the deck.
  return <Redirect href={seen ? '/(tabs)' : '/onboarding'} />;
}
