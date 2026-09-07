import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Toast } from '@/components/Toast';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { AdminHeader } from '@/components/admin/Shared';
import { adminAppeals, adminResolveAppeal, type Appeal } from '@/lib/admin';
import { colors, radius, space, type } from '@/theme';

/** §20.5: appeals go to a separate queue and produce a written outcome. */
export default function Appeals() {
  const [appeals, setAppeals] = useState<Appeal[] | null>(null);
  const [outcome, setOutcome] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAppeals(await adminAppeals('open'));
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not load appeals');
      setAppeals([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function resolve(a: Appeal, uphold: boolean) {
    const text = (outcome[a.id] ?? '').trim();
    if (!text) { setToast('Write the outcome first — the user sees it.'); return; }
    setBusy(true);
    try {
      await adminResolveAppeal(a.id, uphold, text);
      setToast(uphold ? 'Appeal upheld, decision reversed' : 'Appeal denied');
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not resolve that appeal');
    } finally {
      setBusy(false);
    }
  }

  if (appeals === null) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title="Appeals" back
                     subtitle={`${appeals.length} waiting`} />
        <ScrollView contentContainerStyle={s.body}>
          {appeals.length === 0 ? (
            <EmptyState title="No open appeals"
                        body="When someone contests a moderation decision, it lands here." />
          ) : appeals.map((a) => (
            <View key={a.id} style={s.card}>
              <View style={s.head}>
                <Text style={s.title}>@{a.user.username}</Text>
                <View style={s.actionPill}>
                  <Text style={s.actionLabel}>{a.action.action.toUpperCase()}</Text>
                </View>
              </View>

              {a.action.reason ? (
                <Text style={s.meta}>Original reason: {a.action.reason}</Text>
              ) : null}

              {/* §20.5: reviewed by someone other than the original actor where
                  staffing allows. Flagged rather than blocked — a solo team has
                  no one else, and a stalled appeal is worse. */}
              {a.sameModerator ? (
                <View style={s.warnRow}>
                  <Feather name="alert-triangle" size={13} color={colors.clay} />
                  <Text style={s.warnText}>
                    You made this decision. Have someone else review it if you can.
                  </Text>
                </View>
              ) : null}

              <View style={s.quote}>
                <Text style={s.quoteLabel}>THEIR STATEMENT</Text>
                <Text style={s.quoteText}>{a.statement}</Text>
              </View>

              <TextInput
                value={outcome[a.id] ?? ''}
                onChangeText={(t) => setOutcome((o) => ({ ...o, [a.id]: t }))}
                style={s.input} multiline
                placeholder="Your written outcome — the user sees this"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel={`Outcome for the appeal from ${a.user.username}`}
              />

              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Button label="Uphold — reverse it" onPress={() => void resolve(a, true)}
                        disabled={busy} style={{ flex: 1 }} />
                <Button label="Deny" variant="secondary" onPress={() => void resolve(a, false)}
                        disabled={busy} style={{ flex: 1 }} />
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { padding: space.xl, paddingTop: 0, gap: space.md, paddingBottom: space.xxxl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg,
    gap: space.md, borderWidth: 1, borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...type.bodyStrong, color: colors.text, flex: 1 },
  actionPill: {
    paddingHorizontal: space.sm, paddingVertical: 3,
    borderRadius: radius.sm, backgroundColor: colors.clayWash,
  },
  actionLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: colors.clay },
  meta: { ...type.small, color: colors.textMuted },
  warnRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  warnText: { ...type.small, color: colors.clay, flex: 1, lineHeight: 17 },
  quote: { backgroundColor: colors.raised, borderRadius: radius.md, padding: space.md, gap: space.xs },
  quoteLabel: { ...type.micro, color: colors.textFaint },
  quoteText: { ...type.small, color: colors.text, lineHeight: 19 },
  input: {
    backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: space.md, color: colors.text, fontSize: 15,
    minHeight: 72, textAlignVertical: 'top',
  },
});
