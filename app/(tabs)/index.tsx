import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SwipeCard } from '@/components/SwipeCard';
import { Toast } from '@/components/Toast';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { LessLikeThisSheet } from '@/components/LessLikeThisSheet';
import { useDeck } from '@/state/deck';
import { useSession } from '@/state/session';
import { fetchConfig, fetchRecipe } from '@/lib/api';
import { AdCard } from '@/components/AdCard';
import { fetchAd, type ServedAd } from '@/lib/ads';
import { getDeviceKey } from '@/lib/device';
import { colors, fill, radius, space, type } from '@/theme';
import type { Category, Recipe, RecipeCard, SwipeAction } from '@/lib/types';

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('for_you');
  const [toast, setToast] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<RecipeCard | null>(null);

  const deck = useDeck(category, isGuest);

  useEffect(() => {
    void fetchConfig()
      .then((c) => setCategories(c.categories))
      .catch(() => setCategories([{ slug: 'for_you', label: 'For You', description: null }]));
  }, []);

  const top = deck.cards[0];
  const next = deck.cards[1];

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

      void Haptics.selectionAsync().catch(() => {});
      swipes.current += 1;
      if (ad && !adVisible && swipes.current >= nextAdAt.current) setAdVisible(true);
      await deck.act(action, target);
      if (action === 'save') setToast(`Saved to your Cookbook`);
    },
    [deck, isGuest, setPendingSave, ad, adVisible],
  );

  const onUndo = useCallback(async () => {
    const last = deck.lastAction;
    await deck.undo();
    if (last?.action === 'save') setToast('Removed from your Cookbook');
  }, [deck]);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <CategoryBar
          categories={categories}
          active={category}
          onSelect={(slug) => setCategory(slug)}
        />

        {deck.fallback === 'popular_overall' && deck.cards.length > 0 ? (
          <Banner text={`You're through ${labelFor(categories, category)}. Here's what's popular.`} />
        ) : null}
        {deck.fallback === 'category_exhausted' && deck.cards.length > 0 ? (
          <Banner text={`The last of ${labelFor(categories, category)} for now.`} />
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
              title="You're all caught up"
              body="Nothing left in this category right now. Try another category, or search for something specific."
              action={
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  <Button label="Browse all" onPress={() => setCategory('for_you')} />
                  <Button label="Search" variant="secondary" onPress={() => router.push('/search')} />
                </View>
              }
            />
          ) : (
            <>
              {/* the card underneath, so the deck reads as a stack */}
              {next ? (
                <View style={s.behind} pointerEvents="none">
                  <SwipeCard key={next.id} card={next} interactive={false}
                             onAction={() => {}} onOpen={() => {}} />
                </View>
              ) : null}
              <SwipeCard
                key={top.id}
                card={top}
                details={details[top.id] ?? null}
                interactive={!adVisible}
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
            disabled={!top || adVisible} onPress={() => void handle('pass')}
          />
          <ControlButton
            icon="bookmark" label="Save this recipe" tone="mint"
            disabled={!top || adVisible} onPress={() => void handle('save')}
          />
          <ControlButton
            icon="more-horizontal" label="More options" tone="neutral"
            disabled={!top || adVisible} onPress={() => setSheetFor(top ?? null)} small
          />
        </View>
      </SafeAreaView>

      <Toast message={toast} onDismiss={() => setToast(null)} />
      <LessLikeThisSheet
        card={sheetFor}
        onClose={() => setSheetFor(null)}
        onRecorded={(msg) => { setSheetFor(null); setToast(msg); }}
      />
    </Screen>
  );
}

function labelFor(categories: Category[], slug: string): string {
  return categories.find((c) => c.slug === slug)?.label ?? 'this category';
}

function Banner({ text }: { text: string }) {
  return (
    <View style={s.banner}>
      <Text style={s.bannerText}>{text}</Text>
    </View>
  );
}

function CategoryBar({
  categories, active, onSelect,
}: { categories: Category[]; active: string; onSelect: (slug: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // A horizontal ScrollView in a flex column will otherwise stretch to fill
      // the available height and take the deck's space with it.
      style={s.catBarOuter}
      contentContainerStyle={s.catBar}
      accessibilityRole="tablist"
    >
      {categories.map((c) => {
        const on = c.slug === active;
        return (
          <Pressable
            key={c.slug}
            onPress={() => onSelect(c.slug)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={c.label}
            style={[s.cat, on && s.catActive]}
          >
            <Text style={[s.catLabel, on && s.catLabelActive]}>{c.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

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
  const palette = {
    mint: { bg: colors.mint, fg: colors.onMint, border: colors.mint },
    clay: { bg: 'transparent', fg: colors.clay, border: colors.clay },
    neutral: { bg: 'transparent', fg: colors.textMuted, border: colors.border },
  }[tone];
  const size = small ? 46 : 62;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        s.control,
        {
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: palette.bg, borderColor: palette.border,
        },
        pressed && { transform: [{ scale: 0.94 }] },
        disabled && { opacity: 0.35 },
      ]}
    >
      <Feather name={icon} size={small ? 18 : 24} color={palette.fg} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  catBarOuter: { flexGrow: 0, flexShrink: 0 },
  catBar: {
    paddingHorizontal: space.lg, paddingVertical: space.md,
    gap: space.sm, alignItems: 'center',
  },
  cat: {
    paddingHorizontal: space.lg, paddingVertical: 9, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  catActive: { backgroundColor: colors.mintWash, borderColor: colors.mint },
  catLabel: { ...type.small, color: colors.textMuted },
  catLabelActive: { color: colors.mint },

  banner: {
    marginHorizontal: space.lg, marginBottom: space.sm, paddingHorizontal: space.lg,
    paddingVertical: space.sm, backgroundColor: colors.surface, borderRadius: radius.md,
  },
  bannerText: { ...type.small, color: colors.textMuted },

  deckArea: { flex: 1, marginHorizontal: space.lg, marginBottom: space.lg },
  behind: {
    ...fill,
    transform: [{ scale: 0.955 }, { translateY: 10 }],
    opacity: 0.55,
  },

  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.lg, paddingBottom: space.md,
  },
  control: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
});
