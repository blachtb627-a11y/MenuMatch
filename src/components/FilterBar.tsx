import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  describeFilters, filterCount, withoutFilter, type DeckFilters,
} from '@/lib/filters';
import { colors, radius, space, type } from '@/theme';

/**
 * One row above the deck: what it is currently narrowed to, and a way in.
 *
 * Every active filter is a chip you can take off where you can see it. That
 * matters more here than on a list screen — a swipe deck with a filter left on
 * looks identical to a deck that has simply run out of recipes, and the
 * difference is the whole reason someone would think the app is broken.
 */
export function FilterBar({
  filters, onOpen, onChange,
}: {
  filters: DeckFilters;
  onOpen: () => void;
  onChange: (next: DeckFilters) => void;
}) {
  const active = describeFilters(filters);
  const n = filterCount(filters);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // A horizontal ScrollView in a flex column will otherwise stretch to fill
      // the available height and take the deck's space with it.
      style={s.outer}
      contentContainerStyle={s.row}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={n > 0 ? `Filters, ${n} active` : 'Filters'}
        style={({ pressed }) => [s.open, n > 0 && s.openOn, pressed && { opacity: 0.7 }]}
      >
        <Feather name="sliders" size={14} color={n > 0 ? colors.onMint : colors.text} />
        <Text style={[s.openLabel, n > 0 && s.openLabelOn]}>Filters</Text>
      </Pressable>

      {active.length === 0 ? (
        <Text style={s.allLabel}>Everything</Text>
      ) : (
        active.map((chip) => (
          <Pressable
            key={chip.key}
            onPress={() => onChange(withoutFilter(filters, chip.key))}
            accessibilityRole="button"
            accessibilityLabel={`Remove filter ${chip.label}`}
            style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.chipLabel}>{chip.label}</Text>
            <Feather name="x" size={13} color={colors.textMuted} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  outer: { flexGrow: 0, flexShrink: 0 },
  row: {
    paddingHorizontal: space.lg, paddingVertical: space.md,
    gap: space.sm, alignItems: 'center',
  },
  open: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.lg, paddingVertical: 9, borderRadius: radius.pill,
    backgroundColor: colors.raised,
  },
  openOn: { backgroundColor: colors.mint },
  openLabel: { ...type.small, color: colors.text, fontWeight: '600' },
  openLabelOn: { color: colors.onMint, fontWeight: '700' },

  allLabel: { ...type.small, color: colors.textFaint, paddingHorizontal: space.xs },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.lg, paddingVertical: 9, borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipLabel: { ...type.small, color: colors.text },
});
