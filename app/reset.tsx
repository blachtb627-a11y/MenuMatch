import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/theme';

/** Supabase's own floor. Stated here so the form can refuse before the round trip. */
const MIN_PASSWORD = 6;

type Stage =
  | { kind: 'opening' }
  /** Tokens accepted; the form is live. */
  | { kind: 'ready' }
  /**
   * No usable tokens. The heading travels with the reason because these are
   * different situations: a link that aged out is not the same as landing
   * here with no link at all, and telling the second person their link
   * expired sends them looking for a problem they do not have.
   */
  | { kind: 'unusable'; title: string; body: string; detail?: string }
  | { kind: 'done' };

/**
 * Setting a new password.
 *
 * This is the one auth page that has to *do* something rather than report.
 * Supabase verifies the recovery token itself and then hands over a real
 * session in the URL fragment; that session is the only authority to change
 * the password, and it is short-lived. So the work has to happen here, on the
 * page the link opens, rather than by sending someone back to the app with a
 * token to copy.
 *
 * It lives on the web build for a reason that is easy to miss: a reset is
 * asked for on a phone and finished wherever the mail is read, which is often
 * a laptop. A deep link into the app would strand everyone in that case.
 */
export default function Reset() {
  const [stage, setStage] = useState<Stage>({ kind: 'opening' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;

    async function open() {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        setStage({
          kind: 'unusable',
          title: 'Open this from your email',
          body: 'A reset link opens in a browser, and that is where the new '
            + 'password gets set.',
        });
        return;
      }

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

      /**
       * Failures arrive in the fragment too, and an expired recovery link is
       * the common one — these are deliberately short-lived. Checked before
       * the tokens so an expired link says so instead of falling through to
       * the generic "nothing here" wording.
       */
      const failure = hash.get('error_description') ?? hash.get('error');
      if (failure) {
        setStage({
          kind: 'unusable',
          title: 'This link has expired',
          body: 'Reset links are short-lived and each one works once. Ask for '
            + 'a new one and it will arrive the same way.',
          detail: failure.replace(/\+/g, ' '),
        });
        return;
      }

      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      if (!accessToken || !refreshToken) {
        setStage({
          kind: 'unusable',
          title: 'Nothing to reset here',
          body: 'This is where a reset email lands. Ask for a link and it will '
            + 'bring you back to this page ready to go.',
        });
        return;
      }

      /**
       * Taken out of the address bar as soon as they are read. These are live
       * credentials until they are spent, and leaving them in the URL leaves
       * them in history, in anything the tab is shared with, and in whatever a
       * later navigation sends as a referrer.
       */
      window.history.replaceState(null, '', window.location.pathname);

      // The client is built with detectSessionInUrl: false — correct for a
      // native app with no URL bar, which means nothing picks these up on its
      // own and this page has to hand them over itself.
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (!alive) return;
      if (sessionError) {
        setStage({
          kind: 'unusable',
          title: 'That link did not work',
          body: 'It may have been used already, or cut short on the way. A new '
            + 'link will sort it out.',
          detail: sessionError.message,
        });
        return;
      }
      setStage({ kind: 'ready' });
    }

    void open();
    return () => { alive = false; };
  }, []);

  async function submit() {
    setError(null);
    if (password !== confirm) { setError('Those two do not match.'); return; }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      /**
       * Signed out straight after. The recovery session was issued to change a
       * password, not to hand whoever is at this browser a logged-in account —
       * and a reset is exactly when that browser might not be theirs. Signing
       * in with the new password is also the only proof it took.
       */
      await supabase.auth.signOut();
      setStage({ kind: 'done' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set that password');
    } finally {
      setBusy(false);
    }
  }

  if (stage.kind === 'opening') {
    return (
      <Screen>
        <SafeAreaView style={s.centre}>
          <Text style={s.sub}>Checking your link…</Text>
        </SafeAreaView>
      </Screen>
    );
  }

  if (stage.kind === 'unusable') {
    return (
      <Screen>
        <SafeAreaView style={s.centre}>
          <View style={s.badgeMuted}>
            <Feather name="alert-circle" size={28} color={colors.text} />
          </View>
          <Text style={s.title}>{stage.title}</Text>
          <Text style={s.sub}>{stage.body}</Text>
          {stage.detail ? <Text style={s.detail}>{stage.detail}</Text> : null}
          <View style={s.actions}>
            <Button label="Send a new link"
                    onPress={() => router.replace('/auth?mode=reset')} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  if (stage.kind === 'done') {
    return (
      <Screen>
        <SafeAreaView style={s.centre}>
          <View style={s.badge}>
            <Feather name="check" size={30} color={colors.onMint} />
          </View>
          <Text style={s.title}>Password changed</Text>
          <Text style={s.sub}>
            Sign in with your new password. For safety this browser was signed
            out, so nobody who borrows it lands in your account.
          </Text>
          <View style={s.actions}>
            <Button label="Open Swipzy"
                    onPress={() => { void Linking.openURL('swipzy://').catch(() => {}); }} />
            <Button label="Sign in here" variant="secondary"
                    onPress={() => router.replace('/auth?mode=signin')} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <View style={{ gap: space.sm }}>
              <Text style={s.title}>Choose a new password</Text>
              <Text style={s.sub}>
                This replaces the old one everywhere you are signed in.
              </Text>
            </View>

            <View style={{ gap: space.md }}>
              <Field label="New password" value={password} onChangeText={setPassword}
                     secureTextEntry textContentType="newPassword" autoComplete="password-new" />
              <Field label="Confirm new password" value={confirm} onChangeText={setConfirm}
                     secureTextEntry textContentType="newPassword" autoComplete="password-new" />
              <Text style={s.hint}>At least {MIN_PASSWORD} characters.</Text>
              {tooShort ? <Text style={s.error}>That is too short.</Text> : null}
              {error ? <Text style={s.error}>{error}</Text> : null}
            </View>

            <Button
              label={busy ? 'Saving…' : 'Save new password'}
              onPress={submit}
              disabled={busy || password.length < MIN_PASSWORD || confirm.length === 0}
            />
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
  centre: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: space.xl, gap: space.lg,
  },
  body: { flexGrow: 1, padding: space.xl, gap: space.xxl, justifyContent: 'center' },
  badge: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.mint,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeMuted: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.raised,
    alignItems: 'center', justifyContent: 'center',
  },
  actions: { gap: space.md, alignSelf: 'stretch', maxWidth: 380, width: '100%' },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  sub: {
    ...type.body, color: colors.textMuted, textAlign: 'center',
    lineHeight: 22, maxWidth: 340,
  },
  detail: {
    ...type.small, color: colors.textFaint, textAlign: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: 340,
  },
  fieldLabel: { ...type.micro, color: colors.textFaint },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    color: colors.text, fontSize: 16, minHeight: 48,
  },
  hint: { ...type.small, color: colors.textFaint },
  error: { ...type.small, color: colors.danger, textAlign: 'center' },
});
