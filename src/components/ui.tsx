import React from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { colors, fill, radius, space, type } from '@/theme';

export function Button({
  label, onPress, variant = 'primary', disabled, style, accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const tone = {
    primary: { bg: colors.mint, fg: colors.onMint, border: colors.mint },
    secondary: { bg: colors.raised, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: 'transparent' },
    danger: { bg: 'transparent', fg: colors.danger, border: colors.border },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: tone.bg, borderColor: tone.border },
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Text style={[s.buttonLabel, { color: tone.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Pill({
  label, tone = 'neutral', style,
}: { label: string; tone?: 'neutral' | 'mint' | 'clay'; style?: StyleProp<ViewStyle> }) {
  const bg = tone === 'mint' ? colors.mintWash : tone === 'clay' ? colors.clayWash : 'rgba(255,255,255,0.10)';
  const fg = tone === 'mint' ? colors.mint : tone === 'clay' ? colors.clay : colors.text;
  return (
    <View style={[s.pill, { backgroundColor: bg }, style]}>
      <Text style={[s.pillLabel, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.screen, style]}>{children}</View>;
}

export function SectionHeading({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.sectionHeading, style]}>{children}</Text>;
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.mint} />
      {label ? <Text style={s.muted}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  title, body, action,
}: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <View style={s.center}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={[s.muted, { textAlign: 'center', maxWidth: 300 }]}>{body}</Text>
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  );
}

/**
 * §19: standing disclaimers. Allergen and dietary tags are creator-supplied
 * unless verified, and nutrition is never computed by the platform.
 */
export function Disclaimer({ children }: { children: React.ReactNode }) {
  return <Text style={s.disclaimer}>{children}</Text>;
}

/**
 * A destructive confirmation. The cancel label says what keeping it means and
 * the body says what is actually lost, so the choice can be made from the
 * dialog alone rather than from the button colours.
 */
export function ConfirmDialog({
  visible, title, body, confirmLabel, cancelLabel = 'Keep it',
  busy, onConfirm, onCancel,
}: {
  visible: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.scrim} onPress={onCancel} accessibilityLabel="Close" />
      <View style={s.dialogWrap}>
        <View style={s.dialog}>
          <Text style={s.dialogTitle}>{title}</Text>
          {typeof body === 'string' ? <Text style={s.dialogBody}>{body}</Text> : body}
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Button label={cancelLabel} variant="secondary" style={{ flex: 1 }}
                    onPress={onCancel} />
            <Button label={confirmLabel} variant="danger" style={{ flex: 1 }}
                    onPress={onConfirm} disabled={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  button: {
    minHeight: 48, paddingHorizontal: space.xl, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  buttonLabel: { ...type.bodyStrong },
  pill: {
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  pillLabel: { ...type.small },
  sectionHeading: { ...type.heading, color: colors.text, marginBottom: space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  emptyTitle: { ...type.title, color: colors.text, textAlign: 'center' },
  muted: { ...type.body, color: colors.textMuted },
  disclaimer: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  scrim: { ...fill, backgroundColor: colors.overlay },
  dialogWrap: { ...fill, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  dialog: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl,
    gap: space.lg, width: '100%', maxWidth: 420,
    borderWidth: 1, borderColor: colors.border,
  },
  dialogTitle: { ...type.heading, color: colors.text },
  dialogBody: { ...type.body, color: colors.textMuted, lineHeight: 21 },
});
