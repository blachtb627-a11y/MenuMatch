import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { lessLikeThis } from '@/lib/api';
import { useSession } from '@/state/session';
import { colors, fill, radius, space, type } from '@/theme';
import type { RecipeCard } from '@/lib/types';

/**
 * The card's overflow control (§8.1) and "show me less like this" (§8.2).
 *
 * The three sub-options write explicit negative signals, which rank far better
 * than signals inferred from a pass.
 */
export function LessLikeThisSheet({
  card, onClose, onRecorded,
}: {
  card: RecipeCard | null;
  onClose: () => void;
  onRecorded: (message: string) => void;
}) {
  const { isGuest } = useSession();
  const [busy, setBusy] = useState(false);

  if (!card) return null;

  async function record(kind: 'creator' | 'ingredient' | 'cuisine', value: string, label: string) {
    if (isGuest) {
      onClose();
      router.push('/auth');
      return;
    }
    setBusy(true);
    try {
      await lessLikeThis(kind, value);
      onRecorded(`Fewer ${label} in your deck`);
    } catch {
      onRecorded('Could not save that preference');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <Text style={s.title} numberOfLines={2}>{card.title}</Text>

        <Text style={s.groupLabel}>SHOW ME LESS</Text>
        <Row icon="user-x" label={`Fewer from ${card.creator.displayName}`} disabled={busy}
             onPress={() => void record('creator', card.creator.id, `from ${card.creator.displayName}`)} />
        {card.cuisine ? (
          <Row icon="globe" label={`Fewer ${card.cuisine} recipes`} disabled={busy}
               onPress={() => void record('cuisine', card.cuisine!, card.cuisine!)} />
        ) : null}

        <View style={s.divider} />
        <Row icon="share-2" label="Share this recipe" disabled={busy}
             onPress={() => { onClose(); onRecorded('Sharing arrives with deep links'); }} />
        <Row icon="flag" label="Report this recipe" tone="danger" disabled={busy}
             onPress={() => { onClose(); router.push(`/report/${card.id}`); }} />

        <Pressable onPress={onClose} style={s.cancel} accessibilityRole="button">
          <Text style={s.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Row({
  icon, label, onPress, tone = 'default', disabled,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) {
  const fg = tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.raised }, disabled && { opacity: 0.5 }]}
    >
      <Feather name={icon} size={18} color={fg} />
      <Text style={[s.rowLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  scrim: { ...fill, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xxl,
    gap: space.xs, borderTopWidth: 1, borderColor: colors.border,
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderBright,
    alignSelf: 'center', marginBottom: space.md,
  },
  title: { ...type.heading, color: colors.text, marginBottom: space.md },
  groupLabel: { ...type.micro, color: colors.textFaint, marginBottom: space.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.md,
  },
  rowLabel: { ...type.body },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  cancel: { alignItems: 'center', paddingVertical: space.md, marginTop: space.sm },
  cancelLabel: { ...type.bodyStrong, color: colors.textMuted },
});
