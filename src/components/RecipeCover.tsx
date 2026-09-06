import React, { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, coverGradient, fill } from '@/theme';

/**
 * §24: the client uses a dominant-colour placeholder and progressive loading so
 * swiping never feels blocked by a slow image.
 *
 * Seed photography is not shot yet (§5 is the real launch dependency), so when
 * a cover fails to resolve this falls back to a deterministic food-toned
 * gradient keyed off the recipe id. Every card then looks deliberate instead of
 * broken, and swapping in real photography is only a URL change.
 */
export function RecipeCover({
  uri, seed, title, style, children,
}: {
  uri: string | null;
  seed: string;
  title: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [from, to] = coverGradient(seed);
  const showImage = !!uri && !failed;

  return (
    <View style={[s.wrap, style]}>
      <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill} />
      {!showImage ? (
        <View style={s.placeholder} pointerEvents="none">
          <Text style={s.placeholderMark}>{title.slice(0, 1).toUpperCase()}</Text>
        </View>
      ) : null}
      {showImage ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: colors.surface },
  placeholder: { ...fill, alignItems: 'center', justifyContent: 'center' },
  placeholderMark: {
    fontSize: 96, fontWeight: '800', color: 'rgba(255,255,255,0.10)', letterSpacing: -4,
  },
});
