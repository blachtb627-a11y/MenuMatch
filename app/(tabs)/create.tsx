import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Toast } from '@/components/Toast';
import { Button, ConfirmDialog, EmptyState, Loading, Screen } from '@/components/ui';
import { Header } from './cookbook';
import { deleteDraft, listMyRecipes, type RecipeSummary } from '@/lib/composer';
import { formatTotalTime } from '@/lib/timers';
import { colors, radius, space, type } from '@/theme';

/** §15: the creator's own recipes, drafts first. */
export default function Create() {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RecipeSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRecipes(await listMyRecipes());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your recipes');
      setRecipes([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function commitDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await deleteDraft(pendingDelete.id);
      // Drop it locally rather than refetching, so the row goes at once.
      setRecipes((cur) => (cur ?? []).filter((r) => r.id !== pendingDelete.id));
      setToast('Draft deleted');
      setPendingDelete(null);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not delete that draft');
    } finally {
      setBusy(false);
    }
  }

  if (recipes === null) return <Screen><Loading /></Screen>;

  const drafts = recipes.filter((r) => r.status === 'draft');
  const live = recipes.filter((r) => r.status !== 'draft');

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header title="Create"
                subtitle={recipes.length ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'} · ${live.length} published` : undefined} />

        {error ? <Text style={s.error}>{error}</Text> : null}

        <FlatList
          data={[...drafts, ...live]}
          keyExtractor={(r) => r.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <View style={{ gap: space.md, marginBottom: space.lg }}>
              <Button label="Write a new recipe"
                      onPress={() => router.push('/compose/new')} />
              <Pressable style={s.scanRow} onPress={() => router.push('/compose/new')}
                         accessibilityRole="button"
                         accessibilityLabel="Scan a recipe you have written">
                <Feather name="camera" size={17} color={colors.mint} />
                <View style={{ flex: 1 }}>
                  <Text style={s.scanTitle}>Scan one you've written</Text>
                  <Text style={s.scanBody}>
                    Photograph your recipe card or notes and we'll fill in the fields.
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.textFaint} />
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title="Nothing published yet"
              body="Your recipes and drafts live here. Start from scratch, or scan something you have already written down."
            />
          }
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => router.push(`/compose/${item.id}`)}
                       accessibilityRole="button"
                       accessibilityLabel={`${item.title}, ${item.status}`}>
              <RecipeCover uri={item.coverImageUrl} seed={item.id} title={item.title}
                           style={s.thumb} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[s.rowTitle, !item.title && s.rowTitleEmpty]} numberOfLines={1}>
                  {item.title || 'Untitled draft'}
                </Text>
                <Text style={s.rowMeta}>
                  {item.ingredientCount} ingredient{item.ingredientCount === 1 ? '' : 's'}
                  {' · '}{item.stepCount} step{item.stepCount === 1 ? '' : 's'}
                  {item.totalMinutes ? ` · ${formatTotalTime(item.totalMinutes)}` : ''}
                </Text>
              </View>
              <StatusPill status={item.status} />
              {/* Only drafts: a published recipe may be in someone's Cookbook,
                  so taking it down is unpublish, from inside the composer. */}
              {item.status === 'draft' ? (
                <Pressable onPress={() => setPendingDelete(item)} hitSlop={10}
                           accessibilityRole="button"
                           accessibilityLabel={`Delete ${item.title || 'this untitled draft'}`}
                           style={s.deleteBtn}>
                  <Feather name="trash-2" size={16} color={colors.textFaint} />
                </Pressable>
              ) : null}
            </Pressable>
          )}
        />
      </SafeAreaView>

      <ConfirmDialog
        visible={!!pendingDelete}
        title={`Delete “${pendingDelete?.title || 'Untitled draft'}”?`}
        body="This draft has never been published, so nothing else links to it. It goes for good."
        confirmLabel="Delete draft"
        busy={busy}
        onConfirm={() => void commitDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'published'
    ? { bg: colors.mintWash, fg: colors.mint, label: 'LIVE' }
    : status === 'draft'
      ? { bg: colors.raised, fg: colors.textMuted, label: 'DRAFT' }
      : { bg: colors.clayWash, fg: colors.clay, label: status.replace('_', ' ').toUpperCase() };
  return (
    <View style={[s.pill, { backgroundColor: tone.bg }]}>
      <Text style={[s.pillLabel, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: space.xl, paddingTop: 0 },
  error: { ...type.small, color: colors.danger, paddingHorizontal: space.xl },
  scanRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg,
    borderWidth: 1, borderColor: colors.mintDeep,
  },
  rowTitleEmpty: { color: colors.textFaint, fontStyle: 'italic' },
  deleteBtn: { padding: space.xs, marginLeft: space.xs },
  scanTitle: { ...type.bodyStrong, color: colors.text },
  scanBody: { ...type.small, color: colors.textMuted, lineHeight: 17 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  thumb: { width: 54, height: 54, borderRadius: radius.md },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.small, color: colors.textMuted },
  pill: { paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.sm },
  pillLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
});
