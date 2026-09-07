import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ImageStyle } from 'expo-image';
import { Image } from 'expo-image';
import { colors, radius, type } from '@/theme';

/**
 * A profile picture, or the initial when there is not one.
 *
 * One component so the fallback is identical everywhere — a letter on the
 * raised surface, not a grey silhouette, which reads as a broken image.
 */
export function Avatar({
  uri, name, size = 56, style,
}: {
  uri: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[s.image, box, style as StyleProp<ImageStyle>]}
        contentFit="cover"
        transition={120}
        accessibilityLabel={name ? `${name}'s profile picture` : 'Profile picture'}
      />
    );
  }
  return (
    <View style={[s.fallback, box, style]}>
      <Text style={[s.letter, { fontSize: Math.round(size * 0.38) }]}>
        {(name ?? '?').trim().slice(0, 1).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  image: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  fallback: {
    backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  letter: { ...type.title, color: colors.text },
});
