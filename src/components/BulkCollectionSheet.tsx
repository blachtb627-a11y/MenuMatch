import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import {
  SUGGESTED_COLLECTIONS, addRecipesToCollection, createCollection, describeBulkAdd,
  myCollections, type Collection,
} from '@/lib/collections';
import { colors, fill, radius, space, type } from '@/theme';

/**
 * Files a batch of selected recipes into one collection.
 *
 * Deliberately not the single-recipe picker with checkboxes. That one shows
 * where *this* recipe lives and replaces the lot on save; ten selected recipes
 * have ten different answers to that, and no set of ticks can mean anything
 * sensible across them. So this picks one destination and only ever adds —
 * nothing a recipe already belongs to is touched.
 */
export function BulkCollectionSheet({
  recipeIds, onClose, onDone,
}: {
  /** Null closes the sheet. */
  recipeIds: string[] | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The double-submit guard. A `busy` read inside a handler is whatever it was
   * when that handler was created, so it cannot see a write from the same tick
   * — a ref can, and createAndFile calls straight into fileInto.
   */
  const inFlight = useRef(false);

  const count = recipeIds?.length ?? 0;

  useEffect(() => {
    if (!recipeIds) return;
    setCollections(null);
    setError(null);
    setNewName('');
    setBusy(false);
    inFlight.current = false;
    void myCollections()
      .then(setCollections)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not load your collections');
        setCollections([]);
      });
  }, [recipeIds]);

  if (!recipeIds) return null;

  async function fileInto(collectionId: string) {
    if (!recipeIds) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addRecipesToCollection(collectionId, recipeIds);
      // The sheet closes on success, so busy is left set on purpose — the
      // effect above clears it the next time it opens.
      onDone(describeBulkAdd(result, recipeIds.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file those');
      setBusy(false);
      inFlight.current = false;
    }
  }

  /** Creating and filing are one action here — nobody makes an empty folder. */
  async function createAndFile(name: string) {
    const trimmed = name.trim();
    if (!trimmed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { id } = await createCollection(trimmed);
      await fileInto(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that collection');
      setBusy(false);
      inFlight.current = false;
    }
  }

  const suggestions = SUGGESTED_COLLECTIONS.filter(
    (n) => !(collections ?? []).some((c) => c.name === n),
  );

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <Text style={s.title}>
          Add {count} recipe{count === 1 ? '' : 's'} to…
        </Text>
        <Text style={s.subtitle}>
          They stay in your Cookbook and in any collection they are already in.
        </Text>

        {collections === null ? (
          <View style={s.loading}><ActivityIndicator color={colors.mint} /></View>
        ) : (
          <ScrollView style={{ maxHeight: 290 }} keyboardShouldPersistTaps="handled">
            {collections.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => {
                  if (inFlight.current) return;
                  inFlight.current = true;
                  void fileInto(c.id);
                }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Add to ${c.name}, ${c.recipeCount} recipes`}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
              >
                <Feather name="folder" size={17} color={colors.mint} />
                <Text style={s.rowLabel} numberOfLines={1}>{c.name}</Text>
                <Text style={s.rowCount}>{c.recipeCount}</Text>
                <Feather name="chevron-right" size={16} color={colors.textFaint} />
              </Pressable>
            ))}

            {collections.length === 0 ? (
              <>
                <Text style={s.empty}>
                  No collections yet. Name one and these go straight into it.
                </Text>
                <View style={s.suggestWrap}>
                  {suggestions.map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => void createAndFile(n)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Create ${n} and add ${count} recipes`}
                      style={s.suggest}
                    >
                      <Feather name="plus" size={12} color={colors.mint} />
                      <Text style={s.suggestLabel}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        )}

        <View style={s.newRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            style={s.newInput}
            placeholder="New collection"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="New collection name"
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={() => void createAndFile(newName)}
          />
          <Pressable
            onPress={() => void createAndFile(newName)}
            disabled={!newName.trim() || busy}
            accessibilityRole="button"
            accessibilityLabel={`Create collection and add ${count} recipes`}
            style={[s.newBtn, (!newName.trim() || busy) && { opacity: 0.4 }]}
          >
            <Feather name="plus" size={18} color={colors.mint} />
          </Pressable>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <Button label={busy ? 'Filing…' : 'Cancel'} variant="secondary"
                onPress={onClose} disabled={busy} />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { ...fill, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: space.lg,
    paddingBottom: space.xxl, gap: space.md,
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderBright,
    alignSelf: 'center',
  },
  title: { ...type.heading, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted, marginTop: -space.sm, lineHeight: 18 },
  loading: { paddingVertical: space.xl, alignItems: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.sm,
  },
  rowLabel: { ...type.body, color: colors.text, flex: 1 },
  rowCount: { ...type.small, color: colors.textFaint },
  empty: { ...type.small, color: colors.textMuted, paddingVertical: space.md, lineHeight: 19 },
  suggestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  suggest: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.mintWash, borderWidth: 1, borderColor: colors.mintDeep,
  },
  suggestLabel: { ...type.small, color: colors.mint },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  newInput: {
    flex: 1, backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.md, height: 44,
    color: colors.text, fontSize: 15,
  },
  newBtn: {
    width: 44, height: 44, borderRadius: radius.md, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.raised,
  },
  error: { ...type.small, color: colors.danger },
});
