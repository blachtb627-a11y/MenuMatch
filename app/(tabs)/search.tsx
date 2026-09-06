import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { Header } from './cookbook';
import { supabase } from '@/lib/supabase';
import { formatTotalTime } from '@/lib/timers';
import { colors, fill, radius, space, type } from '@/theme';

type Hit = {
  id: string; title: string; cover_image_url: string | null;
  total_minutes: number; cuisine: string | null;
};

/**
 * §13. Postgres full-text plus trigram, which the spec says is enough to
 * several hundred thousand recipes. Results are a grid, never a swipe deck.
 */
export default function Search() {
  const [query, setQuery] = useState('');
  const [maxMinutes, setMaxMinutes] = useState<number | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (q: string, cap: number | null) => {
    if (q.trim().length < 2) { setHits(null); return; }
    setLoading(true);
    try {
      let req = supabase
        .from('recipes')
        .select('id, title, cover_image_url, total_minutes, cuisine')
        .eq('status', 'published')
        .or(`title.ilike.%${q}%,cuisine.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(30);
      if (cap) req = req.lte('total_minutes', cap);
      const { data } = await req;
      setHits((data ?? []) as Hit[]);
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void run(query, maxMinutes), 220);
    return () => clearTimeout(t);
  }, [query, maxMinutes, run]);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header title="Search" />

        <View style={s.searchRow}>
          <Feather name="search" size={17} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Recipes, ingredients, creators"
            placeholderTextColor={colors.textFaint}
            style={s.input}
            autoCorrect={false}
            accessibilityLabel="Search recipes"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search">
              <Feather name="x" size={17} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <View style={s.filterRow}>
          {[15, 30, 45].map((m) => (
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

        {loading ? (
          <Loading />
        ) : hits === null ? (
          <EmptyState title="Find something to cook"
                      body="Search by dish, ingredient, cuisine or creator." />
        ) : hits.length === 0 ? (
          // §13: empty results must suggest something.
          <EmptyState
            title={`Nothing for "${query}"`}
            body="Try a broader term, or clear the time filter. If nobody has published it yet, that is a gap worth filling."
          />
        ) : (
          <FlatList
            data={hits}
            keyExtractor={(h) => h.id}
            numColumns={2}
            columnWrapperStyle={{ gap: space.md }}
            contentContainerStyle={s.grid}
            renderItem={({ item }) => (
              <Pressable style={s.tile} onPress={() => router.push(`/recipe/${item.id}`)}
                         accessibilityRole="button" accessibilityLabel={item.title}>
                <RecipeCover uri={item.cover_image_url} seed={item.id} title={item.title}
                             style={StyleSheet.absoluteFill} />
                <View style={s.tileScrim} />
                <View style={s.tileText}>
                  <Text style={s.tileTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={s.tileMeta}>{formatTotalTime(item.total_minutes)}</Text>
                </View>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Screen>
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
  filterRow: { flexDirection: 'row', gap: space.sm, padding: space.xl, paddingBottom: space.md },
  filter: {
    paddingHorizontal: space.lg, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  filterOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  filterLabel: { ...type.small, color: colors.textMuted },
  grid: { padding: space.xl, paddingTop: 0, gap: space.md },
  tile: {
    flex: 1, aspectRatio: 0.78, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.surface, marginBottom: space.md, justifyContent: 'flex-end',
  },
  tileScrim: { ...fill, backgroundColor: 'rgba(6,10,8,0.35)' },
  tileText: { padding: space.md, gap: 2 },
  tileTitle: { ...type.bodyStrong, color: colors.text },
  tileMeta: { ...type.small, color: colors.textMuted },
});
