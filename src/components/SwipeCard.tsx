import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { RecipeCover } from './RecipeCover';
import { colors, fill, motion, radius, space, type } from '@/theme';
import { formatTotalTime } from '@/lib/timers';
import type { RecipeCard as Card, SwipeAction } from '@/lib/types';

/**
 * The deck card (§8.1).
 *
 * On §18.3: the composition is MenuMatch's own. Food photography is the
 * dominant element with the content anchored to the bottom edge, and drag
 * feedback is a colour wash plus a growing edge indicator — deliberately not a
 * stamp overlay, and with no rotation-and-fling physics.
 */

const SWIPE_FRACTION = 0.28;
const VELOCITY_ESCAPE = 800;

export function SwipeCard({
  card, onAction, onOpen, interactive,
}: {
  card: Card;
  onAction: (action: SwipeAction) => void;
  onOpen: () => void;
  interactive: boolean;
}) {
  const { width } = useWindowDimensions();
  const threshold = width * SWIPE_FRACTION;

  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const gone = useSharedValue(0);

  const complete = (action: SwipeAction) => {
    onAction(action);
  };

  const pan = Gesture.Pan()
    .enabled(interactive)
    .onChange((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY * 0.2;
    })
    .onEnd((e) => {
      const escaped =
        Math.abs(dx.value) > threshold || Math.abs(e.velocityX) > VELOCITY_ESCAPE;
      if (escaped) {
        const toRight = dx.value > 0 || e.velocityX > 0;
        gone.value = 1;
        dx.value = withTiming(toRight ? width * 1.4 : -width * 1.4, {
          duration: motion.cardExit,
        });
        runOnJS(complete)(toRight ? 'save' : 'pass');
      } else {
        dx.value = withSpring(0, { damping: 20, stiffness: 220 });
        dy.value = withSpring(0, { damping: 20, stiffness: 220 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value },
      { translateY: dy.value },
      { scale: interpolate(Math.abs(dx.value), [0, threshold], [1, 0.97], 'clamp') },
    ],
  }));

  // A soft wash in the direction of travel: mint to save, clay to pass.
  const saveWash = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [0, threshold], [0, 0.5], 'clamp'),
  }));
  const passWash = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [-threshold, 0], [0.5, 0], 'clamp'),
  }));
  const saveEdge = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [0, threshold * 0.4], [0, 1], 'clamp'),
    transform: [{ scaleY: interpolate(dx.value, [0, threshold], [0.4, 1], 'clamp') }],
  }));
  const passEdge = useAnimatedStyle(() => ({
    opacity: interpolate(dx.value, [-threshold * 0.4, 0], [1, 0], 'clamp'),
    transform: [{ scaleY: interpolate(dx.value, [-threshold, 0], [1, 0.4], 'clamp') }],
  }));

  const visibleTags = card.tags
    .filter((t) => t.type === 'dietary' || t.type === 'equipment' || t.type === 'occasion')
    .slice(0, 3);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[s.card, cardStyle]}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${card.title} by ${card.creator.displayName}`}
          accessibilityHint="Opens the full recipe"
          style={StyleSheet.absoluteFill}
        >
          <RecipeCover uri={card.coverImageUrl} seed={card.id} title={card.title}
                       style={StyleSheet.absoluteFill}>
            <LinearGradient
              colors={['transparent', 'rgba(6,10,8,0.30)', 'rgba(6,10,8,0.92)']}
              locations={[0.32, 0.58, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          </RecipeCover>

          <Animated.View style={[StyleSheet.absoluteFill, s.washSave, saveWash]} pointerEvents="none" />
          <Animated.View style={[StyleSheet.absoluteFill, s.washPass, passWash]} pointerEvents="none" />
          <Animated.View style={[s.edge, s.edgeRight, saveEdge]} pointerEvents="none" />
          <Animated.View style={[s.edge, s.edgeLeft, passEdge]} pointerEvents="none" />

          {card.isSponsored ? (
            // §38: paid placement is always visually distinguishable.
            <View style={s.sponsored}><Text style={s.sponsoredLabel}>SPONSORED</Text></View>
          ) : null}

          <View style={s.content} pointerEvents="none">
            <View style={s.creatorRow}>
              <View style={s.avatar}>
                <Text style={s.avatarLetter}>
                  {card.creator.displayName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <Text style={s.creatorName} numberOfLines={1}>{card.creator.displayName}</Text>
              {card.creator.isSeedAccount ? (
                // §5.3: company-operated accounts are labeled, never disguised.
                <View style={s.seedBadge}><Text style={s.seedBadgeLabel}>MENUMATCH</Text></View>
              ) : null}
            </View>

            <Text style={s.title} numberOfLines={3}>{card.title}</Text>

            <View style={s.metaRow}>
              <Text style={s.meta}>{formatTotalTime(card.totalMinutes)}</Text>
              {card.cuisine ? <><Text style={s.dot}>·</Text><Text style={s.meta}>{card.cuisine}</Text></> : null}
              {card.difficulty ? <><Text style={s.dot}>·</Text><Text style={s.meta}>{card.difficulty}</Text></> : null}
            </View>

            {visibleTags.length ? (
              <View style={s.tagRow}>
                {visibleTags.map((t) => (
                  <View key={t.slug} style={s.tag}>
                    <Text style={s.tagLabel}>{t.name}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </Pressable>
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
  washSave: { backgroundColor: colors.mint },
  washPass: { backgroundColor: colors.clay },
  edge: { position: 'absolute', top: '18%', bottom: '18%', width: 6, borderRadius: 3 },
  edgeRight: { right: 10, backgroundColor: colors.mint },
  edgeLeft: { left: 10, backgroundColor: colors.clay },

  sponsored: {
    position: 'absolute', top: space.lg, left: space.lg,
    backgroundColor: 'rgba(6,10,8,0.75)', paddingHorizontal: space.md,
    paddingVertical: 5, borderRadius: radius.sm,
  },
  sponsoredLabel: { ...type.micro, color: colors.textMuted },

  content: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.xl, gap: space.sm },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatar: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.mintDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { ...type.small, color: colors.mint, fontWeight: '700' },
  creatorName: { ...type.small, color: colors.text, flexShrink: 1 },
  seedBadge: {
    backgroundColor: colors.mintWash, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.sm,
  },
  seedBadgeLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7, color: colors.mint },

  title: { ...type.display, color: colors.text, lineHeight: 34 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  meta: { ...type.small, color: colors.textMuted, textTransform: 'capitalize' },
  dot: { color: colors.textFaint },
  tagRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.xs },
  tag: {
    backgroundColor: 'rgba(255,255,255,0.13)', paddingHorizontal: space.md,
    paddingVertical: 5, borderRadius: radius.pill,
  },
  tagLabel: { ...type.small, color: colors.text },
});
