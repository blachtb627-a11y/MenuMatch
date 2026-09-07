import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Toast } from '@/components/Toast';
import { Button, Loading, Screen } from '@/components/ui';
import { AdminHeader, REASON_LABELS } from '@/components/admin/Shared';
import { StatusPill } from '@/components/admin/StatusPill';
import {
  adminDeleteUser, adminPurgeUser, adminSetUserStatus, adminUserDetail, relativeTime,
  ROLE_LABELS, type AdminUserDetail,
} from '@/lib/admin';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

type Pending =
  | { kind: 'status'; status: 'active' | 'suspended' | 'banned'; label: string; blurb: string }
  | { kind: 'delete' }
  | { kind: 'purge' };

export default function AdminUserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useSession();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setUser(await adminUserDetail(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that account');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  function choose(next: Pending) {
    setPending((cur) =>
      cur && cur.kind === next.kind
        && (cur.kind !== 'status' || next.kind !== 'status' || cur.status === next.status)
        ? null : next);
    setReason('');
    setConfirmText('');
  }

  async function submit() {
    if (!pending || !id || !user) return;
    setBusy(true);
    try {
      if (pending.kind === 'purge') {
        await adminPurgeUser(id);
        setToast('Account removed');
        setTimeout(() => router.back(), 900);
        return;
      }
      if (pending.kind === 'delete') {
        const r = await adminDeleteUser(id, reason.trim());
        setToast(r.recipesDeleted
          ? `Account deleted with ${r.recipesDeleted} recipe${r.recipesDeleted === 1 ? '' : 's'}`
          : 'Account deleted');
        setTimeout(() => router.back(), 900);
        return;
      }
      await adminSetUserStatus(id, pending.status, reason.trim());
      setToast(pending.status === 'active' ? 'Account reinstated' : `Account ${pending.status}`);
      setPending(null);
      setReason('');
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not apply that');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Screen><SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title="Account" back />
        <Text style={s.error}>{error}</Text>
      </SafeAreaView></Screen>
    );
  }
  if (!user) return <Screen><Loading /></Screen>;

  const isSelf = me?.id === user.id;
  const isDeleted = user.status === 'deleted';
  // Mirrors the server's guards so the buttons never promise something it refuses.
  const canModerate = !isSelf && !isDeleted && user.adminRole !== 'super_admin';
  const canDelete = !isSelf && !isDeleted && !user.adminRole
    && (me?.adminRole === 'content_admin' || me?.adminRole === 'super_admin');

  const actions: Pending[] = [];
  if (user.status !== 'suspended') {
    actions.push({ kind: 'status', status: 'suspended', label: 'Suspend account',
      blurb: 'Blocks the account until you reinstate it. Appealable.' });
  }
  if (user.status !== 'banned') {
    actions.push({ kind: 'status', status: 'banned', label: 'Ban account',
      blurb: 'Permanent block. Use for repeat or severe violations.' });
  }
  if (user.status !== 'active') {
    actions.push({ kind: 'status', status: 'active', label: 'Reinstate account',
      blurb: 'Restores full access and notifies the account.' });
  }

  const deleteReady = confirmText.trim().toLowerCase() === user.username.toLowerCase();
  const canSubmit = pending?.kind === 'purge'
    || (!!reason.trim() && (pending?.kind !== 'delete' || deleteReady));

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title={user.displayName} back subtitle={`@${user.username}`} />
        <ScrollView contentContainerStyle={s.body}>

          <View style={s.metaRow}>
            <StatusPill status={user.status} />
            {user.adminRole ? (
              <View style={s.rolePill}>
                <Text style={s.roleLabel}>{ROLE_LABELS[user.adminRole].toUpperCase()}</Text>
              </View>
            ) : null}
            {user.isSeedAccount ? (
              <View style={s.rolePill}><Text style={s.roleLabel}>MENUMATCH</Text></View>
            ) : null}
          </View>

          <View style={s.card}>
            <Field label="Last active" value={relativeTime(user.lastActiveAt)} />
            <Field label="Joined" value={new Date(user.createdAt).toLocaleDateString()} />
            {user.email ? <Field label="Email" value={user.email} /> : null}
            {user.ageBand ? (
              <Field label="Age band" value={user.ageBand.replace(/_/g, ' ')} />
            ) : null}
            {user.deletedAt ? (
              <Field label="Deleted"
                     value={new Date(user.deletedAt).toLocaleDateString()} tone="alert" />
            ) : null}
            {user.bio ? <Text style={s.bio}>{user.bio}</Text> : null}
          </View>

          <View style={s.countGrid}>
            <Count label="Recipes" value={user.counts.recipes} />
            <Count label="Published" value={user.counts.published} />
            <Count label="Saves" value={user.counts.saves} />
            <Count label="Cooks" value={user.counts.cooks} />
            <Count label="Strikes" value={user.strikes.length}
                   tone={user.strikes.length ? 'alert' : undefined} />
            <Count label="Reports" value={user.counts.reportsAgainst}
                   tone={user.counts.reportsAgainst ? 'alert' : undefined} />
          </View>

          {user.strikes.length ? (
            <View style={s.card}>
              <Text style={s.sectionLabel}>STRIKES</Text>
              {user.strikes.map((st, i) => (
                <Text key={i} style={s.line}>
                  {REASON_LABELS[st.reason] ?? st.reason}
                  {' · '}{new Date(st.createdAt).toLocaleDateString()}
                </Text>
              ))}
            </View>
          ) : null}

          {user.reports.length ? (
            <View style={s.card}>
              <Text style={s.sectionLabel}>REPORTS INVOLVING THIS ACCOUNT</Text>
              {user.reports.slice(0, 10).map((r) => (
                <Pressable key={r.id} onPress={() => router.push(`/admin/report/${r.id}`)}
                           accessibilityRole="button"
                           accessibilityLabel={`Open report: ${REASON_LABELS[r.reason] ?? r.reason}`}>
                  <Text style={s.link}>
                    {REASON_LABELS[r.reason] ?? r.reason} · {r.targetType} · {r.status}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {user.moderationHistory.length ? (
            <View style={s.card}>
              <Text style={s.sectionLabel}>MODERATION HISTORY</Text>
              {user.moderationHistory.map((m, i) => (
                <Text key={i} style={s.line}>
                  {m.action}{m.reason ? ` — ${m.reason}` : ''}
                  {m.moderator ? ` · @${m.moderator}` : ''}
                  {' · '}{new Date(m.createdAt).toLocaleDateString()}
                </Text>
              ))}
            </View>
          ) : null}

          {user.recipes.length ? (
            <View style={s.card}>
              <Text style={s.sectionLabel}>THEIR RECIPES</Text>
              {user.recipes.map((r) => (
                <Pressable key={r.id} style={s.recipeRow}
                           onPress={() => router.push(`/recipe/${r.id}`)}
                           accessibilityRole="button" accessibilityLabel={r.title}>
                  <RecipeCover uri={r.coverImageUrl} seed={r.id} title={r.title}
                               style={s.thumb} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.recipeTitle} numberOfLines={1}>{r.title}</Text>
                    <Text style={s.cardMeta}>{r.status} · {r.moderationState}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={s.sectionHeading}>Manage</Text>

          {isSelf ? (
            <Text style={s.note}>
              This is your own account. Moderation actions on yourself are refused;
              another super admin has to act instead.
            </Text>
          ) : isDeleted ? (
            <>
              <Text style={s.note}>
                This account is deleted. Its personal data is cleared 30 days after
                deletion; the moderation record is kept.
              </Text>
              {me?.adminRole === 'super_admin' ? (
                <Pressable onPress={() => choose({ kind: 'purge' })}
                           accessibilityRole="radio"
                           accessibilityState={{ selected: pending?.kind === 'purge' }}
                           accessibilityLabel="Remove this account from the table"
                           style={[s.action, pending?.kind === 'purge' && s.actionOn,
                                   pending?.kind === 'purge' && { borderColor: colors.danger }]}>
                  <View style={[s.radio, pending?.kind === 'purge' && s.radioOn,
                                pending?.kind === 'purge' && { backgroundColor: colors.danger,
                                                               borderColor: colors.danger }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[s.actionLabel, { color: colors.danger }]}>
                      Remove from the table now
                    </Text>
                    <Text style={s.actionBlurb}>
                      Skips the 30-day wait and clears the row outright. For seed and
                      test accounts, where there is nobody behind it to protect.
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </>
          ) : !canModerate ? (
            <Text style={s.note}>
              This account is a super admin. Revoke the role on the Team screen
              before taking action on it.
            </Text>
          ) : (
            <>
              {actions.map((a) => {
                if (a.kind !== 'status') return null;
                const on = pending?.kind === 'status' && pending.status === a.status;
                const severe = a.status !== 'active';
                return (
                  <Pressable key={a.status} onPress={() => choose(a)}
                             accessibilityRole="radio"
                             accessibilityState={{ selected: on }}
                             accessibilityLabel={a.label}
                             style={[s.action, on && s.actionOn,
                                     on && severe && { borderColor: colors.danger }]}>
                    <View style={[s.radio, on && s.radioOn,
                                  on && severe && { backgroundColor: colors.danger,
                                                    borderColor: colors.danger }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.actionLabel, severe && { color: colors.danger }]}>
                        {a.label}
                      </Text>
                      <Text style={s.actionBlurb}>{a.blurb}</Text>
                    </View>
                  </Pressable>
                );
              })}

              {canDelete ? (
                <Pressable onPress={() => choose({ kind: 'delete' })}
                           accessibilityRole="radio"
                           accessibilityState={{ selected: pending?.kind === 'delete' }}
                           accessibilityLabel="Delete account"
                           style={[s.action, pending?.kind === 'delete' && s.actionOn,
                                   pending?.kind === 'delete' && { borderColor: colors.danger }]}>
                  <View style={[s.radio, pending?.kind === 'delete' && s.radioOn,
                                pending?.kind === 'delete' && { backgroundColor: colors.danger,
                                                                borderColor: colors.danger }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[s.actionLabel, { color: colors.danger }]}>Delete account</Text>
                    <Text style={s.actionBlurb}>
                      Removes the account and its {user.counts.recipes} recipe
                      {user.counts.recipes === 1 ? '' : 's'} from the app immediately and
                      revokes sign-in. Cannot be undone.
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {pending && pending.kind !== 'purge' ? (
                <>
                  <View style={{ gap: space.xs }}>
                    <Text style={s.sectionLabel}>
                      {pending.kind === 'delete'
                        ? 'REASON — RECORDED IN THE AUDIT LOG'
                        : 'REASON — SHOWN TO THE ACCOUNT'}
                    </Text>
                    <TextInput value={reason} onChangeText={setReason} style={s.input}
                               placeholder="Repeated unsafe canning instructions after a warning"
                               placeholderTextColor={colors.textFaint}
                               accessibilityLabel="Reason" multiline />
                  </View>

                  {pending.kind === 'delete' ? (
                    <View style={{ gap: space.xs }}>
                      <Text style={s.sectionLabel}>
                        TYPE {user.username.toUpperCase()} TO CONFIRM
                      </Text>
                      <TextInput value={confirmText} onChangeText={setConfirmText}
                                 style={[s.input, s.inputShort]}
                                 autoCapitalize="none" autoCorrect={false}
                                 placeholder={user.username}
                                 placeholderTextColor={colors.textFaint}
                                 accessibilityLabel="Confirm the username" />
                    </View>
                  ) : null}

                  <Text style={s.note}>
                    {pending.kind === 'delete'
                      ? 'Their recipes come down with the account. Moderation records, reports and the audit trail are kept; the remaining personal data is purged after 30 days.'
                      : 'The account is notified with this reason and can appeal it. The decision is written to the audit log with your name.'}
                  </Text>
                </>
              ) : null}
            </>
          )}
        </ScrollView>

        {pending ? (
          <View style={s.footer}>
            <Button
              label={busy ? 'Working…'
                : pending.kind === 'purge' ? 'Remove permanently'
                : pending.kind === 'delete' ? 'Delete this account'
                : pending.status === 'active' ? 'Reinstate' : `Confirm ${pending.status}`}
              onPress={submit}
              // A destructive confirmation shouldn't wear the affirmative colour.
              variant={pending.kind !== 'status' || pending.status !== 'active'
                ? 'danger' : 'primary'}
              disabled={busy || !canSubmit} />
            {pending.kind === 'purge' ? (
              <Text style={s.footerHint}>This cannot be undone.</Text>
            ) : !reason.trim() ? (
              <Text style={s.footerHint}>A reason is required.</Text>
            ) : pending.kind === 'delete' && !deleteReady ? (
              <Text style={s.footerHint}>Type the username exactly to confirm.</Text>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function Field({
  label, value, tone,
}: { label: string; value: string; tone?: 'alert' }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={[s.fieldValue, tone === 'alert' && { color: colors.clay }]}>{value}</Text>
    </View>
  );
}

function Count({
  label, value, tone,
}: { label: string; value: number; tone?: 'alert' }) {
  return (
    <View style={s.count}>
      <Text style={[s.countValue, tone === 'alert' && { color: colors.clay }]}>{value}</Text>
      <Text style={s.countLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: space.xl, paddingTop: 0, gap: space.lg, paddingBottom: space.xxxl },
  error: { ...type.body, color: colors.danger, padding: space.xl },
  metaRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
  rolePill: {
    paddingHorizontal: space.sm, paddingVertical: 3,
    borderRadius: radius.sm, backgroundColor: colors.mintWash,
  },
  roleLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: colors.mint },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    gap: space.sm, borderWidth: 1, borderColor: colors.border,
  },
  field: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  fieldLabel: { ...type.small, color: colors.textMuted },
  fieldValue: { ...type.small, color: colors.text, flexShrink: 1, textAlign: 'right' },
  bio: { ...type.small, color: colors.text, lineHeight: 19, marginTop: space.xs },
  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  count: {
    flexGrow: 1, minWidth: 88, backgroundColor: colors.surface, borderRadius: radius.md,
    padding: space.md, gap: 2, borderWidth: 1, borderColor: colors.border,
  },
  countValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  countLabel: { ...type.small, color: colors.textMuted },
  sectionLabel: { ...type.micro, color: colors.textFaint },
  sectionHeading: { ...type.heading, color: colors.text, marginTop: space.sm },
  line: { ...type.small, color: colors.text, lineHeight: 19 },
  link: { ...type.small, color: colors.mint, lineHeight: 19 },
  cardMeta: { ...type.small, color: colors.textMuted },
  recipeRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
  recipeTitle: { ...type.body, color: colors.text },
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
  inputShort: { minHeight: 0 },
  note: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  footer: {
    padding: space.lg, gap: space.sm, borderTopWidth: 1,
    borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  footerHint: { ...type.small, color: colors.textFaint, textAlign: 'center' },
});
