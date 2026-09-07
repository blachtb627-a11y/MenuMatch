import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BackButton, Button, Screen } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { searchAll, type SearchCreator } from '@/lib/search';
import {
  ACCOUNT_REASONS, APP_REASONS, reportProblem, type ProblemTarget,
} from '@/lib/report';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/**
 * The general reporting path (§20.2, §20.6).
 *
 * Recipes are reported from the recipe, because that is where you are standing
 * when you see the problem. This covers the two things that had no route at
 * all: an account, and MenuMatch itself.
 */
export default function ReportProblem() {
  const { isGuest, me } = useSession();
  const [target, setTarget] = useState<ProblemTarget | null>(null);
  const [account, setAccount] = useState<SearchCreator | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<'new' | 'duplicate' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reasons = target === 'app' ? APP_REASONS : ACCOUNT_REASONS;
  const ready = target === 'app' ? !!reason : !!reason && !!account;

  async function submit() {
    if (!ready || !target) return;
    setBusy(true);
    setError(null);
    try {
      const { duplicate } = await reportProblem(
        target, target === 'user' ? account!.id : null, reason!, details,
      );
      setSent(duplicate ? 'duplicate' : 'new');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that report');
    } finally {
      setBusy(false);
    }
  }

  if (isGuest || !me) {
    return (
      <Screen><SafeAreaView style={s.center}>
        <Text style={s.title}>Reporting needs an account</Text>
        <Text style={s.body}>
          We ask for an account so we can follow up, and so the queue is not
          flooded. It takes a moment.
        </Text>
        <Button label="Create an account" onPress={() => router.replace('/auth')} />
        <Button label="Cancel" variant="ghost" onPress={() => goBack('/(tabs)/profile')} />
      </SafeAreaView></Screen>
    );
  }

  if (sent) {
    return (
      <Screen><SafeAreaView style={s.center}>
        <View style={s.tick}><Feather name="check" size={24} color={colors.mint} /></View>
        <Text style={s.title}>
          {sent === 'duplicate' ? 'Already with us' : 'Report received'}
        </Text>
        <Text style={s.body}>
          {sent === 'duplicate'
            ? 'You have an open report about this already, so we have not filed '
              + 'a second one. It is in the queue.'
            : 'A moderator reviews safety, copyright, impersonation, harassment '
              + 'and sexual-content reports within 24 hours, and everything else '
              + 'within 72. You will hear back about the outcome.'}
        </Text>
        <Button label="Done" onPress={() => goBack('/(tabs)/profile')} />
      </SafeAreaView></Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <BackButton fallback="/(tabs)/profile" label="Cancel" />
          <Text style={s.barTitle}>Report a problem</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
          <Text style={s.prompt}>What is this about?</Text>
          <Choice label="An account"
                  hint="Someone’s behaviour, not one particular recipe"
                  on={target === 'user'}
                  onPress={() => { setTarget('user'); setReason(null); }} />
          <Choice label="MenuMatch itself"
                  hint="Something broken, or unsafe about the app"
                  on={target === 'app'}
                  onPress={() => { setTarget('app'); setReason(null); setAccount(null); }} />

          {/* Recipes are deliberately not an option here: the report control on
              the recipe already carries its id, and asking someone to describe
              which recipe they mean loses that. */}
          <View style={s.note}>
            <Feather name="info" size={14} color={colors.textFaint} />
            <Text style={s.noteText}>
              Reporting a recipe? Open the recipe and use the flag on it — that
              way the moderator sees the exact one you mean.
            </Text>
          </View>

          {target === 'user' ? (
            <AccountPicker selected={account} onSelect={setAccount} meId={me.id} />
          ) : null}

          {target && (target === 'app' || account) ? (
            <>
              <Text style={[s.prompt, { marginTop: space.lg }]}>
                {target === 'app' ? 'What kind of problem?' : 'What is happening?'}
              </Text>
              {reasons.map((r) => {
                const on = reason === r.code;
                return (
                  <Pressable key={r.code} onPress={() => setReason(r.code)}
                             accessibilityRole="radio"
                             accessibilityState={{ selected: on }} aria-checked={on}
                             accessibilityLabel={r.label}
                             style={[s.reason, on && s.reasonOn]}>
                    <View style={[s.radio, on && s.radioOn]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.reasonLabel}>{r.label}</Text>
                      {r.hint ? <Text style={s.reasonHint}>{r.hint}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}

              <TextInput
                value={details} onChangeText={setDetails}
                placeholder={target === 'app'
                  ? 'What were you doing when it went wrong?'
                  : 'Anything else we should know (optional)'}
                placeholderTextColor={colors.textFaint}
                multiline style={s.input} maxLength={1000}
                accessibilityLabel="Additional details"
              />

              {reason === 'copyright' ? (
                <Text style={s.footnote}>
                  A formal copyright claim needs your contact details, the
                  original work and a good-faith statement. Filing here flags the
                  account for review; see the Terms for the full claim path.
                </Text>
              ) : null}
            </>
          ) : null}

          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>

        <View style={s.footer}>
          <Button label={busy ? 'Sending…' : 'Send report'} onPress={() => void submit()}
                  disabled={!ready || busy} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

function Choice({
  label, hint, on, onPress,
}: { label: string; hint: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio"
               accessibilityState={{ selected: on }} aria-checked={on}
               accessibilityLabel={label}
               style={[s.reason, on && s.reasonOn]}>
      <View style={[s.radio, on && s.radioOn]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.reasonLabel}>{label}</Text>
        <Text style={s.reasonHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

/** Finds the account being reported, so the report carries an id not a name. */
function AccountPicker({
  selected, onSelect, meId,
}: {
  selected: SearchCreator | null;
  onSelect: (c: SearchCreator | null) => void;
  meId: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchCreator[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (selected || q.length < 2) { setResults(null); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      void searchAll(q, null)
        .then((r) => { if (live) setResults(r.creators.filter((c) => c.id !== meId)); })
        .catch(() => { if (live) setResults([]); })
        .finally(() => { if (live) setSearching(false); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [query, selected, meId]);

  if (selected) {
    return (
      <View style={[s.reason, s.reasonOn, { marginTop: space.lg }]}>
        <Feather name="user" size={16} color={colors.mint} />
        <View style={{ flex: 1 }}>
          <Text style={s.reasonLabel}>{selected.displayName}</Text>
          <Text style={s.reasonHint}>@{selected.username}</Text>
        </View>
        <Pressable onPress={() => onSelect(null)} accessibilityRole="button"
                   accessibilityLabel="Choose a different account" hitSlop={10}>
          <Text style={s.change}>Change</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ marginTop: space.lg, gap: space.sm }}>
      <Text style={s.prompt}>Which account?</Text>
      <View style={s.searchRow}>
        <Feather name="search" size={15} color={colors.textFaint} />
        <TextInput value={query} onChangeText={setQuery} style={s.search}
                   placeholder="Search by username" placeholderTextColor={colors.textFaint}
                   autoCapitalize="none" autoCorrect={false}
                   accessibilityLabel="Search accounts" />
        {searching ? <ActivityIndicator size="small" color={colors.mint} /> : null}
      </View>
      {results?.length === 0 ? (
        <Text style={s.reasonHint}>No account matches that.</Text>
      ) : null}
      {(results ?? []).map((c) => (
        <Pressable key={c.id} onPress={() => onSelect(c)} accessibilityRole="button"
                   accessibilityLabel={`Report ${c.username}`} style={s.reason}>
          <Feather name="user" size={16} color={colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={s.reasonLabel}>{c.displayName}</Text>
            <Text style={s.reasonHint}>@{c.username}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.lg },
  tick: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mintWash,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22, maxWidth: 340 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  barTitle: { ...type.bodyStrong, color: colors.text },
  list: { padding: space.xl, gap: space.sm },
  prompt: { ...type.body, color: colors.textMuted, marginBottom: space.xs },
  reason: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  reasonOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.borderBright },
  radioOn: { borderColor: colors.mint, backgroundColor: colors.mint, borderWidth: 5 },
  reasonLabel: { ...type.body, color: colors.text },
  reasonHint: { ...type.small, color: colors.textFaint },
  change: { ...type.small, color: colors.mint },
  note: {
    flexDirection: 'row', gap: space.sm, alignItems: 'flex-start',
    paddingHorizontal: space.sm, paddingTop: space.sm,
  },
  noteText: { ...type.small, color: colors.textFaint, lineHeight: 18, flex: 1 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 46,
  },
  search: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: space.sm },
  input: {
    marginTop: space.md, minHeight: 96, padding: space.lg, textAlignVertical: 'top',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.text, fontSize: 15,
  },
  footnote: { ...type.small, color: colors.textMuted, lineHeight: 19, marginTop: space.sm },
  error: { ...type.small, color: colors.danger, marginTop: space.sm },
  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border },
});
