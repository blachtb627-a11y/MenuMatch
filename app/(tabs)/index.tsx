import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SwipeCard, type SwipeCardHandle } from '@/components/SwipeCard';
import { Toast } from '@/components/Toast';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { LessLikeThisSheet } from '@/components/LessLikeThisSheet';
import { useDeck } from '@/state/deck';
import { useSession } from '@/state/session';
import { fetchRecipe } from '@/lib/api';
import { AdCard } from '@/components/AdCard';
import { FilterBar } from '@/components/FilterBar';
import { FilterSheet } from '@/components/FilterSheet';
import {
  NO_FILTERS, describeDeck, isFiltered, type DeckFilters,
} from '@/lib/filters';
import { loadFilters, saveFilters } from '@/lib/filterStorage';
import { fetchAd, type ServedAd } from '@/lib/ads';
import { getDeviceKey } from '@/lib/device';
import { colors, fill, motion, radius, space, type, elevate } from '@/theme';
import type { Recipe, RecipeCard, SwipeAction } from '@/lib/types';

/**
 * A long session swipes through hundreds of recipes and every one of them is a
 * few kilobytes of steps and ingredients, so the cache is bounded. Insertion
 * order is oldest-first, and undo only ever goes back one card.
 */
const DETAIL_CACHE = 40;

function keepRecent(all: Record<string, Recipe>): Record<string, Recipe> {
  const rows = Object.entries(all);
  if (rows.length <= DETAIL_CACHE) return all;
  return Object.fromEntries(rows.slice(rows.length - DETAIL_CACHE));
}

export default function Discover() {
  const { isGuest, setPendingSave } = useSession();
  const [toast, setToast] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<RecipeCard | null>(null);

  /**
   * Meal, time and diet, combined. The deck itself always asks for the ranked
   * personal feed and narrows it — there is no longer a category to be "in",
   * which is what let the three dimensions fight over one slot.
   *
   * Restored from the last session, because re-picking "lunch, under 30" every
   * time the app is opened is a worse failure than finding it still on — and
   * the bar above the deck says what is on, in full, at all times.
   */
  const [filters, setFilters] = useState<DeckFilters | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    void loadFilters()
      .then(setFilters)
      .catch(() => setFilters(NO_FILTERS));
  }, []);

  const deck = useDeck('for_you', isGuest, filters);
  // Everything below reads the settled selection; null only means "still
  // reading", and the deck is showing its loading state until then.
  const active = filters ?? NO_FILTERS;

  const applyFilters = useCallback((next: DeckFilters) => {
    setFilters(next);
    void saveFilters(next);
  }, []);

  const top = deck.cards[0];
  const next = deck.cards[1];

  /**
   * How far the front card has travelled, -1 to 1, written every frame by the
   * card itself. The card underneath reads it and comes forward as the front
   * one leaves, which is the whole reason the deck reads as a stack of
   * objects rather than one card on a dark background.
   */
  const dragProgress = useSharedValue(0);
  const cardRef = useRef<SwipeCardHandle>(null);

  /**
   * Settling after the deck advances.
   *
   * At full progress the card underneath sits exactly where the front card
   * sits, so it is completely hidden by it — which is what makes the handoff
   * invisible. The card that takes its place behind starts out hidden in the
   * same way and slides down into its resting peek, so the stack refills
   * rather than blinking into existence.
   */
  useEffect(() => {
    dragProgress.value = withTiming(0, { duration: motion.settle });
  }, [top?.id, dragProgress]);

  /**
   * The full recipe for the card in front, so it can be read by scrolling
   * rather than by tapping through.
   *
   * Kept per id rather than as one slot, so going back with undo does not
   * re-fetch, and fetched for the card behind as well — by the time someone
   * has swiped, its details are already there and the scroll never waits.
   * fetchRecipe caches, so a second visit costs nothing.
   */
  const [details, setDetails] = useState<Record<string, Recipe>>({});

  /**
   * Paid placement (§38). The ad is a layer over the deck rather than an entry
   * in it: the ranker, the undo stack and the save/pass counters all stay
   * about recipes, and an ad can never be undone back into view or counted as
   * a recipe someone passed on.
   *
   * How often it appears is the campaign's own deckInterval, so a light
   * campaign can ask to be rarer without a deploy.
   */
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [adVisible, setAdVisible] = useState(false);
  const [deviceKey, setDeviceKey] = useState<string | null>(null);
  const swipes = useRef(0);
  const nextAdAt = useRef(Number.POSITIVE_INFINITY);

  useEffect(() => {
    void getDeviceKey().then(setDeviceKey).catch(() => {});
  }, []);

  // Fetched ahead of the slot it will fill, so the ad never makes the deck
  // wait. A null answer means nothing is eligible — no campaign, none running,
  // or this person has already seen today's share.
  useEffect(() => {
    if (ad || adVisible) return;
    void fetchAd(deviceKey)
      .then((next) => {
        if (!next) return;
        setAd(next);
        nextAdAt.current = swipes.current + next.deckInterval;
      })
      .catch(() => {});
  }, [ad, adVisible, deviceKey]);

  useEffect(() => {
    const wanted = [top?.id, next?.id].filter(
      (id): id is string => !!id && !details[id],
    );
    if (!wanted.length) return;
    let live = true;
    void Promise.all(
      wanted.map((id) =>
        fetchRecipe(id)
          .then((r) => [id, r] as const)
          // A card that will not load its details still swipes; the panel
          // keeps its loading state rather than breaking the deck.
          .catch(() => null),
      ),
    ).then((rows) => {
      if (!live) return;
      const got = rows.filter((r): r is readonly [string, Recipe] => r !== null);
      if (got.length) setDetails((d) => keepRecent({ ...d, ...Object.fromEntries(got) }));
    });
    return () => { live = false; };
  }, [top?.id, next?.id, details]);

  const handle = useCallback(
    async (action: SwipeAction, card?: RecipeCard) => {
      const target = card ?? deck.cards[0];
      if (!target) return;

      // §7 soft gate: a guest browses freely but must have an account to save.
      // The pending save is preserved and applied after signup.
      if (action === 'save' && isGuest) {
        setPendingSave({ recipeId: target.id, source: 'deck' });
        router.push('/auth');
        return;
      }

      // Saving and passing should not feel the same in the hand. Saving is the
      // one that adds something, so it gets the heavier tap.
      void (action === 'save'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.selectionAsync()
      ).catch(() => {});
      swipes.current += 1;
      if (ad && !adVisible && swipes.current >= nextAdAt.current) setAdVisible(true);
      await deck.act(action, target);
      if (action === 'save') setToast(`Saved to your Cookbook`);
    },
    [deck, isGuest, setPendingSave, ad, adVisible],
  );

  /**
   * What the buttons do. They throw the card the same way a drag does rather
   * than deleting it out from under the person: a deck where tapping and
   * swiping look like different apps is a deck with two personalities.
   *
   * The guest gate has to come first, because it navigates away — flinging
   * the card and then leaving the screen would lose it.
   */
  const requestAction = useCallback((action: SwipeAction) => {
    if (action === 'save' && isGuest) {
      void handle(action);
      return;
    }
    if (cardRef.current) cardRef.current.fling(action);
    else void handle(action);
  }, [handle, isGuest]);

  const onUndo = useCallback(async () => {
    const last = deck.lastAction;
    await deck.undo();
    if (last?.action === 'save') setToast('Removed from your Cookbook');
  }, [deck]);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <FilterBar
          filters={active}
          onOpen={() => setSheetOpen(true)}
          onChange={applyFilters}
        />

        {deck.fallback === 'popular_overall' && deck.cards.length > 0 ? (
          <Banner text="You're through these. Here's what's popular." />
        ) : null}
        {deck.fallback === 'category_exhausted' && deck.cards.length > 0 ? (
          <Banner text={`The last of ${describeDeck(active)} for now.`} />
        ) : null}

        <View style={s.deckArea}>
          {deck.loading && deck.cards.length === 0 ? (
            <Loading label="Building your deck" />
          ) : deck.error && deck.cards.length === 0 ? (
            <EmptyState
              title="Could not load the deck"
              body={deck.error}
              action={<Button label="Try again" onPress={deck.reload} />}
            />
          ) : !top ? (
            // §8.3: only shown when every fallback is empty, and it always
            // offers something to do next.
            <EmptyState
              title={isFiltered(active) ? 'Nothing left that matches' : "You're all caught up"}
              body={
                isFiltered(active)
                  // Naming the filters matters: an empty filtered deck and an
                  // empty unfiltered one look identical, and only one of them
                  // is something the person can do anything about.
                  ? `No more ${describeDeck(active)} right now. Widening the filters will turn up more.`
                  : 'Nothing left right now. Try a filter, or search for something specific.'
              }
              action={
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  {isFiltered(active) ? (
                    <Button label="Clear filters" onPress={() => applyFilters(NO_FILTERS)} />
                  ) : (
                    <Button label="Filters" onPress={() => setSheetOpen(true)} />
                  )}
                  <Button label="Search" variant="secondary" onPress={() => router.push('/search')} />
                </View>
              }
            />
          ) : (
            <>
              {/* the card underneath, so the deck reads as a stack */}
              {next ? (
                <BehindCard card={next} progress={dragProgress} />
              ) : null}
              <SwipeCard
                key={top.id}
                card={top}
                details={details[top.id] ?? null}
                interactive={!adVisible}
                progress={dragProgress}
                handleRef={cardRef}
                onAction={(a) => void handle(a, top)}
                onOpen={() => router.push(`/recipe/${top.id}`)}
              />

              {/* Over the stack, not in it. Dismissing clears the ad so the
                  next one is fetched for the interval after this. */}
              {adVisible && ad ? (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  deviceKey={deviceKey}
                  onDismiss={() => { setAdVisible(false); setAd(null); }}
                />
              ) : null}
            </>
          )}
        </View>

        {/* §8.2: every gesture has an equivalent button. This is an
            accessibility requirement, not a nice-to-have. */}
        <View style={s.controls}>
          <ControlButton
            icon="rotate-ccw" label="Undo last action" tone="neutral"
            disabled={!deck.canUndo || adVisible} onPress={onUndo} small
          />
          <ControlButton
            icon="x" label="Pass on this recipe" tone="clay"
            disabled={!top || adVisible} onPress={() => requestAction('pass')}
          />
          <ControlButton
            icon="bookmark" label="Save this recipe" tone="mint"
            disabled={!top || adVisible} onPress={() => requestAction('save')}
          />
          <ControlButton
            icon="more-horizontal" label="More options" tone="neutral"
            disabled={!top || adVisible} onPress={() => setSheetFor(top ?? null)} small
          />
        </View>
      </SafeAreaView>

      <FilterSheet
        visible={sheetOpen}
        value={active}
        onApply={applyFilters}
        onClose={() => setSheetOpen(false)}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <LessLikeThisSheet
        card={sheetFor}
        onClose={() => setSheetFor(null)}
        onRecorded={(msg) => { setSheetFor(null); setToast(msg); }}
      />
    </Screen>
  );
}


/**
 * The card waiting underneath.
 *
 * It used to be a fixed transform, so the stack was a painting of a stack:
 * drag the front card halfway off and nothing behind it moved. Now it rises
 * and brightens in step with the drag, and at full travel it is sitting
 * exactly where the front card was — which is what lets the swap happen
 * without a seam.
 *
 * Non-interactive on purpose. It is scenery until it is the front card.
 */
function BehindCard({
  card, progress,
}: { card: RecipeCard; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const travelled = Math.min(Math.abs(progress.value), 1);
    return {
      opacity: interpolate(travelled, [0, 1], [0.55, 1]),
      transform: [
        { scale: interpolate(travelled, [0, 1], [0.94, 1]) },
        // 30, not the 14 this used to be. Scaling to 0.94 pulls the bottom
        // edge up by about 3% of the card's height — on a phone that is
        // roughly 18pt — so an offset of 14 left the card underneath ending
        // *above* the one in front and completely hidden by it. The stack
        // the comments described was not on the screen. 30 clears the shrink
        // with a sliver to spare on every size we render at.
        { translateY: interpolate(travelled, [0, 1], [30, 0]) },
      ],
    };
  });

  return (
    <Animated.View style={[s.behind, style]} pointerEvents="none">
      <SwipeCard key={card.id} card={card} interactive={false}
                 onAction={() => {}} onOpen={() => {}} />
    </Animated.View>
  );
}


function Banner({ text }: { text: string }) {
  return (
    <View style={s.banner}>
      <Text style={s.bannerText}>{text}</Text>
    </View>
  );
}


const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ControlButton({
  icon, label, tone, onPress, disabled, small,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  tone: 'mint' | 'clay' | 'neutral';
  onPress: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  // A spring rather than a flat scale on `pressed`. The flat version snaps to
  // 0.94 and snaps back, which at this size reads as the button flickering;
  // the spring gives it the small overshoot that makes it feel like something
  // was pushed.
  const press = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(press.value, [0, 1], [1, 0.88]) }],
  }));
  // Pass takes a neutral fill with a clay glyph, not a clay wash: clay at 14%
  // over a near-black ground resolves to #261E15, which reads as mud rather
  // than as a colour. The warmth that §18.3 asks for lives in the mark.
  const palette = {
    mint: { bg: colors.mint, fg: colors.onMint },
    clay: { bg: colors.raised, fg: colors.clay },
    neutral: { bg: colors.surface, fg: colors.textMuted },
  }[tone];
  const size = small ? 46 : 62;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => { press.value = withSpring(1, { damping: 18, stiffness: 420 }); }}
      onPressOut={() => { press.value = withSpring(0, { damping: 12, stiffness: 320 }); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[
        s.control,
        {
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: palette.bg,
        },
        // Only the two full-size controls are lifted; lifting all four would
        // flatten the difference between the actions and the utilities.
        !small && elevate.control,
        disabled ? { opacity: 0.35 } : null,
        pressStyle,
      ]}
    >
      <Feather name={icon} size={small ? 18 : 24} color={palette.fg} />
    </AnimatedPressable>
  );
}

const s = StyleSheet.create({

  banner: {
    marginHorizontal: space.lg, marginBottom: space.sm, paddingHorizontal: space.lg,
    paddingVertical: space.md, backgroundColor: colors.surface, borderRadius: radius.md,
  },
  bannerText: { ...type.small, color: colors.textMuted },

  deckArea: { flex: 1, marginHorizontal: space.lg, marginBottom: space.xl },
  behind: {
    ...fill,
    // The resting scale, offset and opacity live in BehindCard's animated
    // style, because they are the start of a movement rather than a fixed
    // position.
    //
    // The outline is the exception the theme allows itself — "the handful of
    // cases where the outline *is* the control". Measured off a screenshot,
    // the sliver of the card underneath renders at rgb(10,13,15) against a
    // ground of rgb(9,11,10): it is there, and it is invisible. There is no
    // surface to separate by value, because the bottom of every card is
    // deliberately near-black so the title reads over the photograph. So the
    // edge itself is drawn. The card in front covers the other three sides.
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderBright,
  },

  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.lg, paddingBottom: space.md,
  },
  control: { alignItems: 'center', justifyContent: 'center' },
});
