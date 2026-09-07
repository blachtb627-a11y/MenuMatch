import React, { useCallback, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Toast } from '@/components/Toast';
import { Button, ConfirmDialog, EmptyState, Loading, Screen } from '@/components/ui';
import {
  collectionDetail, deleteCollection, removeFromCollection, renameCollection,
  reorderCollectionItem, type CollectionDetail,
} from '@/lib/collections';
import { formatTotalTime } from '@/lib/timers';
import { colors, fill, radius, space, type } from '@/theme';

export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await collectionDetail(id);
      setDetail(d);
      setName(d.name);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that collection');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function commitRename() {
    if (!id || !name.trim()) return;
    setBusy(true);
    try {
      await renameCollection(id, name.trim());
      setRenaming(false);
      await load();
      setToast('Renamed');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not rename that');
    } finally {
      setBusy(false);
    }
  }

  async function commitDelete() {
    if (!id) return;
    setBusy(true);
    try {
      await deleteCollection(id);
      router.back();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not delete that');
      setBusy(false);
    }
  }

  async function move(recipeId: string, direction: -1 | 1) {
    if (!id) return;
    await reorderCollectionItem(id, recipeId, direction).catch(() => {});
    await load();
  }

  async function remove(recipeId: string) {
    if (!id) return;
    await removeFromCollection(id, recipeId).catch(() => {});
    await load();
    setToast('Removed from this collection — still in your Cookbook');
  }

  if (error) {
    return (
      <Screen><SafeAreaView style={{ flex: 1 }}>
        <EmptyState title="Could not open that collection" body={error}
                    action={<Button label="Go back" onPress={() => router.back()} />} />
      </SafeAreaView></Screen>
    );
  }
  if (!detail) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <Pressable onPress={() => router.back()} accessibilityRole="button"
                     accessibilityLabel="Back">
            <Feather name="chevron-left" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: space.lg }}>
            <Pressable onPress={() => setRenaming(true)} accessibilityRole="button"
                       accessibilityLabel="Rename this collection">
              <Feather name="edit-2" size={18} color={colors.textMuted} />
            </Pressable>
            <Pressable onPress={() => setConfirmDelete(true)} accessibilityRole="button"
                       accessibilityLabel="Delete this collection">
              <Feather name="trash-2" size={18} color={colors.danger} />
            </Pressable>
          </View>
        </View>

        <View style={s.header}>
          <Text style={s.title}>{detail.name}</Text>
          <Text style={s.subtitle}>
            {detail.recipes.length} recipe{detail.recipes.length === 1 ? '' : 's'}
          </Text>
        </View>

        <ScrollView contentContainerStyle={s.body}>
          {detail.recipes.length === 0 ? (
            <EmptyState
              title="Nothing in here yet"
              body="Open a saved recipe and use “Add to collection” to put it in this one."
              action={<Button label="Go to your Cookbook"
                              onPress={() => router.push('/(tabs)/cookbook')} />}
            />
          ) : detail.recipes.map((r, i) => (
            <View key={r.id} style={s.row}>
              <Pressable style={s.rowMain}
                         onPress={() => !r.unavailable && router.push(`/recipe/${r.id}`)}
                         accessibilityRole="button" accessibilityLabel={r.title}>
                <RecipeCover uri={r.coverImageUrl} seed={r.id} style={s.thumb} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.rowTitle} numberOfLines={2}>{r.title}</Text>
                  <Text style={s.rowMeta}>
                    {r.unavailable ? 'No longer available' : formatTotalTime(r.totalMinutes)}
                  </Text>
                </View>
              </Pressable>
              <View style={s.rowActions}>
                <IconBtn icon="chevron-up" label={`Move ${r.title} up`}
                         disabled={i === 0} onPress={() => void move(r.id, -1)} />
                <IconBtn icon="chevron-down" label={`Move ${r.title} down`}
                         disabled={i === detail.recipes.length - 1}
                         onPress={() => void move(r.id, 1)} />
                <IconBtn icon="x" label={`Remove ${r.title} from this collection`}
                         tone="danger" onPress={() => void remove(r.id)} />
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={renaming} transparent animationType="fade"
             onRequestClose={() => setRenaming(false)}>
        <Pressable style={s.scrim} onPress={() => setRenaming(false)} accessibilityLabel="Close" />
        <View style={s.dialogWrap}>
          <View style={s.dialog}>
            <Text style={s.dialogTitle}>Rename collection</Text>
            <TextInput value={name} onChangeText={setName} style={s.input} autoFocus
                       maxLength={60} accessibilityLabel="Collection name"
                       placeholderTextColor={colors.textFaint}
                       onSubmitEditing={commitRename} returnKeyType="done" />
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button label="Cancel" variant="secondary" style={{ flex: 1 }}
                      onPress={() => { setName(detail.name); setRenaming(false); }} />
              <Button label="Save" style={{ flex: 1 }} onPress={commitRename}
                      disabled={busy || !name.trim()} />
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={confirmDelete}
        title={`Delete “${detail.name}”?`}
        body={`The collection goes away. The ${detail.recipes.length} recipe${
          detail.recipes.length === 1 ? '' : 's'} inside stay saved in your Cookbook.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={commitDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function IconBtn({
  icon, label, onPress, disabled, tone,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string; onPress: () => void; disabled?: boolean; tone?: 'danger';
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
               accessibilityLabel={label}
               style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 },
                                        disabled && { opacity: 0.25 }]}>
      <Feather name={icon} size={16}
               color={tone === 'danger' ? colors.danger : colors.textMuted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
  },
  header: { paddingHorizontal: space.xl, paddingBottom: space.md, gap: 2 },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted },
  body: { padding: space.xl, paddingTop: 0, gap: space.sm, paddingBottom: space.xxxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.small, color: colors.textMuted },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center' },
  scrim: { ...fill, backgroundColor: colors.overlay },
  dialogWrap: { ...fill, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  dialog: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl,
    gap: space.lg, width: '100%', maxWidth: 420,
    borderWidth: 1, borderColor: colors.border,
  },
  dialogTitle: { ...type.heading, color: colors.text },
  dialogBody: { ...type.body, color: colors.textMuted, lineHeight: 21 },
  input: {
    backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, height: 48,
    color: colors.text, fontSize: 16,
  },
});
