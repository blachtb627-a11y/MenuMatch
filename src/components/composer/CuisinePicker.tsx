import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { searchCuisines } from '@/lib/cuisines';
import { colors, fill, radius, space, type } from '@/theme';

/**
 * The cuisine field, as a searchable list rather than a free-text box.
 *
 * Free text meant "Italian", "italian" and "Italy" all became different
 * cuisines, which ruins the facet the feed and search filter on. The list is
 * the canonical spelling; typing narrows it.
 *
 * A value that is not on the list is still allowed — the last row offers the
 * typed text verbatim — because scans read whatever the page says and drafts
 * written before this existed should not lose their cuisine on the next edit.
 */
export function CuisineField({
  value, onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={value ? `Cuisine, ${value}` : 'Choose a cuisine'}
        style={({ pressed }) => [s.field, pressed && { opacity: 0.7 }]}
      >
        <Text style={[s.fieldText, !value && { color: colors.textFaint }]} numberOfLines={1}>
          {value || 'Choose a cuisine'}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>

      {open ? (
        <CuisineSheet
          value={value}
          onClose={() => setOpen(false)}
          onPick={(v) => { onChange(v); setOpen(false); }}
        />
      ) : null}
    </>
  );
}

function CuisineSheet({
  value, onPick, onClose,
}: {
  value: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const listRef = useRef<FlatList<string>>(null);

  // With nothing typed the list is the common ones — plus whatever is already
  // set, pinned first, so reopening the sheet shows the current answer instead
  // of hiding it 90 rows down.
  const results = useMemo(() => {
    const base = searchCuisines(query);
    if (query.trim()) return base;
    const current = value.trim();
    return current && !base.some((c) => c.toLowerCase() === current.toLowerCase())
      ? [current, ...base]
      : base;
  }, [query, value]);
  const typed = query.trim();
  // The escape hatch, offered only once the list has run out. While real
  // matches are on screen a "Use ind" row is just a way to typo a cuisine
  // into existence next to the correctly spelled one.
  const custom = typed.length >= 2 && results.length === 0 ? typed : null;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <Text style={s.title}>Cuisine</Text>

        <View style={s.searchRow}>
          <Feather name="search" size={15} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              listRef.current?.scrollToOffset({ offset: 0, animated: false });
            }}
            style={s.search}
            placeholder="Search cuisines"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Search cuisines"
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button"
                       accessibilityLabel="Clear search" hitSlop={8}>
              <Feather name="x" size={15} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {!query ? <Text style={s.sectionLabel}>MOST USED</Text> : null}

        <FlatList
          ref={listRef}
          data={results}
          keyExtractor={(c) => c}
          style={s.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          renderItem={({ item }) => {
            const on = item.toLowerCase() === value.trim().toLowerCase();
            return (
              <Pressable
                onPress={() => onPick(item)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                aria-checked={on}
                accessibilityLabel={item}
                style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.raised }]}
              >
                <Text style={[s.rowLabel, on && { color: colors.mint }]}>{item}</Text>
                {on ? <Feather name="check" size={15} color={colors.mint} /> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            custom ? null : (
              <Text style={s.empty}>No cuisine matches “{typed}”.</Text>
            )
          }
          ListFooterComponent={
            custom ? (
              <Pressable onPress={() => onPick(custom)} accessibilityRole="button"
                         accessibilityLabel={`Use ${custom}`}
                         style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.raised }]}>
                <Feather name="plus" size={14} color={colors.mint} />
                <Text style={[s.rowLabel, { color: colors.mint }]}>Use “{custom}”</Text>
              </Pressable>
            ) : null
          }
        />

        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel"
                   style={s.cancel}>
          <Text style={s.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    minHeight: 46,
  },
  fieldText: { flex: 1, color: colors.text, fontSize: 15 },
  scrim: { ...fill, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%',
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: space.lg,
    paddingBottom: space.xxl, gap: space.md,
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderBright,
    alignSelf: 'center',
  },
  title: { ...type.heading, color: colors.text },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 44,
  },
  search: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: space.sm },
  sectionLabel: { ...type.micro, color: colors.textFaint, marginBottom: -space.sm },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: space.md, paddingHorizontal: space.sm, borderRadius: radius.sm,
  },
  rowLabel: { ...type.body, color: colors.text, flex: 1 },
  empty: { ...type.small, color: colors.textFaint, paddingVertical: space.lg },
  cancel: { alignSelf: 'center', padding: space.sm },
  cancelLabel: { ...type.small, color: colors.textMuted },
});
