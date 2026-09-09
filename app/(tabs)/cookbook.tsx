import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { fetchCookbook, type SavedRecipe } from '@/lib/api';
import { CollectionSheet } from '@/components/CollectionSheet';
import { BulkCollectionSheet } from '@/components/BulkCollectionSheet';
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

  /**
   * Multi-select. Null means off — an empty Set would leave the action bar on
   * screen with nothing to act on, and there is no way back out of that state
   * that reads as "never mind".
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [filing, setFiling] = useState<string[] | null>(null);
  const selecting = picked !== null;

  const toggle = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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
        {selecting ? (
          <SelectionHeader
            count={picked.size}
            total={saved.length}
            onSelectAll={() => setPicked(new Set(saved.map((r) => r.id)))}
            onClear={() => setPicked(new Set())}
            onCancel={() => setPicked(null)}
          />
        ) : (
          <Header
            title="Cookbook"
            subtitle={`${saved.length} saved`}
            action={saved.length ? (
              <Pressable
                onPress={() => setPicked(new Set())}
                accessibilityRole="button"
                accessibilityLabel="Select recipes to file into a collection"
                hitSlop={10}
                style={({ pressed }) => [s.selectBtn, pressed && { opacity: 0.6 }]}
              >
                <Feather name="check-square" size={14} color={colors.mint} />
                <Text style={s.selectLabel}>Select</Text>
              </Pressable>
            ) : undefined}
          />
        )}

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
          // A lone item on the last row gets the whole width from FlatList,
          // which turns an odd number of saves into one giant tile. The spacer
          // fills the gap so every tile is the same size.
          data={saved.length % 2 ? [...saved, null] : saved}
          keyExtractor={(item, i) => item?.id ?? `spacer-${i}`}
          numColumns={2}
          columnWrapperStyle={{ gap: space.md }}
          contentContainerStyle={s.grid}
          extraData={picked}
          ListHeaderComponent={
            selecting ? (
              <Text style={s.selectHint}>
                Tap recipes to pick them, then choose a collection.
              </Text>
            ) : (
              <CollectionsRow
                collections={collections}
                onCreate={async (name) => { await createCollection(name); void load(); }}
              />
            )
          }
          ListEmptyComponent={
            <EmptyState
              title="Nothing saved yet"
              body="Swipe right on a recipe, or tap the save control on any recipe page."
              action={<Button label="Open the deck" onPress={() => router.push('/(tabs)')} />}
            />
          }
          renderItem={({ item }) => (item === null ? (
            <View style={{ flex: 1 }} />
          ) : (
            <SavedTile
              item={item}
              selecting={selecting}
              selected={picked?.has(item.id) ?? false}
              onToggle={() => toggle(item.id)}
              // Long press is the other way in, and it picks what you pressed
              // rather than starting you at zero.
              onStartSelecting={() => setPicked(new Set([item.id]))}
              onOrganise={() => setOrganising(item)}
            />
          ))}
        />

        {selecting ? (
          <View style={s.actionBar}>
            <Button
              label={picked.size
                ? `Add ${picked.size} to a collection`
                : 'Add to a collection'}
              disabled={picked.size === 0}
              onPress={() => setFiling(Array.from(picked))}
            />
          </View>
        ) : null}
      </SafeAreaView>

      {/* §12: a recipe can live in several collections, so this replaces
          membership wholesale rather than adding one at a time. */}
      <CollectionSheet
        recipeId={organising?.id ?? null}
        recipeTitle={organising?.title}
        onClose={() => setOrganising(null)}
        onSaved={(message) => { setOrganising(null); setToast(message); void load(); }}
      />
      {/* Files the batch into one collection. Adding only — see the sheet. */}
      <BulkCollectionSheet
        recipeIds={filing}
        onClose={() => setFiling(null)}
        onDone={(message) => {
          setFiling(null);
          setPicked(null);
          setToast(message);
          void load();
        }}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function SelectionHeader({
  count, total, onSelectAll, onClear, onCancel,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const all = count === total && total > 0;
  return (
    <View style={s.selectHeader}>
      <Pressable onPress={onCancel} accessibilityRole="button"
                 accessibilityLabel="Stop selecting" hitSlop={10}
                 style={({ pressed }) => pressed ? { opacity: 0.6 } : null}>
        <Text style={s.selectAction}>Cancel</Text>
      </Pressable>

      <Text style={s.selectCount}>
        {count ? `${count} selected` : 'Select recipes'}
      </Text>

      <Pressable onPress={all ? onClear : onSelectAll} accessibilityRole="button"
                 accessibilityLabel={all ? 'Clear the selection' : 'Select all'}
                 hitSlop={10}
                 style={({ pressed }) => pressed ? { opacity: 0.6 } : null}>
        <Text style={s.selectAction}>{all ? 'Clear' : 'Select all'}</Text>
      </Pressable>
    </View>
  );
}

// A save whose recipe is gone never reaches here: fetchCookbook drops it and
// prunes the row behind it, so there is no dead tile to render.
function SavedTile({
  item, selecting, selected, onToggle, onStartSelecting, onOrganise,
}: {
  item: SavedRecipe;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onStartSelecting: () => void;
  onOrganise: () => void;
}) {
  return (
    <View style={[s.tile, selected && s.tileSelected]}>
      <RecipeCover uri={item.coverImageUrl} seed={item.id} title={item.title}
                   style={StyleSheet.absoluteFill} />
      <View style={s.tileScrim} />

      {/* The whole tile is the tap target, as its own layer rather than a
          parent of the corner control — nesting one button inside another is
          invalid on web and makes the inner one unreliable. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={selecting ? onToggle : () => router.push(`/recipe/${item.id}`)}
        onLongPress={selecting ? undefined : onStartSelecting}
        delayLongPress={300}
        accessibilityRole={selecting ? 'checkbox' : 'button'}
        accessibilityState={selecting ? { checked: selected } : undefined}
        aria-checked={selecting ? selected : undefined}
        accessibilityLabel={item.title}
        accessibilityHint={selecting ? undefined : 'Long press to start selecting'}
      />

      <View style={s.tileText} pointerEvents="none">
        <Text style={s.tileTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={s.tileMeta}>{formatTotalTime(item.totalMinutes)}</Text>
      </View>

      {selecting ? (
        <View style={[s.check, selected && s.checkOn]} pointerEvents="none">
          {selected ? <Feather name="check" size={15} color={colors.onMint} /> : null}
        </View>
      ) : (
        <Pressable
          onPress={onOrganise}
          accessibilityRole="button"
          accessibilityLabel={`Add ${item.title} to a collection`}
          hitSlop={8}
          style={s.organiseBtn}
        >
          <Feather name="folder-plus" size={15} color={colors.text} />
        </Pressable>
      )}
    </View>
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

export function Header({
  title, subtitle, action,
}: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <View style={s.header}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.headerTitle}>{title}</Text>
        {subtitle ? <Text style={s.headerSub}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md,
  },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.mintDeep, backgroundColor: colors.mintWash,
  },
  selectLabel: { ...type.small, color: colors.mint, fontWeight: '700' },

  selectHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md,
  },
  selectAction: { ...type.small, color: colors.mint, fontWeight: '600' },
  selectCount: { ...type.bodyStrong, color: colors.text },
  selectHint: { ...type.small, color: colors.textMuted, marginBottom: space.lg },
  actionBar: {
    padding: space.xl, paddingTop: space.md,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.ground,
  },
  check: {
    position: 'absolute', top: space.sm, right: space.sm,
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
    borderColor: colors.text, backgroundColor: 'rgba(6,10,8,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.mint, borderColor: colors.mint },
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
  tileSelected: { borderWidth: 2, borderColor: colors.mint },
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
