import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { fetchCookbook, type SavedRecipe } from '@/lib/api';
import { CollectionSheet } from '@/components/CollectionSheet';
import {
  SUGGESTED_COLLECTIONS, createCollection, myCollections, type Collection,
} from '@/lib/collections';
import { onQueueChange, pendingCount, drain } from '@/lib/queue';
import { Toast } from '@/components/Toast';
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
  const [organising, setOrganising] = useState<SavedRecipe | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isGuest) { setSaved([]); return; }
    try {
      const [recipes, cols] = await Promise.all([fetchCookbook(), myCollections()]);
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
          renderItem={({ item }) => (
            <SavedTile item={item} onOrganise={() => setOrganising(item)} />
          )}
        />
      </SafeAreaView>

      {/* §12: a recipe can live in several collections, so this replaces
          membership wholesale rather than adding one at a time. */}
      <CollectionSheet
        recipeId={organising?.id ?? null}
        recipeTitle={organising?.title}
        onClose={() => setOrganising(null)}
        onSaved={(message) => { setOrganising(null); setToast(message); void load(); }}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

// A save whose recipe is gone never reaches here: fetchCookbook drops it and
// prunes the row behind it, so there is no dead tile to render.
function SavedTile({ item, onOrganise }: { item: SavedRecipe; onOrganise: () => void }) {
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
      <Pressable
        onPress={onOrganise}
        accessibilityRole="button"
        accessibilityLabel={`Add ${item.title} to a collection`}
        hitSlop={8}
        style={s.organiseBtn}
      >
        <Feather name="folder-plus" size={15} color={colors.text} />
      </Pressable>
    </Pressable>
  );
}

function CollectionsRow({
  collections, onCreate,
}: { collections: Collection[]; onCreate: (name: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  // §12: default suggestions offered on first collection creation.
  const suggestions = SUGGESTED_COLLECTIONS.filter(
    (n) => !collections.some((c) => c.name === n),
  );

  return (
    <View style={{ gap: space.md, marginBottom: space.lg }}>
      <Text style={s.sectionLabel}>COLLECTIONS</Text>
      <View style={s.collectionWrap}>
        {collections.map((c) => (
          <Pressable key={c.id} style={s.collection}
                     onPress={() => router.push(`/collection/${c.id}`)}
                     accessibilityRole="button"
                     accessibilityLabel={`Open ${c.name}, ${c.recipeCount} recipes`}>
            <Text style={s.collectionName}>{c.name}</Text>
            <Text style={s.collectionCount}>{c.recipeCount}</Text>
          </Pressable>
        ))}

        {collections.length === 0
          ? suggestions.slice(0, 4).map((n) => (
              <Pressable key={n} style={[s.collection, s.collectionSuggested]}
                         onPress={() => void onCreate(n)} accessibilityRole="button"
                         accessibilityLabel={`Create collection ${n}`}>
                <Feather name="plus" size={13} color={colors.mint} />
                <Text style={[s.collectionName, { color: colors.mint }]}>{n}</Text>
              </Pressable>
            ))
          : (
            <Pressable style={[s.collection, s.collectionSuggested]}
                       onPress={() => setAdding(true)} accessibilityRole="button"
                       accessibilityLabel="Create a collection">
              <Feather name="plus" size={13} color={colors.mint} />
              <Text style={[s.collectionName, { color: colors.mint }]}>New</Text>
            </Pressable>
          )}
      </View>

      {adding ? (
        <View style={s.addRow}>
          <TextInput value={name} onChangeText={setName} autoFocus style={s.addInput}
                     placeholder="Collection name" placeholderTextColor={colors.textFaint}
                     accessibilityLabel="New collection name" maxLength={60}
                     returnKeyType="done"
                     onSubmitEditing={async () => {
                       if (name.trim()) await onCreate(name.trim());
                       setName(''); setAdding(false);
                     }} />
          <Pressable onPress={() => { setName(''); setAdding(false); }}
                     accessibilityRole="button" accessibilityLabel="Cancel"
                     style={s.addCancel}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
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
  organiseBtn: {
    position: 'absolute', top: space.sm, right: space.sm,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(6,10,8,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  addInput: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.mint,
    borderRadius: radius.md, paddingHorizontal: space.md, height: 42,
    color: colors.text, fontSize: 15,
  },
  addCancel: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { ...type.bodyStrong, color: colors.text },
  tileMeta: { ...type.small, color: colors.textMuted },
});
