import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, space, type } from '@/theme';

export function Labelled({
  label, hint, required, children,
}: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <View style={s.labelRow}>
        <Text style={s.label}>{label.toUpperCase()}</Text>
        {required ? <Text style={s.required}>REQUIRED</Text> : null}
      </View>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Input({
  multiline, style, ...rest
}: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      // `style` is merged, not spread through {...rest} — spreading would let a
      // caller's width override drop the background and border entirely.
      style={[s.input, multiline && s.inputMultiline, style]}
      placeholderTextColor={colors.textFaint}
      multiline={multiline}
      {...rest}
    />
  );
}

export function ChoiceRow({
  options, value, onChange, allowEmpty = true,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <View style={s.choiceWrap}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(on && allowEmpty ? '' : o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={[s.choice, on && s.choiceOn]}
          >
            <Text style={[s.choiceLabel, on && { color: colors.mint }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RowActions({
  onUp, onDown, onRemove, canUp, canDown, label,
}: {
  onUp: () => void; onDown: () => void; onRemove: () => void;
  canUp: boolean; canDown: boolean; label: string;
}) {
  return (
    <View style={s.rowActions}>
      <IconBtn icon="chevron-up" label={`Move ${label} up`} onPress={onUp} disabled={!canUp} />
      <IconBtn icon="chevron-down" label={`Move ${label} down`} onPress={onDown} disabled={!canDown} />
      <IconBtn icon="x" label={`Remove ${label}`} onPress={onRemove} tone="danger" />
    </View>
  );
}

function IconBtn({
  icon, label, onPress, disabled, tone,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string; onPress: () => void; disabled?: boolean; tone?: 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }, disabled && { opacity: 0.25 }]}
    >
      <Feather name={icon} size={16}
               color={tone === 'danger' ? colors.danger : colors.textMuted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { ...type.micro, color: colors.textFaint },
  required: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: colors.mintDim },
  hint: { ...type.small, color: colors.textFaint, lineHeight: 17 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    color: colors.text, fontSize: 15, minHeight: 46,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: {
    paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  choiceOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  choiceLabel: { ...type.small, color: colors.textMuted },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
});
