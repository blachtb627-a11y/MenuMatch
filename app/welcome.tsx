import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Button, Screen } from '@/components/ui';
import { useSession } from '@/state/session';
import { colors, space, type } from '@/theme';

/** The signed-out front door. An account is required before the deck. */
export default function Welcome() {
  const { session } = useSession();
  // Signing in elsewhere (or restoring a stored session) should not leave the
  // user parked here.
  if (session) return <Redirect href="/" />;

  return (
    <Screen>
      <SafeAreaView style={s.wrap}>
        <View style={s.markRow}>
          {/* The app mark, on its own white field with the corners rounded
              off — the same tile as the home screen icon, which is where
              someone standing at this door has just come from. */}
          <View style={s.mark}>
            <Image source={require('../assets/mark.png')} style={s.markImage}
                   contentFit="cover" accessibilityLabel="Swipzy" />
          </View>
        </View>

        <View style={{ gap: space.md }}>
          <Text style={s.headline}>Swipzy</Text>
          <Text style={s.sub}>
            Discover recipes by swiping, save your favourites, share your own.
          </Text>
        </View>

        <View style={{ gap: space.md }}>
          <Button label="Create a free account"
                  onPress={() => router.push('/auth?mode=signup')} />
          <Button label="I already have an account" variant="secondary"
                  onPress={() => router.push('/auth?mode=signin')} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, justifyContent: 'space-between', gap: space.xxl },
  markRow: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 108, height: 108, borderRadius: 30, backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  markImage: { width: '100%', height: '100%' },
  headline: { ...type.display, color: colors.text },
  sub: { ...type.body, color: colors.textMuted, lineHeight: 22, maxWidth: 320 },
});
