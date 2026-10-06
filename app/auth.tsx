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
  const { signIn, signUp, resendConfirmation, requestPasswordReset, pendingSave } = useSession();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signup' | 'signin' | 'reset'>(
    params.mode === 'signin' ? 'signin' : params.mode === 'reset' ? 'reset' : 'signup',
  );
  /** Shown after a reset link goes out, in place of the form. */
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Set when the account exists but Supabase is holding the session back.
   *
   * Two routes lead here and they need different words. 'new' is the moment
   * after signing up, when a mail genuinely has just gone out. 'stale' is
   * someone coming back later whose link had expired by the time they opened
   * it — nothing was just sent, and saying otherwise would send them back to
   * an inbox to look for a message that is not coming.
   */
  const [awaitingConfirmation, setAwaitingConfirmation] =
    useState<'new' | 'stale' | null>(null);

  async function submit() {
    setError(null);
    setNotice(null);
    setAwaitingConfirmation(null);
    setResetSent(false);
    setBusy(true);
    try {
      if (mode === 'reset') {
        await requestPasswordReset(email.trim());
        setResetSent(true);
        return;
      }
      if (mode === 'signup') {
        const { needsConfirmation, alreadyRegistered } = await signUp(email.trim(), password);
        if (alreadyRegistered) {
          // Nothing was created and no email went out, so promising one would
          // be a lie. Switched to sign-in rather than just refused: the email
          // is already typed and signing in is what they wanted anyway.
          setMode('signin');
          setNotice('That email already has an account — sign in instead.');
          return;
        }
        if (needsConfirmation) {
          // Do not navigate away: there is no session yet, so leaving this
          // screen would drop the user back into a signed-out app.
          setAwaitingConfirmation('new');
          return;
        }
      } else {
        await signIn(email.trim(), password);
      }
      // A session exists now; the root route sends them onward.
      router.replace('/');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      if (/email not confirmed|not confirmed/i.test(message)) {
        // The password was right — the address was never confirmed, or the
        // link expired before it was opened. Showing the resend screen is the
        // only way out; reporting Supabase's wording leaves them on a screen
        // that cannot help.
        setAwaitingConfirmation('stale');
        return;
      }
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

  if (awaitingConfirmation !== null) {
    return (
      <Screen>
        <SafeAreaView style={s.confirmWrap}>
          <View style={s.tick}><Feather name="mail" size={24} color={colors.mint} /></View>
          <Text style={s.title}>Confirm your email</Text>
          <Text style={s.sub}>
            {awaitingConfirmation === 'new'
              ? 'Your account is created. We sent a link to '
              : 'This account still needs confirming. If the last link expired, '
                + 'send a new one to '}
            <Text style={s.email}>{email.trim()}</Text> — open it, then come back
            and sign in.
          </Text>
          {notice ? <Text style={s.notice}>{notice}</Text> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={{ gap: space.md, width: '100%', maxWidth: 380 }}>
            <Button
              label="I've confirmed — sign in"
              onPress={() => { setAwaitingConfirmation(null); setMode('signin'); }}
            />
            <Button label={busy ? 'Sending...' : 'Resend the email'} variant="secondary"
                    onPress={resend} disabled={busy} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  if (resetSent) {
    return (
      <Screen>
        <SafeAreaView style={s.confirmWrap}>
          <View style={s.tick}><Feather name="mail" size={24} color={colors.mint} /></View>
          <Text style={s.title}>Check your email</Text>
          {/*
            * "If" is doing real work in this sentence. Supabase answers a
            * reset request identically whether or not the address has an
            * account, so that this form cannot be used to find out who is
            * registered. Promising a mail that may not exist would be both a
            * lie and a leak.
            */}
          <Text style={s.sub}>
            If <Text style={s.email}>{email.trim()}</Text> has a Swipzy account,
            a link to set a new password is on its way. It expires before long,
            so use it while it is fresh.
          </Text>
          {notice ? <Text style={s.notice}>{notice}</Text> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={{ gap: space.md, width: '100%', maxWidth: 380 }}>
            <Button label="Back to sign in" onPress={() => {
              setResetSent(false); setMode('signin');
            }} />
            <Button label={busy ? 'Sending...' : 'Send it again'} variant="secondary"
                    onPress={submit} disabled={busy} />
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
                {mode === 'signup' ? 'Create your account'
                  : mode === 'reset' ? 'Reset your password'
                    : 'Welcome back'}
              </Text>
              <Text style={s.sub}>
                {mode === 'reset'
                  ? 'Enter the email you signed up with and we will send a link '
                    + 'to set a new password.'
                  : pendingSave
                    ? 'Create a free account to keep this recipe.'
                    : mode === 'signup'
                      ? 'Save recipes, build collections, and cook from your phone.'
                      : 'Sign in to get back to your Cookbook.'}
              </Text>
            </View>

            <View style={{ gap: space.md }}>
              <Field label="Email" value={email} onChangeText={setEmail}
                     autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
              {mode !== 'reset' ? (
                <Field label="Password" value={password} onChangeText={setPassword}
                       secureTextEntry autoComplete="password"
                       textContentType={mode === 'signup' ? 'newPassword' : 'password'} />
              ) : null}
              {mode === 'signup' ? (
                <Text style={s.hint}>At least 6 characters.</Text>
              ) : null}
              {error ? <Text style={s.error}>{error}</Text> : null}
            </View>

            <View style={{ gap: space.md }}>
              <Button
                label={busy ? 'Working...'
                  : mode === 'signup' ? 'Create account'
                    : mode === 'reset' ? 'Send reset link'
                      : 'Sign in'}
                onPress={submit}
                // Reset asks for nothing but an address, so holding it to a
                // password length would leave the button dead forever.
                disabled={busy || !email.includes('@')
                  || (mode !== 'reset' && password.length < 6)}
              />
              {mode === 'signin' ? (
                <Pressable
                  onPress={() => { setMode('reset'); setError(null); setNotice(null); }}
                  accessibilityRole="button"
                  style={s.switch}
                >
                  <Text style={s.switchLabel}>Forgot your password?</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  setMode(mode === 'signup' ? 'signin' : mode === 'reset' ? 'signin' : 'signup');
                  setError(null);
                }}
                accessibilityRole="button"
                style={s.switch}
              >
                <Text style={s.switchLabel}>
                  {mode === 'signup' ? 'I already have an account'
                    : mode === 'reset' ? 'Back to sign in'
                      : 'I need an account'}
                </Text>
              </Pressable>
              {!REQUIRE_ACCOUNT ? (
                <Button label="Keep browsing" variant="ghost" onPress={() => goBack('/(tabs)')} />
              ) : null}
            </View>

            {/*
              * Not shown when resetting: this is the consent you give when
              * opening an account, and a password reset creates nothing to
              * consent to. Reprinting it there implies otherwise.
              */}
            {mode === 'reset' ? null : (
            <Text style={s.legal}>
              You must be at least 13 to use Swipzy. By continuing you agree to
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
            )}
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
