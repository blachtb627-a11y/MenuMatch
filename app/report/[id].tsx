import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/**
 * §20.2 report reasons, Appendix D taxonomy.
 *
 * Apple's Guideline 1.2 makes an in-app flagging mechanism a launch blocker
 * (§20.6), so this ships with the first build rather than in response to a
 * rejection.
 */
const REASONS = [
  { code: 'unsafe_food', label: 'Unsafe food content',
    hint: 'Unsafe canning, unsafe temperatures, toxic ingredients' },
  { code: 'copyright', label: 'Copyright or stolen content', hint: null },
  { code: 'impersonation', label: 'Impersonation', hint: null },
  { code: 'harassment', label: 'Harassment or hate', hint: null },
  { code: 'sexual', label: 'Sexual content', hint: null },
  { code: 'spam', label: 'Spam or misleading', hint: null },
  { code: 'not_recipe', label: 'Not a recipe', hint: null },
  { code: 'other', label: 'Something else', hint: null },
] as const;

export default function Report() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isGuest, me } = useSession();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason || !id || !me) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('reports').insert({
        reporter_id: me.id,
        target_type: 'recipe',
        target_id: id,
        reason,
        details: details.trim() || null,
      });
      if (err) throw new Error(err.message);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that report');
    } finally {
      setBusy(false);
    }
  }

  if (isGuest) {
    return (
      <Screen><SafeAreaView style={s.center}>
        <Text style={s.title}>Reporting needs an account</Text>
        <Text style={s.body}>
          We ask for an account so we can follow up and so the queue is not
          flooded. It takes a moment.
        </Text>
        <Button label="Create an account" onPress={() => router.replace('/auth')} />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </SafeAreaView></Screen>
    );
  }

  if (sent) {
    return (
      <Screen><SafeAreaView style={s.center}>
        <View style={s.tick}><Feather name="check" size={24} color={colors.mint} /></View>
        <Text style={s.title}>Report received</Text>
        <Text style={s.body}>
          A moderator reviews unsafe-content reports within 24 hours, and
          everything else within 72. You will hear back about the outcome.
        </Text>
        <Button label="Done" onPress={() => router.back()} />
      </SafeAreaView></Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={s.bar}>
          <Pressable onPress={() => router.back()} accessibilityRole="button"
                     accessibilityLabel="Cancel">
            <Feather name="x" size={22} color={colors.textMuted} />
          </Pressable>
          <Text style={s.barTitle}>Report recipe</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView contentContainerStyle={s.list}>
          <Text style={s.prompt}>What is wrong with this recipe?</Text>
          {REASONS.map((r) => {
            const on = reason === r.code;
            return (
              <Pressable
                key={r.code}
                onPress={() => setReason(r.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={r.label}
                style={[s.reason, on && s.reasonOn]}
              >
                <View style={[s.radio, on && s.radioOn]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.reasonLabel}>{r.label}</Text>
                  {r.hint ? <Text style={s.reasonHint}>{r.hint}</Text> : null}
                </View>
              </Pressable>
            );
          })}

          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Anything else we should know (optional)"
            placeholderTextColor={colors.textFaint}
            multiline
            style={s.input}
            accessibilityLabel="Additional details"
            maxLength={1000}
          />

          {reason === 'copyright' ? (
            // §18.2: copyright complaints have their own path, distinct from
            // general content reports.
            <Text style={s.copyright}>
              A copyright claim needs more than a report: we need your contact
              details, the original work, and a good-faith statement. Filing
              here flags the recipe for review; the full claim form follows.
            </Text>
          ) : null}

          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>

        <View style={s.footer}>
          <Button label={busy ? 'Sending...' : 'Send report'} onPress={submit}
                  disabled={!reason || busy} />
        </View>
      </SafeAreaView>
    </Screen>
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
    padding: space.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  barTitle: { ...type.bodyStrong, color: colors.text },
  list: { padding: space.xl, gap: space.sm },
  prompt: { ...type.body, color: colors.textMuted, marginBottom: space.sm },
  reason: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  reasonOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.borderBright,
  },
  radioOn: { borderColor: colors.mint, backgroundColor: colors.mint, borderWidth: 5 },
  reasonLabel: { ...type.body, color: colors.text },
  reasonHint: { ...type.small, color: colors.textFaint },
  input: {
    marginTop: space.md, minHeight: 96, padding: space.lg, textAlignVertical: 'top',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.text, fontSize: 15,
  },
  copyright: { ...type.small, color: colors.textMuted, lineHeight: 19, marginTop: space.sm },
  error: { ...type.small, color: colors.danger, marginTop: space.sm },
  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border },
});
