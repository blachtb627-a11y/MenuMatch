import React, { useCallback, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Screen } from '@/components/ui';
import { TutorialDemo, type DemoMode } from '@/components/TutorialDemo';
import { goBack } from '@/lib/nav';
import { colors, radius, space, type } from '@/theme';

/**
 * How MenuMatch works, in four screens.
 *
 * The deck is the whole app and it is driven by two gestures people have to be
 * told about once. Nobody reads a manual, so each step is one sentence next to
 * a loop of the gesture actually happening, and the whole thing is swiped
 * through — which is itself the gesture being taught.
 *
 * Shown once, after the taste pass, and repeatable from Profile. Skipping is
 * always one tap away: a tutorial you cannot leave is worse than none.
 */

export const TUTORIAL_KEY = 'menumatch.tutorial.v1';

type Step = {
  key: string;
  demo?: DemoMode;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    key: 'save',
    demo: 'save',
    title: 'Swipe right to save',
    body: 'It lands in your Cookbook, with the full method and Cook Mode ready when you are.',
  },
  {
    key: 'pass',
    demo: 'pass',
    title: 'Swipe left to pass',
    body: 'Not tonight. The card is gone, and your deck starts showing you fewer like it.',
  },
  {
    key: 'scroll',
    demo: 'scroll',
    title: 'Scroll to read it',
    body: 'Ingredients, times and every step are right on the card. Tap it for Cook Mode and serving sizes.',
  },
  {
    key: 'rest',
    title: "That's the whole thing",
    body: 'Prefer buttons? The row under the deck does everything the swipes do.',
  },
];

const CLOSERS: { icon: keyof typeof Feather.glyphMap; text: string }[] = [
  { icon: 'rotate-ccw', text: 'Swiped by mistake? Undo brings the card straight back.' },
  { icon: 'book-open', text: 'Everything you save lives in your Cookbook, online or off.' },
  { icon: 'plus-square', text: 'Got a recipe of your own? Post it from Create.' },
];

export default function Tutorial() {
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const isReplay = replay === '1';
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const last = index === STEPS.length - 1;

  const finish = useCallback(() => {
    // Never block leaving on the write; the worst case is seeing this again.
    void AsyncStorage.setItem(TUTORIAL_KEY, '1').catch(() => {});
    if (isReplay) goBack('/(tabs)');
    else router.replace('/(tabs)');
  }, [isReplay]);

  const goTo = useCallback((i: number) => {
    scroller.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  }, [width]);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={s.top}>
          {isReplay || !last ? (
            <Pressable
              onPress={finish}
              accessibilityRole="button"
              accessibilityLabel={isReplay ? 'Close' : 'Skip the tutorial'}
              hitSlop={12}
              style={({ pressed }) => [s.skip, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.skipLabel}>{isReplay ? 'Close' : 'Skip'}</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
          }
          style={{ flex: 1 }}
        >
          {STEPS.map((step) => (
            <View key={step.key} style={[s.page, { width }]}>
              {step.demo ? <TutorialDemo mode={step.demo} /> : null}

              <View style={s.copy}>
                <Text style={s.title}>{step.title}</Text>
                <Text style={s.body}>{step.body}</Text>
              </View>

              {step.demo ? null : (
                <View style={s.closers}>
                  {CLOSERS.map((c) => (
                    <View key={c.icon} style={s.closer}>
                      <View style={s.closerIcon}>
                        <Feather name={c.icon} size={18} color={colors.mint} />
                      </View>
                      <Text style={s.closerText}>{c.text}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={s.footer}>
          <View
            style={s.dots}
            accessibilityRole="progressbar"
            accessibilityLabel={`Step ${index + 1} of ${STEPS.length}`}
          >
            {STEPS.map((step, i) => (
              <Pressable
                key={step.key}
                onPress={() => goTo(i)}
                accessibilityRole="button"
                accessibilityLabel={`Go to step ${i + 1}: ${step.title}`}
                hitSlop={10}
              >
                <View style={[s.dot, i === index && s.dotActive]} />
              </Pressable>
            ))}
          </View>

          <Button
            label={last ? (isReplay ? 'Back to cooking' : 'Start swiping') : 'Next'}
            onPress={() => (last ? finish() : goTo(index + 1))}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { height: 44, justifyContent: 'center', paddingHorizontal: space.xl },
  skip: { alignSelf: 'flex-end', padding: space.sm },
  skipLabel: { ...type.small, color: colors.textMuted },

  page: { flex: 1, paddingHorizontal: space.xl, justifyContent: 'center', gap: space.xl },
  copy: { gap: space.md },
  title: { ...type.display, color: colors.text },
  body: { ...type.body, color: colors.textMuted, lineHeight: 23, maxWidth: 380 },

  closers: { gap: space.lg },
  closer: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  closerIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.mintWash, borderWidth: 1, borderColor: colors.mintDeep,
  },
  closerText: { ...type.body, color: colors.textMuted, lineHeight: 21, flex: 1 },

  footer: {
    padding: space.xl, gap: space.xl,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  dots: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  dot: {
    width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.mint, width: 20 },
});
