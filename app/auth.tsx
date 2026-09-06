import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Screen } from '@/components/ui';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/**
 * §7 step 4, the soft gate. Reached when a guest tries to save, so the copy
 * says what the account is for and the pending save survives the round trip.
 */
export default function Auth() {
  const { signIn, signUp, pendingSave } = useSession();
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') await signUp(email.trim(), password);
      else await signIn(email.trim(), password);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.body}
        >
          <View style={{ gap: space.sm }}>
            <Text style={s.title}>
              {mode === 'signup' ? 'Create a free account' : 'Welcome back'}
            </Text>
            <Text style={s.sub}>
              {pendingSave
                ? 'Create a free account to keep this recipe. Your swipes so far come with you.'
                : 'Save recipes, build collections, and publish your own.'}
            </Text>
          </View>

          <View style={{ gap: space.md }}>
            <Field label="Email" value={email} onChange={setEmail}
                   autoComplete="email" keyboardType="email-address" />
            <Field label="Password" value={password} onChange={setPassword}
                   secureTextEntry autoComplete="password" />
            {error ? <Text style={s.error}>{error}</Text> : null}
          </View>

          <View style={{ gap: space.md }}>
            <Button
              label={busy ? 'Working...' : mode === 'signup' ? 'Create account' : 'Sign in'}
              onPress={submit}
              disabled={busy || !email || password.length < 6}
            />
            <Pressable
              onPress={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
              accessibilityRole="button"
              style={s.switch}
            >
              <Text style={s.switchLabel}>
                {mode === 'signup' ? 'I already have an account' : 'I need an account'}
              </Text>
            </Pressable>
            <Button label="Keep browsing" variant="ghost" onPress={() => router.back()} />
          </View>

          <Text style={s.legal}>
            You must be at least 13 to use MenuMatch. By continuing you agree to
            the Terms of Service and Privacy Policy.
          </Text>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

function Field({
  label, value, onChange, ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.ComponentProps<typeof TextInput>, 'onChange' | 'value'>) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        style={s.input}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        accessibilityLabel={label}
        {...rest}
      />
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, padding: space.xl, gap: space.xxl, justifyContent: 'center' },
  title: { ...type.title, color: colors.text },
  sub: { ...type.body, color: colors.textMuted, lineHeight: 21 },
  fieldLabel: { ...type.micro, color: colors.textFaint },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    color: colors.text, fontSize: 16, minHeight: 48,
  },
  error: { ...type.small, color: colors.danger },
  switch: { alignItems: 'center', paddingVertical: space.sm },
  switchLabel: { ...type.small, color: colors.mint },
  legal: { ...type.small, color: colors.textFaint, textAlign: 'center', lineHeight: 18 },
});
