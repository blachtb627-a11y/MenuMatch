import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, coverGradient, fill } from '@/theme';

/**
 * §24: a dominant-colour placeholder with progressive loading, so swiping never
 * waits on an image.
 *
 * Seed recipes carry cover URLs on a CDN that does not exist yet — the paths
 * real photography will eventually live at. Attempting those loads costs a
 * failed request per card and buys nothing, so they are treated as "no photo"
 * and skipped outright.
 */
const PLACEHOLDER_HOSTS = ['cdn.menumatch.app'];

export function isPlaceholderCover(uri: string | null | undefined): boolean {
  return !!uri && PLACEHOLDER_HOSTS.some((host) => uri.includes(host));
}

export function RecipeCover({
  uri, seed, title, style, children,
}: {
  uri: string | null;
  seed: string;
  /** Kept for callers' readability; the placeholder is deliberately unlettered. */
  title?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [from, to] = coverGradient(seed);
  const showImage = !!uri && !failed && !isPlaceholderCover(uri);

  return (
    <View style={[s.wrap, style]}>
      <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={fill} />
      {showImage ? (
        <Image
          source={{ uri }}
          style={fill}
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
});
