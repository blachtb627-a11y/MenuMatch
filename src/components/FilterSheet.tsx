import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import {
  DIET_OPTIONS, MEAL_OPTIONS, TIME_OPTIONS, NO_FILTERS,
  filterCount, toggleInList, type DeckFilters,
} from '@/lib/filters';
import { colors, elevate, fill, radius, space, type } from '@/theme';

/**
 * The deck's filters, grouped by what they actually are.
 *
 * The three groups are independent and combine, which is the whole point: the
 * strip this replaces was one flat row where choosing Lunch cleared Quick,
 * because both were rows in the same list of mutually exclusive categories.
 *
 * Choices are held locally and applied on dismissal, so half-built selections
 * never reach the deck — picking Lunch, then Under 30, should load one deck,
 * not two.
 */
export function FilterSheet({
  visible, value, onApply, onClose,
}: {
  visible: boolean;
  value: DeckFilters;
  onApply: (next: DeckFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DeckFilters>(value);

  // Reopening shows what is actually on, not what was abandoned last time.
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);

  const n = filterCount(draft);

  function done() {
    onApply(draft);
    onClose();
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet}>
        <View style={s.grabber} />

        <View style={s.head}>
          <Text style={s.title}>Filters</Text>
          {n > 0 ? (
            <Pressable
              onPress={() => setDraft(NO_FILTERS)}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
              hitSlop={8}
            >
              <Text style={s.clear}>Clear all</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}>
          <Group label="Meal">
            {MEAL_OPTIONS.map((m) => (
              <Chip
                key={m.slug}
                label={m.label}
                on={draft.meals.includes(m.slug)}
                onPress={() => setDraft((d) => ({ ...d, meals: toggleInList(d.meals, m.slug) }))}
              />
            ))}
          </Group>

          {/* One cap, not a set: "under 15 and under 30" is just under 15. */}
          <Group label="Time" hint="Prep and cook together">
            {TIME_OPTIONS.map((t) => (
              <Chip
                key={t.minutes}
                label={t.label}
                on={draft.maxMinutes === t.minutes}
                onPress={() => setDraft((d) => ({
                  ...d, maxMinutes: d.maxMinutes === t.minutes ? null : t.minutes,
                }))}
              />
            ))}
          </Group>

          <Group label="Diet" hint="Every one you pick has to apply">
            {DIET_OPTIONS.map((d0) => (
              <Chip
                key={d0.slug}
                label={d0.label}
                on={draft.diets.includes(d0.slug)}
                onPress={() => setDraft((d) => ({ ...d, diets: toggleInList(d.diets, d0.slug) }))}
              />
            ))}
          </Group>

          {/* §19: dietary tags are creator-supplied unless verified, and a
              filter that silently implies otherwise is the wrong place to be
              quiet about it. */}
          <Text style={s.note}>
            Dietary tags come from whoever posted the recipe. Check the
            ingredients yourself if it matters.
          </Text>
        </ScrollView>

        <Button
          label={n > 0 ? `Show ${n === 1 ? '1 filter' : `${n} filters`}` : 'Show everything'}
          onPress={done}
        />
      </View>
    </Modal>
  );
}

function Group({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={s.group}>
      <View style={s.groupHead}>
        <Text style={s.groupLabel}>{label.toUpperCase()}</Text>
        {hint ? <Text style={s.groupHint}>{hint}</Text> : null}
      </View>
      <View style={s.chipWrap}>{children}</View>
    </View>
  );
}

function Chip({
  label, on, onPress,
}: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={({ pressed }) => [s.chip, on && s.chipOn, pressed && { opacity: 0.7 }]}
    >
      {on ? <Feather name="check" size={13} color={colors.onMint} /> : null}
      <Text style={[s.chipLabel, on && s.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  scrim: { ...fill, backgroundColor: colors.scrimStrong },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%',
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: space.lg,
    paddingBottom: space.xxl, gap: space.md,
    ...elevate.sheet,
  },
  grabber: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderBright,
    alignSelf: 'center', marginBottom: space.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.title, color: colors.text },
  clear: { ...type.small, color: colors.mint, fontWeight: '700' },

  scroll: { flexGrow: 0 },
  scrollBody: { gap: space.xl, paddingBottom: space.lg },

  group: { gap: space.md },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  groupLabel: { ...type.micro, color: colors.textFaint },
  groupHint: { ...type.small, color: colors.textFaint, flexShrink: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.lg, paddingVertical: 10, borderRadius: radius.pill,
    backgroundColor: colors.raised,
  },
  chipOn: { backgroundColor: colors.mint },
  chipLabel: { ...type.small, color: colors.text },
  chipLabelOn: { color: colors.onMint, fontWeight: '700' },

  note: { ...type.small, color: colors.textFaint, lineHeight: 18 },
});
