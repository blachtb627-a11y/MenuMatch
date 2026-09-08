import React, { useState } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue,
  withSpring, withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from './RecipeCover';
import { colors, fill, motion, radius, space, type } from '@/theme';
import { formatTotalTime } from '@/lib/timers';
import { renderIngredient } from '@/lib/quantity';
import type { Recipe, RecipeCard as Card, SwipeAction } from '@/lib/types';

/**
 * The deck card (§8.1).
 *
 * On §18.3: the composition is MenuMatch's own. Food photography is the
 * dominant element with the content anchored to the bottom edge, and drag
 * feedback is a colour wash plus a growing edge indicator — deliberately not a
 * stamp overlay, and with no rotation-and-fling physics.
 *
 * The recipe reads on the card itself. The photo is the first screenful and
 * scrolling brings the ingredients and method up over it, because a tap target
 * nobody knows about is the same as no details at all — and the swipe is the
 * one gesture people arrive already knowing. Tapping still opens the full
 * screen, which has the things the card cannot carry: Cook Mode, collections,
 * serving scaling.
 */

const SWIPE_FRACTION = 0.28;
const VELOCITY_ESCAPE = 800;

/**
 * How far a drag must travel before it counts as horizontal, and how far
 * vertically before the card stops trying to claim it. Without both numbers a
 * scroll flicks the card away and a swipe scrolls the recipe.
 */
const H_ACTIVATE = 14;
const V_RELEASE = 10;

export function SwipeCard({
  card, details, onAction, onOpen, interactive,
}: {
  card: Card;
  /** The full recipe, once it has arrived. Null while it is still loading. */
  details?: Recipe | null;
  onAction: (action: SwipeAction) => void;
  onOpen: () => void;
  interactive: boolean;
}) {
  const { width } = useWindowDimensions();
  const threshold = width * SWIPE_FRACTION;
  const [cardHeight, setCardHeight] = useState(0);
  const scrolled = useSharedValue(0);

  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const gone = useSharedValue(0);

  const complete = (action: SwipeAction) => {
    onAction(action);
  };

  const pan = Gesture.Pan()
    .enabled(interactive)
    // Claim only clearly horizontal drags, and let go the moment one turns
    // vertical, so the scroll view underneath gets it instead.
    .activeOffsetX([-H_ACTIVATE, H_ACTIVATE])
    .failOffsetY([-V_RELEASE, V_RELEASE])
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

  // Fades the "scroll for the recipe" cue out as soon as the person does it.
  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrolled.value, [0, 60], [1, 0], 'clamp'),
  }));
  const onScroll = useAnimatedScrollHandler((e) => {
    scrolled.value = e.contentOffset.y;
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[s.card, cardStyle]}
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
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

        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          scrollEnabled={interactive && cardHeight > 0}
          showsVerticalScrollIndicator={false}
          style={StyleSheet.absoluteFill}
        >
          {/* The photo's screenful. Tapping it still opens the full recipe. */}
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={`${card.title} by ${card.creator.displayName}`}
            accessibilityHint="Opens the full recipe. Scroll down to read it here."
            style={[s.hero, cardHeight ? { height: cardHeight } : null]}
          >
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

              <Animated.View style={[s.hint, hintStyle]}>
                <Feather name="chevron-up" size={14} color={colors.text} />
                <Text style={s.hintLabel}>Scroll for the recipe</Text>
              </Animated.View>
            </View>
          </Pressable>

          <RecipeDetails card={card} details={details} onOpen={onOpen} />
        </Animated.ScrollView>

        {/* Above the scroll view so the drag feedback is never scrolled away. */}
        <Animated.View style={[StyleSheet.absoluteFill, s.washSave, saveWash]} pointerEvents="none" />
        <Animated.View style={[StyleSheet.absoluteFill, s.washPass, passWash]} pointerEvents="none" />
        <Animated.View style={[s.edge, s.edgeRight, saveEdge]} pointerEvents="none" />
        <Animated.View style={[s.edge, s.edgeLeft, passEdge]} pointerEvents="none" />
      </Animated.View>
    </GestureDetector>
  );
}

/** What you would otherwise have had to tap through to read. */
function RecipeDetails({
  card, details, onOpen,
}: { card: Card; details?: Recipe | null; onOpen: () => void }) {
  if (!details) {
    return (
      <View style={s.details}>
        <View style={s.detailsLoading}>
          <ActivityIndicator color={colors.mint} size="small" />
          <Text style={s.detailsLoadingLabel}>Getting the recipe…</Text>
        </View>
      </View>
    );
  }

  const n = details.nutrition;
  return (
    <View style={s.details}>
      {details.description ? (
        <Text style={s.description}>{details.description}</Text>
      ) : null}

      <View style={s.statRow}>
        <Stat label="PREP" value={formatTotalTime(details.prepMinutes)} />
        <Stat label="COOK" value={formatTotalTime(details.cookMinutes)} />
        <Stat label="SERVES" value={String(details.servings)} />
      </View>

      {n && (n.calories != null || n.proteinG != null) ? (
        <View style={s.nutrition}>
          <Text style={s.nutritionHead}>
            {n.perServing === false ? 'WHOLE RECIPE' : 'PER SERVING'}
          </Text>
          <View style={s.statRow}>
            {n.calories != null ? <Stat label="CALORIES" value={String(n.calories)} /> : null}
            {n.proteinG != null ? <Stat label="PROTEIN" value={`${n.proteinG}g`} /> : null}
            {n.carbsG != null ? <Stat label="CARBS" value={`${n.carbsG}g`} /> : null}
            {n.fatG != null ? <Stat label="FAT" value={`${n.fatG}g`} /> : null}
          </View>
        </View>
      ) : null}

      <Text style={s.sectionTitle}>Ingredients</Text>
      {details.ingredients.map((row) => (
        <Text key={row.id} style={s.line}>
          {renderIngredient(row, details.servings, details.servings)}
        </Text>
      ))}

      <Text style={s.sectionTitle}>Method</Text>
      {details.steps.map((step, i) => (
        <View key={step.id} style={s.step}>
          <Text style={s.stepNumber}>{i + 1}</Text>
          <Text style={s.stepText}>{step.instruction}</Text>
        </View>
      ))}

      {details.attribution ? (
        <Text style={s.attribution}>{details.attribution}</Text>
      ) : null}

      {/* Cook Mode, collections and serving scaling only exist on the full
          screen, so the card says so rather than pretending to be it. */}
      <Pressable onPress={onOpen} accessibilityRole="button"
                 accessibilityLabel={`Open ${card.title} in full`}
                 style={({ pressed }) => [s.openRow, pressed && { opacity: 0.6 }]}>
        <Text style={s.openLabel}>Open full recipe</Text>
        <Feather name="arrow-right" size={16} color={colors.mint} />
      </Pressable>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
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

  hero: { justifyContent: 'flex-end' },
  content: { padding: space.xl, gap: space.sm },
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: space.md, paddingHorizontal: space.md, paddingVertical: 7,
    borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.16)',
  },
  hintLabel: { ...type.small, color: colors.text, fontWeight: '600' },

  details: {
    backgroundColor: colors.ground, padding: space.xl, gap: space.md,
    borderTopWidth: 1, borderTopColor: colors.border, minHeight: 240,
  },
  detailsLoading: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  detailsLoadingLabel: { ...type.small, color: colors.textMuted },
  description: { ...type.body, color: colors.textMuted, lineHeight: 23 },
  statRow: { flexDirection: 'row', gap: space.xl, flexWrap: 'wrap' },
  statLabel: { ...type.micro, color: colors.textFaint },
  statValue: { ...type.bodyStrong, color: colors.text },
  nutrition: {
    gap: space.sm, padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  nutritionHead: { ...type.micro, color: colors.textFaint },
  sectionTitle: { ...type.heading, color: colors.text, marginTop: space.sm },
  line: { ...type.body, color: colors.textMuted, lineHeight: 24 },
  step: { flexDirection: 'row', gap: space.md },
  stepNumber: { ...type.small, color: colors.mint, fontWeight: '700', width: 16 },
  stepText: { ...type.body, color: colors.textMuted, lineHeight: 24, flex: 1 },
  attribution: { ...type.small, color: colors.textFaint, lineHeight: 19, marginTop: space.sm },
  openRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.sm, marginTop: space.md, paddingVertical: space.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.mintDeep,
  },
  openLabel: { ...type.bodyStrong, color: colors.mint },
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
