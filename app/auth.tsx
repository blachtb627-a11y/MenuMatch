import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Screen } from '@/components/ui';
import { useSession } from '@/state/session';
import { REQUIRE_ACCOUNT } from '@/config';
import { colors, radius, space, type } from '@/theme';
import { goBack } from '@/lib/nav';

export default function Auth() {
  const { signIn, signUp, resendConfirmation, pendingSave } = useSession();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signup' | 'signin'>(
    params.mode === 'signin' ? 'signin' : 'signup',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set when the account exists but Supabase is holding the session back. */
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function submit() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { needsConfirmation } = await signUp(email.trim(), password);
        if (needsConfirmation) {
          // Do not navigate away: there is no session yet, so leaving this
          // screen would drop the user back into a signed-out app.
          setAwaitingConfirmation(true);
          return;
        }
      } else {
        await signIn(email.trim(), password);
      }
      // A session exists now; the root route sends them onward.
      router.replace('/');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      setError(
        /already registered|already exists/i.test(message)
          ? 'That email already has an account. Sign in instead.'
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await resendConfirmation(email.trim());
      setNotice('Sent again. It can take a minute to arrive.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend that email');
    } finally {
      setBusy(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <Screen>
        <SafeAreaView style={s.confirmWrap}>
          <View style={s.tick}><Feather name="mail" size={24} color={colors.mint} /></View>
          <Text style={s.title}>Confirm your email</Text>
          <Text style={s.sub}>
            Your account is created. We sent a link to{' '}
            <Text style={s.email}>{email.trim()}</Text> — open it, then come back
            and sign in.
          </Text>
          {notice ? <Text style={s.notice}>{notice}</Text> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={{ gap: space.md, width: '100%', maxWidth: 380 }}>
            <Button
              label="I've confirmed — sign in"
              onPress={() => { setAwaitingConfirmation(false); setMode('signin'); }}
            />
            <Button label={busy ? 'Sending...' : 'Resend the email'} variant="secondary"
                    onPress={resend} disabled={busy} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <View style={{ gap: space.sm }}>
              <Text style={s.title}>
                {mode === 'signup' ? 'Create your account' : 'Welcome back'}
              </Text>
              <Text style={s.sub}>
                {pendingSave
                  ? 'Create a free account to keep this recipe.'
                  : mode === 'signup'
                    ? 'Save recipes, build collections, and cook from your phone.'
                    : 'Sign in to get back to your Cookbook.'}
              </Text>
            </View>

            <View style={{ gap: space.md }}>
              <Field label="Email" value={email} onChangeText={setEmail}
                     autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
              <Field label="Password" value={password} onChangeText={setPassword}
                     secureTextEntry autoComplete="password"
                     textContentType={mode === 'signup' ? 'newPassword' : 'password'} />
              {mode === 'signup' ? (
                <Text style={s.hint}>At least 6 characters.</Text>
              ) : null}
              {error ? <Text style={s.error}>{error}</Text> : null}
            </View>

            <View style={{ gap: space.md }}>
              <Button
                label={busy ? 'Working...' : mode === 'signup' ? 'Create account' : 'Sign in'}
                onPress={submit}
                disabled={busy || !email.includes('@') || password.length < 6}
              />
              <Pressable
                onPress={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}
                accessibilityRole="button"
                style={s.switch}
              >
                <Text style={s.switchLabel}>
                  {mode === 'signup' ? 'I already have an account' : 'I need an account'}
                </Text>
              </Pressable>
              {!REQUIRE_ACCOUNT ? (
                <Button label="Keep browsing" variant="ghost" onPress={() => goBack('/(tabs)')} />
              ) : null}
            </View>

            <Text style={s.legal}>
              You must be at least 13 to use MenuMatch. By continuing you agree to
              the{' '}
              <Text style={s.legalLink} accessibilityRole="link"
                    onPress={() => router.push('/legal/terms')}>
                Terms of Service
              </Text>
              {' '}and{' '}
              <Text style={s.legalLink} accessibilityRole="link"
                    onPress={() => router.push('/legal/privacy')}>
                Privacy Policy
              </Text>.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

function Field({
  label, ...rest
}: { label: string } & Omit<React.ComponentProps<typeof TextInput>, 'onChange'>) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.input}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        {...rest}
      />
    </View>
  );
}

const s = StyleSheet.create({
  body: { flexGrow: 1, padding: space.xl, gap: space.xxl, justifyContent: 'center' },
  confirmWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: space.xl, gap: space.lg,
  },
  tick: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mintWash,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  sub: { ...type.body, color: colors.textMuted, lineHeight: 21, textAlign: 'center', maxWidth: 360 },
  email: { color: colors.text, fontWeight: '600' },
  fieldLabel: { ...type.micro, color: colors.textFaint },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    color: colors.text, fontSize: 16, minHeight: 48,
  },
  hint: { ...type.small, color: colors.textFaint },
  error: { ...type.small, color: colors.danger, textAlign: 'center' },
  notice: { ...type.small, color: colors.mint, textAlign: 'center' },
  switch: { alignItems: 'center', paddingVertical: space.sm },
  switchLabel: { ...type.small, color: colors.mint },
  legal: { ...type.small, color: colors.textFaint, textAlign: 'center', lineHeight: 18 },
  legalLink: { color: colors.textMuted, textDecorationLine: 'underline' },
});
