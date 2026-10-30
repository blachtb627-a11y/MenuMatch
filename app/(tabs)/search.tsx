import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { Header } from './cookbook';
import {
  formatCount, searchAll, type SearchCreator, type SearchRecipe, type SearchResults,
} from '@/lib/search';
import { formatTotalTime } from '@/lib/timers';
import { colors, fill, radius, space, type } from '@/theme';

/**
 * §13. One search across recipes and creators, ranked server-side.
 *
 * No filter chips: a query and a ranked list of what matches it. The server
 * still takes a time cap — search_all keeps the parameter — but nothing in the
 * UI sets one, so the field is the only control and there is nothing to leave
 * switched on by accident.
 */
export default function Search() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  // Bumped on every new query and on retry, so an answer for a query the user
  // has already typed past cannot land on top of the current one.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const q = debounced;
    if (q.length < 2) { setResults(null); setError(null); setLoading(false); return; }
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    searchAll(q, null, controller.signal)
      .then((r) => { if (current) setResults(r); })
      .catch((e) => {
        if (!current) return;
        setError(e instanceof Error ? e.message : 'Could not search just now');
        setResults(null);
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [debounced, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const creators = results?.creators ?? [];
  const recipes = results?.recipes ?? [];
  const nothing = results !== null && creators.length === 0 && recipes.length === 0;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header title="Search" />

        <View style={s.searchRow}>
          <Feather name="search" size={17} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Recipes, ingredients, cuisines, creators"
            placeholderTextColor={colors.textFaint}
            style={s.input}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button"
                       accessibilityLabel="Clear search">
              <Feather name="x" size={17} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={() => router.push('/pantry')}
          accessibilityRole="button"
          accessibilityLabel="Find recipes from what you have in your kitchen"
          style={({ pressed }) => [s.pantryRow, pressed && { opacity: 0.7 }]}
        >
          <View style={s.pantryIcon}>
            <Feather name="box" size={17} color={colors.mint} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.pantryTitle}>What can I make?</Text>
            <Text style={s.pantryBody}>
              Add or scan what you have, and see what it adds up to.
            </Text>
          </View>
          <Feather name="chevron-right" size={17} color={colors.textFaint} />
        </Pressable>

        {error ? (
          <EmptyState title="Search didn’t go through" body={error}
                      action={<Button label="Try again" variant="secondary" onPress={retry} />} />
        ) : loading && results === null ? (
          <Loading />
        ) : results === null ? (
          <EmptyState title="Find something to cook"
                      body="Search by dish, ingredient, cuisine or creator name." />
        ) : nothing ? (
          <EmptyState
            title={`Nothing for “${debounced}”`}
            body="Try a broader term. If nobody has published it yet, that is a gap worth filling."
          />
        ) : (
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {creators.length ? (
              <View style={{ gap: space.sm }}>
                <Text style={s.sectionLabel}>
                  {creators.length === 1 ? 'CREATOR' : 'CREATORS'}
                </Text>
                {creators.map((c) => <CreatorRow key={c.id} creator={c} />)}
              </View>
            ) : null}

            {recipes.length ? (
              <View style={{ gap: space.sm }}>
                {creators.length ? <Text style={s.sectionLabel}>RECIPES</Text> : null}
                <View style={s.grid}>
                  {recipes.map((r) => <RecipeTile key={r.id} recipe={r} />)}
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}

function CreatorRow({ creator }: { creator: SearchCreator }) {
  return (
    <Pressable style={s.creatorRow}
               onPress={() => router.push(`/creator/${creator.id}`)}
               accessibilityRole="button"
               accessibilityLabel={`${creator.displayName}, @${creator.username}`}>
      <View style={s.avatar}>
        <Text style={s.avatarLetter}>
          {(creator.displayName || creator.username).slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.creatorName} numberOfLines={1}>{creator.displayName}</Text>
        <Text style={s.creatorMeta} numberOfLines={1}>
          @{creator.username}
          {creator.isSeedAccount ? ' · Swipzy' : ''}
        </Text>
        <Text style={s.creatorMeta}>
          {creator.recipes} recipe{creator.recipes === 1 ? '' : 's'}
          {' · '}{formatCount(creator.saves)} save{creator.saves === 1 ? '' : 's'}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

function RecipeTile({ recipe }: { recipe: SearchRecipe }) {
  return (
    <Pressable style={s.tile} onPress={() => router.push(`/recipe/${recipe.id}`)}
               accessibilityRole="button" accessibilityLabel={recipe.title}>
      <RecipeCover uri={recipe.coverImageUrl} seed={recipe.id} title={recipe.title}
                   style={StyleSheet.absoluteFill} />
      <View style={s.tileScrim} />
      {recipe.saveCount > 0 ? (
        <View style={s.saveBadge}>
          <Feather name="bookmark" size={10} color={colors.mint} />
          <Text style={s.saveBadgeLabel}>{formatCount(recipe.saveCount)}</Text>
        </View>
      ) : null}
      <View style={s.tileText}>
        <Text style={s.tileTitle} numberOfLines={2}>{recipe.title}</Text>
        <Text style={s.tileMeta} numberOfLines={1}>
          {formatTotalTime(recipe.totalMinutes)} · @{recipe.creator.username}
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pantryRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    marginHorizontal: space.xl, marginBottom: space.md, padding: space.md,
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  pantryIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.mintWash,
    borderWidth: 1, borderColor: colors.mintDeep,
  },
  pantryTitle: { ...type.bodyStrong, color: colors.text },
  pantryBody: { ...type.small, color: colors.textMuted },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    marginHorizontal: space.xl, paddingHorizontal: space.lg, height: 46,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  input: { flex: 1, color: colors.text, fontSize: 15 },
  body: { padding: space.xl, gap: space.xl, paddingBottom: space.xxxl },
  sectionLabel: { ...type.micro, color: colors.textFaint },
  creatorRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.mintDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { ...type.bodyStrong, color: colors.text, fontSize: 18 },
  creatorName: { ...type.bodyStrong, color: colors.text },
  creatorMeta: { ...type.small, color: colors.textMuted },
  // alignItems is not optional; see the same grid in app/creator/[id].tsx.
  // Without it every recipe tile is zero-height on iOS and Android.
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.md },
  tile: {
    // flexGrow stays 0: with one result a growing tile fills the row and
    // becomes a full-width slab taller than the screen.
    flexBasis: '47%', flexGrow: 0, aspectRatio: 0.82,
    borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface,
  },
  tileScrim: { ...fill, backgroundColor: colors.scrim },
  tileText: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.md, gap: 2 },
  tileTitle: { ...type.bodyStrong, color: colors.text },
  tileMeta: { ...type.small, color: colors.textMuted },
  saveBadge: {
    position: 'absolute', top: space.sm, right: space.sm,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.overlay,
  },
  saveBadgeLabel: { fontSize: 11, fontWeight: '700', color: colors.mint },
});
