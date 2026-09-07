import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { Header } from './cookbook';
import {
  formatCount, searchAll, type SearchCreator, type SearchRecipe, type SearchResults,
} from '@/lib/search';
import { formatTotalTime } from '@/lib/timers';
import { colors, fill, radius, space, type } from '@/theme';

const TIME_FILTERS = [15, 30, 45];

type Scope = 'all' | 'recipes' | 'creators';
const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'recipes', label: 'Recipes' },
  { value: 'creators', label: 'Creators' },
];

/**
 * §13. One search across recipes and creators, ranked server-side.
 *
 * The previous version queried the recipes table straight from the client,
 * which meant a creator could never be found however you spelled their name,
 * and the ranking was whatever order Postgres felt like. Both now come from
 * search_all, which ranks on text match and save rate together.
 */
export default function Search() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [maxMinutes, setMaxMinutes] = useState<number | null>(null);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  const run = useCallback(async (q: string, cap: number | null) => {
    if (q.length < 2) { setResults(null); setError(null); return; }
    setLoading(true);
    try {
      setResults(await searchAll(q, cap));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not search just now');
      setResults({ recipes: [], creators: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void run(debounced, maxMinutes); }, [debounced, maxMinutes, run]);

  // A time filter is about recipes; applying it to people would just empty the
  // list for no reason a searcher could infer.
  const creators = useMemo(
    () => (scope === 'recipes' ? [] : results?.creators ?? []),
    [results, scope],
  );
  const recipes = useMemo(
    () => (scope === 'creators' ? [] : results?.recipes ?? []),
    [results, scope],
  );
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

        <View style={s.scopeRow}>
          {SCOPES.map((sc) => (
            <Pressable key={sc.value} onPress={() => setScope(sc.value)}
                       accessibilityRole="tab"
                       accessibilityState={{ selected: scope === sc.value }}
                       style={[s.scope, scope === sc.value && s.scopeOn]}>
              <Text style={[s.scopeLabel, scope === sc.value && { color: colors.mint }]}>
                {sc.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {scope !== 'creators' ? (
          <View style={s.filterRow}>
            {TIME_FILTERS.map((m) => (
              <Pressable
                key={m}
                onPress={() => setMaxMinutes(maxMinutes === m ? null : m)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: maxMinutes === m }}
                style={[s.filter, maxMinutes === m && s.filterOn]}
              >
                <Text style={[s.filterLabel, maxMinutes === m && { color: colors.mint }]}>
                  Under {m} min
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {loading && results === null ? (
          <Loading />
        ) : results === null ? (
          <EmptyState title="Find something to cook"
                      body="Search by dish, ingredient, cuisine or creator name." />
        ) : nothing ? (
          <EmptyState
            title={`Nothing for “${debounced}”`}
            body={maxMinutes
              ? 'Try a broader term, or clear the time filter.'
              : 'Try a broader term. If nobody has published it yet, that is a gap worth filling.'}
          />
        ) : (
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {error ? <Text style={s.error}>{error}</Text> : null}

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
          {creator.isSeedAccount ? ' · MenuMatch' : ''}
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
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    marginHorizontal: space.xl, paddingHorizontal: space.lg, height: 46,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  input: { flex: 1, color: colors.text, fontSize: 15 },
  scopeRow: {
    flexDirection: 'row', gap: space.sm,
    paddingHorizontal: space.xl, paddingTop: space.md,
  },
  scope: {
    paddingHorizontal: space.lg, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  scopeOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  scopeLabel: { ...type.small, color: colors.textMuted },
  filterRow: {
    flexDirection: 'row', gap: space.sm,
    paddingHorizontal: space.xl, paddingTop: space.md,
  },
  filter: {
    paddingHorizontal: space.lg, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  filterOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  filterLabel: { ...type.small, color: colors.textMuted },
  body: { padding: space.xl, gap: space.xl, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
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
