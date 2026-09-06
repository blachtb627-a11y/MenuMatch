import React from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { colors, radius, space, type } from '@/theme';

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
});
