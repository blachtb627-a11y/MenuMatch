import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Toast } from '@/components/Toast';
import { Button, Loading, Screen } from '@/components/ui';
import { AdminHeader, AgePill, PriorityPill, REASON_LABELS } from '@/components/admin/Shared';
import { adminAct, adminReportDetail, type ModerationAction, type ReportDetail } from '@/lib/admin';
import { colors, radius, space, type } from '@/theme';
import { goBack } from '@/lib/nav';

/** The actions available, and what each one does, stated plainly. */
const ACTIONS: {
  action: ModerationAction; label: string; blurb: string;
  tone: 'neutral' | 'warn' | 'severe'; forTarget: 'recipe' | 'user' | 'both';
}[] = [
  { action: 'dismiss', label: 'Dismiss', tone: 'neutral', forTarget: 'both',
    blurb: 'No violation. Closes the report and notifies nobody.' },
  { action: 'restrict', label: 'Restrict pending review', tone: 'warn', forTarget: 'recipe',
    blurb: 'Hides it from discovery while you decide. Creator is told.' },
  { action: 'remove', label: 'Remove', tone: 'severe', forTarget: 'recipe',
    blurb: 'Takes it down. Creator is notified with the reason and can appeal.' },
  { action: 'warn', label: 'Warn', tone: 'warn', forTarget: 'both',
    blurb: 'Notifies the account without changing anything.' },
  { action: 'suspend', label: 'Suspend account', tone: 'severe', forTarget: 'both',
    blurb: 'Blocks sign-in until reversed. Appealable.' },
  { action: 'ban', label: 'Ban account', tone: 'severe', forTarget: 'both',
    blurb: 'Permanent. Use only for repeat or severe violations.' },
  { action: 'reinstate', label: 'Reinstate', tone: 'neutral', forTarget: 'both',
    blurb: 'Reverses a previous decision and clears its strike.' },
];

export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [selected, setSelected] = useState<ModerationAction | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setReport(await adminReportDetail(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that report');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!selected || !id) return;
    setBusy(true);
    try {
      await adminAct(id, selected, reason.trim(), notes.trim() || undefined);
      setToast('Action recorded');
      setTimeout(() => goBack('/admin'), 700);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not record that');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Screen><SafeAreaView style={{ flex: 1 }}>
        <AdminHeader title="Report" back />
        <Text style={s.error}>{error}</Text>
      </SafeAreaView></Screen>
    );
  }
  if (!report) return <Screen><Loading /></Screen>;

  const targetKind = report.targetType === 'recipe' ? 'recipe' : 'user';
  const available = ACTIONS.filter(
    (a) => a.forTarget === 'both' || a.forTarget === targetKind,
  );
  const resolved = report.status === 'resolved' || report.status === 'dismissed';

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title={REASON_LABELS[report.reason] ?? report.reason} back />
        <ScrollView contentContainerStyle={s.body}>

          <View style={s.metaRow}>
            <PriorityPill priority={report.priority} />
            <AgePill ageHours={report.ageHours} slaHours={report.slaHours ?? 72}
                     overdue={report.overdue} />
            {resolved ? (
              <View style={s.resolvedPill}>
                <Text style={s.resolvedLabel}>{report.status.toUpperCase()}</Text>
              </View>
            ) : null}
          </View>

          {report.details ? (
            <View style={s.quote}>
              <Text style={s.quoteLabel}>WHAT THE REPORTER SAID</Text>
              <Text style={s.quoteText}>{report.details}</Text>
            </View>
          ) : null}

          {/* The content itself, so the decision is made on the material. */}
          {report.recipe ? (
            <View style={s.card}>
              <View style={s.recipeHead}>
                <RecipeCover uri={report.recipe.coverImageUrl} seed={report.recipe.id}
                             title={report.recipe.title} style={s.thumb} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.cardTitle}>{report.recipe.title}</Text>
                  <Text style={s.cardMeta}>
                    @{report.recipe.creator.username}
                    {report.recipe.creator.isSeed ? ' · MenuMatch account' : ''}
                  </Text>
                  <Text style={s.cardMeta}>
                    {report.recipe.status} · {report.recipe.moderationState}
                  </Text>
                </View>
              </View>
              {report.recipe.description ? (
                <Text style={s.cardBody}>{report.recipe.description}</Text>
              ) : null}
              <Text style={s.sectionLabel}>INGREDIENTS</Text>
              <Text style={s.cardBody}>{report.recipe.ingredients.join(' · ')}</Text>
              <Text style={s.sectionLabel}>METHOD</Text>
              {report.recipe.steps.map((step, i) => (
                <Text key={i} style={s.step}>{i + 1}. {step}</Text>
              ))}
            </View>
          ) : null}

          {report.user ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>{report.user.displayName}</Text>
              <Text style={s.cardMeta}>@{report.user.username} · {report.user.status}</Text>
              {report.user.bio ? <Text style={s.cardBody}>{report.user.bio}</Text> : null}
              <Text style={s.cardMeta}>
                {report.user.recipeCount} recipes · {report.user.strikes} strike
                {report.user.strikes === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}

          {report.otherReports.length ? (
            <View style={s.card}>
              <Text style={s.sectionLabel}>
                {report.otherReports.length} OTHER REPORT
                {report.otherReports.length === 1 ? '' : 'S'} ON THIS
              </Text>
              {report.otherReports.map((o, i) => (
                <Text key={i} style={s.cardMeta}>
                  {REASON_LABELS[o.reason] ?? o.reason}
                  {o.details ? ` — “${o.details}”` : ''}
                </Text>
              ))}
            </View>
          ) : null}

          {report.priorActions.length ? (
            <View style={s.card}>
              <Text style={s.sectionLabel}>PRIOR ACTIONS</Text>
              {report.priorActions.map((a, i) => (
                <Text key={i} style={s.cardMeta}>
                  {a.action}{a.reason ? ` — ${a.reason}` : ''}
                </Text>
              ))}
            </View>
          ) : null}

          {!resolved ? (
            <>
              <Text style={s.sectionHeading}>Decision</Text>
              {available.map((a) => {
                const on = selected === a.action;
                return (
                  <Pressable key={a.action} onPress={() => setSelected(a.action)}
                             accessibilityRole="radio"
                             accessibilityState={{ selected: on }}
                             accessibilityLabel={a.label}
                             style={[s.action, on && s.actionOn,
                                     on && a.tone === 'severe' && { borderColor: colors.danger }]}>
                    <View style={[s.radio, on && s.radioOn,
                                  on && a.tone === 'severe' && { backgroundColor: colors.danger,
                                                                 borderColor: colors.danger }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.actionLabel,
                                    a.tone === 'severe' && { color: colors.danger }]}>
                        {a.label}
                      </Text>
                      <Text style={s.actionBlurb}>{a.blurb}</Text>
                    </View>
                  </Pressable>
                );
              })}

              <View style={{ gap: space.xs }}>
                <Text style={s.sectionLabel}>REASON — SHOWN TO THE CREATOR</Text>
                <TextInput value={reason} onChangeText={setReason} style={s.input}
                           placeholder="Unsafe canning instructions for low-acid food"
                           placeholderTextColor={colors.textFaint}
                           accessibilityLabel="Reason shown to the creator" multiline />
              </View>

              <View style={{ gap: space.xs }}>
                <Text style={s.sectionLabel}>INTERNAL NOTES — NOT SHOWN</Text>
                <TextInput value={notes} onChangeText={setNotes} style={s.input}
                           placeholder="Anything the next moderator should know"
                           placeholderTextColor={colors.textFaint}
                           accessibilityLabel="Internal notes" multiline />
              </View>

              <Text style={s.auditNote}>
                Every decision is written to the audit log with your name, and the
                creator is notified with the reason and an appeal path.
              </Text>
            </>
          ) : (
            <Text style={s.auditNote}>
              This report was already {report.status}. Its history is in the audit log.
            </Text>
          )}
        </ScrollView>

        {!resolved ? (
          <View style={s.footer}>
            <Button label={busy ? 'Recording…' : 'Record decision'}
                    onPress={submit}
                    disabled={busy || !selected || (selected !== 'dismiss' && !reason.trim())} />
            {selected && selected !== 'dismiss' && !reason.trim() ? (
              <Text style={s.footerHint}>A reason is required — the creator sees it.</Text>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { padding: space.xl, paddingTop: 0, gap: space.lg, paddingBottom: space.xxxl },
  error: { ...type.body, color: colors.danger, padding: space.xl },
  metaRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
  resolvedPill: {
    paddingHorizontal: space.sm, paddingVertical: 3,
    borderRadius: radius.sm, backgroundColor: colors.mintWash,
  },
  resolvedLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: colors.mint },
  quote: { backgroundColor: colors.raised, borderRadius: radius.md, padding: space.lg, gap: space.xs },
  quoteLabel: { ...type.micro, color: colors.textFaint },
  quoteText: { ...type.body, color: colors.text, fontStyle: 'italic', lineHeight: 21 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    gap: space.sm, borderWidth: 1, borderColor: colors.border,
  },
  recipeHead: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  cardTitle: { ...type.bodyStrong, color: colors.text },
  cardMeta: { ...type.small, color: colors.textMuted },
  cardBody: { ...type.small, color: colors.text, lineHeight: 19 },
  step: { ...type.small, color: colors.text, lineHeight: 19 },
  sectionLabel: { ...type.micro, color: colors.textFaint, marginTop: space.xs },
  sectionHeading: { ...type.heading, color: colors.text, marginTop: space.sm },
  action: {
    flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.lg,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  actionOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1.5,
    borderColor: colors.borderBright, marginTop: 1,
  },
  radioOn: { borderColor: colors.mint, backgroundColor: colors.mint, borderWidth: 5 },
  actionLabel: { ...type.body, color: colors.text },
  actionBlurb: { ...type.small, color: colors.textFaint, lineHeight: 17 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: space.lg, color: colors.text, fontSize: 15,
    minHeight: 72, textAlignVertical: 'top',
  },
  auditNote: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  footer: {
    padding: space.lg, gap: space.sm, borderTopWidth: 1,
    borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  footerHint: { ...type.small, color: colors.textFaint, textAlign: 'center' },
});
