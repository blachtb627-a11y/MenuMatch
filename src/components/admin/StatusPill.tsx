import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { STATUS_LABELS, type UserStatus } from '@/lib/admin';

const TONES: Record<UserStatus, { bg: string; fg: string }> = {
  active:    { bg: colors.mintWash, fg: colors.mint },
  suspended: { bg: colors.clayWash, fg: colors.clay },
  banned:    { bg: colors.dangerWash, fg: colors.danger },
  deleted:   { bg: colors.raised, fg: colors.textFaint },
};

export function StatusPill({ status }: { status: UserStatus }) {
  const tone = TONES[status] ?? TONES.deleted;
  return (
    <View style={[s.pill, { backgroundColor: tone.bg }]}>
      <Text style={[s.label, { color: tone.fg }]}>
        {(STATUS_LABELS[status] ?? status).toUpperCase()}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm,
  },
  label: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
});
