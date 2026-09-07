import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors, radius, space, type } from '@/theme';

export function AdminHeader({
  title, subtitle, back,
}: { title: string; subtitle?: string; back?: boolean }) {
  return (
    <View style={s.header}>
      {back ? (
        <Pressable onPress={() => router.back()} accessibilityRole="button"
                   accessibilityLabel="Back" style={{ marginBottom: space.sm }}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>
      ) : null}
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function StatTile({
  label, value, tone = 'neutral',
}: { label: string; value: number | string; tone?: 'neutral' | 'alert' | 'good' }) {
  const fg = tone === 'alert' ? colors.clay : tone === 'good' ? colors.mint : colors.text;
  return (
    <View style={s.tile}>
      <Text style={[s.tileValue, { color: fg }]}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

/** §20.3 wants aging visible, not buried in a timestamp. */
export function AgePill({
  ageHours, slaHours, overdue,
}: { ageHours: number; slaHours: number; overdue: boolean }) {
  const label = ageHours < 1
    ? 'just now'
    : ageHours < 24
      ? `${Math.round(ageHours)}h old`
      : `${Math.round(ageHours / 24)}d old`;
  return (
    <View style={[s.agePill, overdue && { backgroundColor: colors.clayWash }]}>
      <Feather name={overdue ? 'alert-triangle' : 'clock'} size={11}
               color={overdue ? colors.clay : colors.textFaint} />
      <Text style={[s.ageLabel, overdue && { color: colors.clay }]}>
        {label}{overdue ? ` · past ${slaHours}h` : ''}
      </Text>
    </View>
  );
}

export function PriorityPill({ priority }: { priority: string }) {
  const high = priority === 'high';
  return (
    <View style={[s.priority, high && { backgroundColor: colors.clayWash }]}>
      <Text style={[s.priorityLabel, high && { color: colors.clay }]}>
        {high ? 'HIGH' : 'NORMAL'}
      </Text>
    </View>
  );
}

export const REASON_LABELS: Record<string, string> = {
  unsafe_food: 'Unsafe food content',
  copyright: 'Copyright or stolen content',
  impersonation: 'Impersonation',
  harassment: 'Harassment or hate',
  sexual: 'Sexual content',
  spam: 'Spam or misleading',
  not_recipe: 'Not a recipe',
  other: 'Something else',
};

const s = StyleSheet.create({
  header: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md, gap: 2 },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted },
  tile: {
    flexGrow: 1, minWidth: 96, backgroundColor: colors.surface, borderRadius: radius.md,
    padding: space.lg, gap: 2, borderWidth: 1, borderColor: colors.border,
  },
  tileValue: { fontSize: 24, fontWeight: '700' },
  tileLabel: { ...type.small, color: colors.textMuted },
  agePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm,
    backgroundColor: colors.raised,
  },
  ageLabel: { fontSize: 11, fontWeight: '600', color: colors.textFaint },
  priority: {
    paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm,
    backgroundColor: colors.raised,
  },
  priorityLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: colors.textMuted },
});
