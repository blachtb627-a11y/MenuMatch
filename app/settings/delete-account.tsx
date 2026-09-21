import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Toast } from '@/components/Toast';
import { BackButton, Button, ConfirmDialog, Screen } from '@/components/ui';
import { deleteMyAccount } from '@/lib/settings';
import { forgetDevice } from '@/lib/device';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/**
 * Deleting your account (§28.4, and App Store guideline 5.1.1(v), which wants
 * this reachable in the app rather than by email).
 *
 * A screen rather than a dialog on the Profile row. The row is two taps from
 * the deck and sits directly under "Sign out", and this cannot be undone, so
 * it is worth making someone read a page and type a word first. The page also
 * has room to say what actually happens, which a dialog does not — and what
 * happens is specific enough that guessing would be worse than useless.
 *
 * The wording below is not written fresh: it is the "How long we keep it"
 * section of the Privacy Policy, said shorter. If one changes the other has to.
 */
const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const { me, signOut } = useSession();
  const [typed, setTyped] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const armed = typed.trim().toUpperCase() === CONFIRM_WORD;

  async function run() {
    setBusy(true);
    try {
      await deleteMyAccount();

      // The credential is gone server-side, so this session is already dead:
      // signOut is here to clear what is held locally, and a failure from a
      // server that no longer recognises us is not worth reporting.
      try { await signOut(); } catch { /* the account is gone either way */ }

      // The device id is anonymous, but it is the handle guest swipes are
      // recorded against. Leaving it would hand the next account on this phone
      // the history of the one that just left.
      try { await forgetDevice(); } catch { /* best effort */ }

      router.replace('/welcome');
    } catch (e) {
      setBusy(false);
      setAsking(false);
      setToast(e instanceof Error ? e.message : 'Could not delete your account');
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <BackButton fallback="/(tabs)/profile" />
          <Text style={s.barTitle}>Delete my account</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.lead}>
            This cannot be undone. {me?.username ? `@${me.username} ` : 'Your account '}
            will stop working the moment you confirm.
          </Text>

          <View style={s.card}>
            <Text style={s.cardLabel}>STRAIGHT AWAY</Text>
            {[
              'You are signed out and cannot sign back in',
              'Your profile disappears from Swipzy',
              'Your recipes come out of the deck and out of search',
              'Drafts you never published are deleted outright',
            ].map((line) => (
              <Row key={line} icon="x" tone={colors.danger} text={line} />
            ))}
          </View>

          <View style={s.card}>
            <Text style={s.cardLabel}>WITHIN 30 DAYS</Text>
            {[
              'Your email, username, display name, bio and picture are erased',
              'Your saves, collections, pantry and swipe history are deleted',
            ].map((line) => (
              <Row key={line} icon="clock" tone={colors.textMuted} text={line} />
            ))}
          </View>

          <View style={s.card}>
            <Text style={s.cardLabel}>WHAT STAYS</Text>
            <Row icon="book-open" tone={colors.textMuted}
                 text="Recipes other people saved stay in their cookbooks, marked as removed — deleting them would empty a stranger's cookbook without asking." />
            <Row icon="shield" tone={colors.textMuted}
                 text="Moderation and audit records outlive the account they concern." />
          </View>

          <Text style={s.note}>
            If you want a copy of anything first, Settings → Export my data
            gives you all of it as a file. After this there is nothing to export.
          </Text>

          <View style={{ gap: space.sm }}>
            <Text style={s.prompt}>Type {CONFIRM_WORD} to confirm</Text>
            <TextInput
              style={s.input}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.textFaint}
              accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
            />
          </View>

          <Button label="Delete my account" variant="danger"
                  disabled={!armed || busy}
                  onPress={() => setAsking(true)} />
          <Button label="Keep my account" variant="secondary"
                  onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>

      <ConfirmDialog
        visible={asking}
        title="Delete your account?"
        body="There is no undo. You will be signed out immediately and will not be able to sign back in."
        confirmLabel={busy ? 'Deleting…' : 'Delete it'}
        cancelLabel="Keep it"
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setAsking(false)}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function Row({
  icon, text, tone,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  text: string;
  tone: string;
}) {
  return (
    <View style={s.row}>
      <Feather name={icon} size={13} color={tone} style={{ marginTop: 2 }} />
      <Text style={s.rowText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
  },
  barTitle: { ...type.bodyStrong, color: colors.text },
  body: { padding: space.xl, paddingTop: 0, gap: space.lg, paddingBottom: space.xxxl },
  lead: { ...type.body, color: colors.text, lineHeight: 21 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    gap: space.sm, borderWidth: 1, borderColor: colors.border,
  },
  cardLabel: { ...type.micro, color: colors.textFaint },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  rowText: { ...type.small, color: colors.text, flex: 1, lineHeight: 18 },
  note: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  prompt: { ...type.small, color: colors.textMuted },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    ...type.body, color: colors.text, letterSpacing: 1,
  },
});
