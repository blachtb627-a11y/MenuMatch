import React, { useEffect, useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from './RecipeCover';
import { recordAdClick, recordAdImpression, type ServedAd } from '@/lib/ads';
import { colors, fill, motion, radius, space, type } from '@/theme';

/**
 * A paid card in the deck (§38).
 *
 * Built to swipe exactly like a recipe card, because a card in the deck that
 * does not answer the gesture people are already making is an obstacle rather
 * than an ad. It is deliberately not dressed up as one: the SPONSORED label,
 * the advertiser's name and a call-to-action button say plainly what it is,
 * which §38 requires and which is also the only version worth building.
 *
 * Neither swipe direction means anything here — nothing is saved, nothing is
 * taught to the ranker. Both simply move on.
 */

const SWIPE_FRACTION = 0.28;
const VELOCITY_ESCAPE = 800;
const H_ACTIVATE = 14;

export function AdCard({
  ad, deviceKey, onDismiss,
}: {
  ad: ServedAd;
  deviceKey: string | null;
  onDismiss: () => void;
}) {
  const { width } = useWindowDimensions();
  const threshold = width * SWIPE_FRACTION;

  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const gone = useSharedValue(0);

  /**
   * The view is counted here, on the card that is actually in front of
   * somebody — not when the ad was fetched. The ref keeps a re-render from
   * counting the same card twice.
   */
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    // A failed count must never break the deck; the advertiser is simply not
    // billed for a view we could not record.
    void recordAdImpression(ad.id, deviceKey).catch(() => {});
  }, [ad.id, deviceKey]);

  function open() {
    void recordAdClick(ad.id, deviceKey).catch(() => {});
    // Linking refuses anything the OS will not open, and the database has
    // already rejected any scheme but http(s).
    void Linking.openURL(ad.clickUrl).catch(() => {});
  }

  function fling(direction: -1 | 1) {
    gone.value = withTiming(direction, { duration: motion.cardExit });
    dx.value = withTiming(direction * width * 1.2, { duration: motion.cardExit });
  }

  const pan = Gesture.Pan()
    .activeOffsetX([-H_ACTIVATE, H_ACTIVATE])
    .onChange((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY * 0.2;
    })
    .onEnd((e) => {
      const past = Math.abs(e.translationX) > threshold
        || Math.abs(e.velocityX) > VELOCITY_ESCAPE;
      if (past) {
        const direction = e.translationX > 0 ? 1 : -1;
        runOnJS(fling)(direction as -1 | 1);
        runOnJS(onDismiss)();
      } else {
        dx.value = withSpring(0, { damping: 18, stiffness: 220 });
        dy.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: dy.value }],
    opacity: interpolate(Math.abs(dx.value), [0, width], [1, 0.2], 'clamp'),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[s.card, cardStyle]}>
        <RecipeCover uri={ad.imageUrl} seed={ad.id} style={StyleSheet.absoluteFill}>
          <LinearGradient
            colors={['rgba(6,10,8,0.55)', 'rgba(6,10,8,0.10)', 'rgba(6,10,8,0.94)']}
            locations={[0, 0.35, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </RecipeCover>

        {/* §38: paid placement is always visually distinguishable. */}
        <View style={s.sponsored} pointerEvents="none">
          <Text style={s.sponsoredLabel}>SPONSORED</Text>
        </View>

        <View style={s.content}>
          <Text style={s.advertiser} numberOfLines={1}>{ad.advertiser}</Text>
          <Text style={s.headline} numberOfLines={3}>{ad.headline}</Text>
          {ad.body ? <Text style={s.body} numberOfLines={3}>{ad.body}</Text> : null}

          <Pressable
            onPress={open}
            accessibilityRole="link"
            accessibilityLabel={`${ad.ctaLabel}, opens ${ad.advertiser} in your browser`}
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.75 }]}
          >
            <Text style={s.ctaLabel}>{ad.ctaLabel}</Text>
            <Feather name="external-link" size={15} color={colors.onMint} />
          </Pressable>

          {/* An ad you cannot get past is worse than no ad, and not everyone
              swipes. §8.2 asks for a button behind every gesture. */}
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Skip this ad"
            hitSlop={10}
            style={({ pressed }) => [s.skip, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.skipLabel}>Skip</Text>
          </Pressable>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  card: {
    ...fill,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  sponsored: {
    position: 'absolute', top: space.lg, left: space.lg,
    paddingHorizontal: space.md, paddingVertical: 5, borderRadius: radius.sm,
    backgroundColor: 'rgba(6,10,8,0.72)',
  },
  sponsoredLabel: { ...type.micro, color: colors.text },

  content: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: space.xl, gap: space.sm,
  },
  advertiser: { ...type.micro, color: colors.mint },
  headline: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.textMuted, lineHeight: 21 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.sm, marginTop: space.md,
    paddingVertical: space.lg, borderRadius: radius.md,
    backgroundColor: colors.mint,
  },
  ctaLabel: { ...type.bodyStrong, color: colors.onMint },
  skip: { alignSelf: 'center', paddingVertical: space.md, paddingHorizontal: space.xl },
  skipLabel: { ...type.small, color: colors.textMuted },
});
