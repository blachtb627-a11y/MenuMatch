import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { fetchCookbook, fetchCollections, createCollection, type Collection, type SavedRecipe } from '@/lib/api';
import { onQueueChange, pendingCount, drain } from '@/lib/queue';
import { useSession } from '@/state/session';
import { formatTotalTime } from '@/lib/timers';
import { colors, fill, radius, space, type } from '@/theme';

/** §12. Terminology per §3: this is the Cookbook, not a library. */
export default function Cookbook() {
  const { isGuest } = useSession();
  const [saved, setSaved] = useState<SavedRecipe[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [pending, setPending] = useState(pendingCount());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isGuest) { setSaved([]); return; }
    try {
      const [recipes, cols] = await Promise.all([fetchCookbook(), fetchCollections()]);
      setSaved(recipes);
      setCollections(cols);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your Cookbook');
      setSaved([]);
    }
  }, [isGuest]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => onQueueChange(setPending), []);

  if (isGuest) {
    return (
      <Screen><SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header title="Cookbook" />
        <EmptyState
          title="Your saved recipes live here"
          body="Create a free account to keep the recipes you save. Everything you have swiped so far comes with you."
          action={<Button label="Create an account" onPress={() => router.push('/auth')} />}
        />
      </SafeAreaView></Screen>
    );
  }

  if (saved === null) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header title="Cookbook" subtitle={`${saved.length} saved`} />

        {/* §23.2 / §27: writes queued offline are visible rather than silent. */}
        {pending > 0 ? (
          <Pressable onPress={() => void drain()} style={s.pendingBar} accessibilityRole="button">
            <Feather name="upload-cloud" size={14} color={colors.textMuted} />
            <Text style={s.pendingText}>
              {pending} change{pending === 1 ? '' : 's'} waiting to sync. Tap to retry.
            </Text>
          </Pressable>
        ) : null}

        {error ? <Text style={s.error}>{error}</Text> : null}

        <FlatList
          data={saved}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: space.md }}
          contentContainerStyle={s.grid}
          ListHeaderComponent={
            <CollectionsRow
              collections={collections}
              onCreate={async (name) => { await createCollection(name); void load(); }}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title="Nothing saved yet"
              body="Swipe right on a recipe, or tap the save control on any recipe page."
              action={<Button label="Open the deck" onPress={() => router.push('/(tabs)')} />}
            />
          }
          renderItem={({ item }) => <SavedTile item={item} />}
        />
      </SafeAreaView>
    </Screen>
  );
}

function SavedTile({ item }: { item: SavedRecipe }) {
  // §17: a removed recipe stays in the Cookbook with a clear state.
  if (item.unavailable) {
    return (
      <View style={[s.tile, s.tileUnavailable]}>
        <Feather name="alert-circle" size={20} color={colors.textFaint} />
        <Text style={s.unavailableText}>No longer available</Text>
      </View>
    );
  }
  return (
    <Pressable
      style={s.tile}
      onPress={() => router.push(`/recipe/${item.id}`)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <RecipeCover uri={item.coverImageUrl} seed={item.id} title={item.title}
                   style={StyleSheet.absoluteFill} />
      <View style={s.tileScrim} />
      <View style={s.tileText}>
        <Text style={s.tileTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={s.tileMeta}>{formatTotalTime(item.totalMinutes)}</Text>
      </View>
    </Pressable>
  );
}

function CollectionsRow({
  collections, onCreate,
}: { collections: Collection[]; onCreate: (name: string) => Promise<void> }) {
  // §12: default suggestions offered on first collection creation.
  const suggestions = ['Weeknight Dinners', 'Meal Prep', 'Want to Try', 'Desserts']
    .filter((name) => !collections.some((c) => c.name === name));

  return (
    <View style={{ gap: space.md, marginBottom: space.lg }}>
      <Text style={s.sectionLabel}>COLLECTIONS</Text>
      <View style={s.collectionWrap}>
        {collections.map((c) => (
          <View key={c.id} style={s.collection}>
            <Text style={s.collectionName}>{c.name}</Text>
            <Text style={s.collectionCount}>{c.recipeCount}</Text>
          </View>
        ))}
        {collections.length === 0
          ? suggestions.slice(0, 4).map((name) => (
              <Pressable key={name} style={[s.collection, s.collectionSuggested]}
                         onPress={() => void onCreate(name)} accessibilityRole="button"
                         accessibilityLabel={`Create collection ${name}`}>
                <Feather name="plus" size={13} color={colors.mint} />
                <Text style={[s.collectionName, { color: colors.mint }]}>{name}</Text>
              </Pressable>
            ))
          : null}
      </View>
    </View>
  );
}

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={s.header}>
      <Text style={s.headerTitle}>{title}</Text>
      {subtitle ? <Text style={s.headerSub}>{subtitle}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md, gap: 2 },
  headerTitle: { ...type.title, color: colors.text },
  headerSub: { ...type.small, color: colors.textMuted },

  pendingBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.xl, marginBottom: space.md, padding: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
  },
  pendingText: { ...type.small, color: colors.textMuted, flexShrink: 1 },
  error: { ...type.small, color: colors.danger, paddingHorizontal: space.xl, paddingBottom: space.md },

  grid: { padding: space.xl, paddingTop: 0, gap: space.md },
  sectionLabel: { ...type.micro, color: colors.textFaint },
  collectionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  collection: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill,
  },
  collectionSuggested: { borderColor: colors.mintDeep, backgroundColor: colors.mintWash },
  collectionName: { ...type.small, color: colors.text },
  collectionCount: { ...type.small, color: colors.textFaint },

  tile: {
    flex: 1, aspectRatio: 0.78, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.surface, marginBottom: space.md, justifyContent: 'flex-end',
  },
  tileUnavailable: {
    alignItems: 'center', justifyContent: 'center', gap: space.sm,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  unavailableText: { ...type.small, color: colors.textFaint, textAlign: 'center' },
  tileScrim: { ...fill, backgroundColor: 'rgba(6,10,8,0.35)' },
  tileText: { padding: space.md, gap: 2 },
  tileTitle: { ...type.bodyStrong, color: colors.text },
  tileMeta: { ...type.small, color: colors.textMuted },
});
