import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import {
  SUGGESTED_COLLECTIONS, createCollection, myCollections, recipeCollections,
  setRecipeCollections, type Collection,
} from '@/lib/collections';
import { colors, fill, radius, space, type } from '@/theme';

/**
 * Puts one recipe into any number of collections. Ticking is local; nothing is
 * written until Done, so moving a recipe between collections is a single save
 * rather than a remove followed by an add.
 */
export function CollectionSheet({
  recipeId, recipeTitle, onClose, onSaved,
}: {
  recipeId: string | null;
  recipeTitle?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recipeId) return;
    setCollections(null);
    setError(null);
    void (async () => {
      try {
        const [list, mine] = await Promise.all([
          myCollections(), recipeCollections(recipeId),
        ]);
        setCollections(list);
        const set = new Set(mine ?? []);
        setChecked(set);
        setInitial(new Set(set));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your collections');
        setCollections([]);
      }
    })();
  }, [recipeId]);

  if (!recipeId) return null;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function addNew(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await createCollection(trimmed);
      setCollections(await myCollections());
      setChecked((prev) => new Set(prev).add(id));
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that collection');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await setRecipeCollections(recipeId!, Array.from(checked));
      const added = Array.from(checked).filter((c) => !initial.has(c)).length;
      const removed = Array.from(initial).filter((c) => !checked.has(c)).length;
      onSaved(
        added && removed ? 'Collections updated'
          : added ? `Added to ${added} collection${added === 1 ? '' : 's'}`
          : removed ? `Removed from ${removed} collection${removed === 1 ? '' : 's'}`
          : 'Nothing changed',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusy(false);
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
        <Text style={s.title}>Add to a collection</Text>
        {recipeTitle ? <Text style={s.subtitle} numberOfLines={1}>{recipeTitle}</Text> : null}

        {collections === null ? (
          <View style={s.loading}><ActivityIndicator color={colors.mint} /></View>
        ) : (
          <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
            {collections.map((c) => {
              const on = checked.has(c.id);
              return (
                <Pressable key={c.id} onPress={() => toggle(c.id)}
                           accessibilityRole="checkbox"
                           accessibilityState={{ checked: on }} aria-checked={on}
                           accessibilityLabel={c.name}
                           style={s.row}>
                  <View style={[s.checkbox, on && s.checkboxOn]}>
                    {on ? <Feather name="check" size={13} color={colors.onMint} /> : null}
                  </View>
                  <Text style={s.rowLabel}>{c.name}</Text>
                  <Text style={s.rowCount}>{c.recipeCount}</Text>
                </Pressable>
              );
            })}

            {collections.length === 0 && suggestions.length ? (
              <>
                <Text style={s.sectionLabel}>START WITH ONE OF THESE</Text>
                <View style={s.suggestWrap}>
                  {suggestions.map((n) => (
                    <Pressable key={n} onPress={() => void addNew(n)} disabled={busy}
                               accessibilityRole="button"
                               accessibilityLabel={`Create collection ${n}`}
                               style={s.suggest}>
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
          <TextInput value={newName} onChangeText={setNewName} style={s.newInput}
                     placeholder="New collection" placeholderTextColor={colors.textFaint}
                     accessibilityLabel="New collection name" maxLength={60}
                     onSubmitEditing={() => void addNew(newName)} returnKeyType="done" />
          <Pressable onPress={() => void addNew(newName)} disabled={!newName.trim() || busy}
                     accessibilityRole="button" accessibilityLabel="Create collection"
                     style={[s.newBtn, !newName.trim() && { opacity: 0.4 }]}>
            <Feather name="plus" size={18} color={colors.mint} />
          </Pressable>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button label={busy ? 'Saving…' : 'Done'} onPress={save}
                  disabled={busy || collections === null} style={{ flex: 1 }} />
        </View>
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
  subtitle: { ...type.small, color: colors.textMuted, marginTop: -space.sm },
  loading: { paddingVertical: space.xl, alignItems: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.sm,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5,
    borderColor: colors.borderBright, alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.mint, borderColor: colors.mint },
  rowLabel: { ...type.body, color: colors.text, flex: 1 },
  rowCount: { ...type.small, color: colors.textFaint },
  sectionLabel: { ...type.micro, color: colors.textFaint, marginTop: space.md },
  suggestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
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
