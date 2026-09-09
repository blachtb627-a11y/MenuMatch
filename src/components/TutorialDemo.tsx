import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat,
  withSequence, withTiming,
} from 'react-native-reanimated';
import { useReduceMotion } from '@/lib/a11y';
import { colors, coverGradient, fill, radius, space, type } from '@/theme';

/**
 * A small deck that performs the gesture being described, on a loop.
 *
 * Showing the movement beats naming it: "swipe right" is a phrase people have
 * to translate, and a card visibly leaving toward the Cookbook is not. The
 * mock card is deliberately generic — no photo to load, no recipe to fetch, so
 * the tutorial works before the first request comes back.
 *
 * When the device asks for reduced motion nothing loops; the demo holds the
 * finished state, which is the part that carries the meaning anyway.
 */

export type DemoMode = 'save' | 'pass' | 'scroll';

const CARD_W = 190;
const CARD_H = 250;
/** How far the card travels before it is gone. Past the frame, not to its edge. */
const TRAVEL = 132;

export function TutorialDemo({ mode }: { mode: DemoMode }) {
  const reduceMotion = useReduceMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      // Hold the outcome: the card away, or the recipe up.
      t.value = mode === 'scroll' ? 1 : 0.72;
      return;
    }
    t.value = 0;
    t.value = withRepeat(
      mode === 'scroll'
        ? withSequence(
            withDelay(500, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })),
            withDelay(1000, withTiming(0, { duration: 550, easing: Easing.inOut(Easing.quad) })),
          )
        : withSequence(
            // Out and gone, then straight back to centre — the snap is hidden
            // because the card has already faded by the time it happens, which
            // is also what a real swipe looks like: the next card is there.
            withDelay(600, withTiming(1, { duration: 800, easing: Easing.in(Easing.quad) })),
            withDelay(450, withTiming(0, { duration: 0 })),
          ),
      -1,
      false,
    );
  }, [mode, reduceMotion, t]);

  const dir = mode === 'pass' ? -1 : 1;
  const tone = mode === 'pass' ? colors.clay : colors.mint;

  const frontStyle = useAnimatedStyle(() => {
    if (mode === 'scroll') return {};
    return {
      transform: [
        { translateX: t.value * TRAVEL * dir },
        { translateY: t.value * 10 },
      ],
      opacity: interpolate(t.value, [0, 0.55, 1], [1, 1, 0], 'clamp'),
    };
  });

  // The wash the real card shows while it is being dragged (§18.3).
  const washStyle = useAnimatedStyle(() => ({
    opacity: mode === 'scroll' ? 0 : interpolate(t.value, [0, 0.35, 0.8], [0, 0.5, 0.7], 'clamp'),
  }));

  // The same growing edge bar the real card shows (§18.3) — a stamp overlay
  // would teach a piece of UI that does not exist.
  const edgeStyle = useAnimatedStyle(() => ({
    opacity: mode === 'scroll' ? 0 : interpolate(t.value, [0, 0.3], [0, 1], 'clamp'),
    transform: [{ scaleY: interpolate(t.value, [0, 0.6], [0.4, 1], 'clamp') }],
  }));

  // Where it went. Fades in as the card leaves, because the destination is the
  // half of the gesture that is not obvious from the movement.
  const outcomeStyle = useAnimatedStyle(() => ({
    opacity: mode === 'scroll' ? 0 : interpolate(t.value, [0.45, 0.8], [0, 1], 'clamp'),
  }));

  // The recipe panel rising over the photo, as it does on the deck.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(t.value, [0, 1], [CARD_H * 0.72, CARD_H * 0.3], 'clamp') }],
  }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: mode === 'scroll' ? interpolate(t.value, [0, 0.4], [1, 0], 'clamp') : 0,
  }));

  // A fingertip, so the movement reads as something you do rather than
  // something the app does on its own.
  const fingerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.12, 0.7, 0.95], [0, 1, 1, 0], 'clamp'),
    transform:
      mode === 'scroll'
        ? [{ translateY: interpolate(t.value, [0, 1], [70, -46], 'clamp') }]
        : [{ translateX: interpolate(t.value, [0, 1], [0, TRAVEL * dir], 'clamp') }],
  }));

  return (
    <View style={s.stage} pointerEvents="none" accessible accessibilityLabel={LABELS[mode]}>
      {/* the card underneath, so a card leaving reveals the next one */}
      <View style={[s.card, s.behind]}>
        <MockCover seed="menumatch-behind" />
        <View style={s.cardText}>
          <View style={s.titleBar} />
          <Bar w="44%" />
        </View>
      </View>

      <Animated.View style={[s.card, frontStyle]}>
        <MockCover seed="menumatch-front" />

        {mode === 'scroll' ? (
          <>
            <Animated.View style={[s.sheet, sheetStyle]}>
              <Text style={s.sheetHead}>INGREDIENTS</Text>
              <Bar w="86%" />
              <Bar w="64%" />
              <Bar w="74%" />
              <Text style={s.sheetHead}>METHOD</Text>
              <Bar w="92%" />
              <Bar w="70%" />
            </Animated.View>
            <Animated.View style={[s.hint, hintStyle]}>
              <Feather name="chevron-up" size={11} color={colors.text} />
              <Text style={s.hintLabel}>Scroll</Text>
            </Animated.View>
          </>
        ) : (
          <View style={s.cardText}>
            <View style={s.titleBar} />
            <Bar w="52%" />
          </View>
        )}

        <Animated.View
          style={[fill, { backgroundColor: mode === 'pass' ? colors.clayWash : colors.mintWash }, washStyle]}
        />
        {mode !== 'scroll' ? (
          <Animated.View
            style={[s.edge, mode === 'save' ? s.edgeRight : s.edgeLeft, edgeStyle]}
          />
        ) : null}
      </Animated.View>

      {mode !== 'scroll' ? (
        <Animated.View style={[s.outcome, { borderColor: tone }, outcomeStyle]}>
          <Feather name={mode === 'save' ? 'bookmark' : 'x'} size={13} color={tone} />
          <Text style={[s.outcomeLabel, { color: tone }]}>
            {mode === 'save' ? 'Saved to your Cookbook' : 'Gone from your deck'}
          </Text>
        </Animated.View>
      ) : null}

      <Animated.View style={[s.finger, fingerStyle]} />
    </View>
  );
}

const LABELS: Record<DemoMode, string> = {
  save: 'Animation: a recipe card sliding to the right and away, marked as saved.',
  pass: 'Animation: a recipe card sliding to the left and away, passed on.',
  scroll: 'Animation: a recipe card with its ingredients and method sliding up over the photo.',
};

/** A card-shaped block of food-toned colour, in place of a photo. */
function MockCover({ seed }: { seed: string }) {
  const [a, b] = coverGradient(seed);
  return (
    <>
      <LinearGradient colors={[a, b]} style={fill} />
      <LinearGradient
        colors={['transparent', 'rgba(6,10,8,0.85)']}
        locations={[0.45, 1]}
        style={fill}
      />
    </>
  );
}

function Bar({ w }: { w: `${number}%` }) {
  return <View style={[s.bar, { width: w }]} />;
}

const s = StyleSheet.create({
  stage: { height: CARD_H + 66, alignItems: 'center', justifyContent: 'flex-start' },
  card: {
    width: CARD_W, height: CARD_H, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'flex-end',
  },
  behind: { position: 'absolute', top: 0, transform: [{ scale: 0.93 }, { translateY: 18 }], opacity: 0.55 },

  cardText: { padding: space.lg, gap: space.sm },
  titleBar: { height: 11, width: '78%', borderRadius: 3, backgroundColor: colors.text, opacity: 0.85 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.textMuted, opacity: 0.45 },

  sheet: {
    ...fill, top: 0, paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm,
    backgroundColor: colors.ground, borderTopWidth: 1, borderTopColor: colors.border,
  },
  sheetHead: { ...type.micro, color: colors.mint, fontSize: 9, marginTop: space.xs },
  hint: {
    position: 'absolute', bottom: space.lg, alignSelf: 'center', flexDirection: 'row',
    alignItems: 'center', gap: 3, paddingHorizontal: space.sm, paddingVertical: 4,
    borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.18)',
  },
  hintLabel: { ...type.small, fontSize: 11, color: colors.text, fontWeight: '600' },

  edge: { position: 'absolute', top: '18%', bottom: '18%', width: 6, borderRadius: 3 },
  edgeRight: { right: 10, backgroundColor: colors.mint },
  edgeLeft: { left: 10, backgroundColor: colors.clay },

  outcome: {
    position: 'absolute', bottom: 0, flexDirection: 'row', alignItems: 'center',
    gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderWidth: 1,
    borderRadius: radius.pill, backgroundColor: colors.ground,
  },
  outcomeLabel: { ...type.small, fontWeight: '700' },
  finger: {
    // Anchored to the middle of the card, since the stack now sits at the top
    // of the stage to leave room for the caption underneath.
    position: 'absolute', top: CARD_H / 2 - 17,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(236,242,239,0.22)', borderWidth: 1.5,
    borderColor: 'rgba(236,242,239,0.55)',
  },
});
