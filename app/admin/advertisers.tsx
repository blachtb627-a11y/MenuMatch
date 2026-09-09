import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, ConfirmDialog, EmptyState, Loading, Screen } from '@/components/ui';
import { AdminHeader, Field } from '@/components/admin/Shared';
import { Toast } from '@/components/Toast';
import {
  adminAdvertisers, adminDeleteAdvertiser, adminSaveAdvertiser, type Advertiser,
} from '@/lib/ads';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/**
 * The companies buying placement, and how to reach them.
 *
 * Kept apart from campaigns because a company outlives any one of them: the
 * same contact details get reused every time they come back, and an invoice
 * needs a name to go on. Deleting is refused once anything has run — that
 * record is what a bill is argued from.
 */
export default function AdminAdvertisers() {
  const { me, ready } = useSession();
  const [list, setList] = useState<Advertiser[] | null>(null);
  const [editing, setEditing] = useState<Advertiser | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Advertiser | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await adminAdvertisers());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load companies');
      setList([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (ready && me && me.adminRole !== 'content_admin' && me.adminRole !== 'super_admin') {
    return <Redirect href="/admin" />;
  }
  if (list === null && !error) return <Screen><Loading label="Loading companies" /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title="Companies" back subtitle="Who is buying placement" />

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {error ? <Text style={s.error}>{error}</Text> : null}

          {editing ? (
            <AdvertiserForm
              advertiser={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={(message) => { setEditing(null); setToast(message); void load(); }}
            />
          ) : (
            <Button label="Add a company" onPress={() => setEditing('new')} />
          )}

          {(list ?? []).length === 0 && !editing ? (
            <EmptyState
              title="No companies yet"
              body="Add the company that is paying, then build their ad as a campaign."
            />
          ) : null}

          {(list ?? []).map((a) => (
            <View key={a.id} style={s.card}>
              <View style={s.cardTop}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.name}>{a.name}</Text>
                  {a.contactName || a.contactEmail ? (
                    <Text style={s.detail}>
                      {[a.contactName, a.contactEmail].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {a.websiteUrl ? <Text style={s.detail}>{a.websiteUrl}</Text> : null}
                  <Text style={s.count}>
                    {a.campaignCount} campaign{a.campaignCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <Pressable onPress={() => setEditing(a)} accessibilityRole="button"
                           accessibilityLabel={`Edit ${a.name}`} hitSlop={8}
                           style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}>
                  <Feather name="edit-2" size={15} color={colors.textMuted} />
                </Pressable>
                <Pressable onPress={() => setConfirm(a)} accessibilityRole="button"
                           accessibilityLabel={`Delete ${a.name}`} hitSlop={8}
                           style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}>
                  <Feather name="trash-2" size={15} color={colors.danger} />
                </Pressable>
              </View>

              {a.notes ? <Text style={s.notes}>{a.notes}</Text> : null}

              <Button label="New campaign for this company" variant="secondary"
                      onPress={() => router.push(`/admin/campaign/new?advertiser=${a.id}`)} />
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>

      <ConfirmDialog
        visible={!!confirm}
        title={`Delete ${confirm?.name}?`}
        body="This also deletes their campaigns. It is refused if any of them have already been shown."
        confirmLabel="Delete"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const target = confirm;
          setConfirm(null);
          if (!target) return;
          try {
            await adminDeleteAdvertiser(target.id);
            setToast(`${target.name} deleted`);
          } catch (e) {
            setToast(e instanceof Error ? e.message : 'Could not delete that');
          }
          void load();
        }}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function AdvertiserForm({
  advertiser, onCancel, onSaved,
}: {
  advertiser: Advertiser | null;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(advertiser?.name ?? '');
  const [contactName, setContactName] = useState(advertiser?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(advertiser?.contactEmail ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(advertiser?.websiteUrl ?? '');
  const [notes, setNotes] = useState(advertiser?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError('The company needs a name.'); return; }
    setBusy(true);
    setError(null);
    try {
      await adminSaveAdvertiser({
        id: advertiser?.id ?? null,
        name: name.trim(), contactName, contactEmail, websiteUrl, notes,
      });
      onSaved(advertiser ? `${name.trim()} updated` : `${name.trim()} added`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
      setBusy(false);
    }
  }

  return (
    <View style={s.form}>
      <Text style={s.formTitle}>{advertiser ? 'Edit company' : 'New company'}</Text>
      <Field label="Company name" value={name} onChange={setName} autoFocus
             placeholder="Bertoni Pasta Co." />
      <Field label="Contact name" value={contactName} onChange={setContactName}
             placeholder="Dana Reyes" />
      <Field label="Contact email" value={contactEmail} onChange={setContactEmail}
             placeholder="dana@bertoni.example" keyboardType="email-address" />
      <Field label="Website" value={websiteUrl} onChange={setWebsiteUrl}
             placeholder="https://bertoni.example" keyboardType="url" />
      <Field label="Notes" value={notes} onChange={setNotes} multiline
             placeholder="Billing terms, who signed off, anything worth remembering." />

      {error ? <Text style={s.error}>{error}</Text> : null}

      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button label={busy ? 'Saving…' : 'Save'} onPress={() => void save()}
                disabled={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: space.xl, gap: space.lg, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: space.md, gap: space.md,
  },
  cardTop: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  name: { ...type.bodyStrong, color: colors.text },
  detail: { ...type.small, color: colors.textMuted },
  count: { ...type.micro, color: colors.textFaint },
  notes: { ...type.small, color: colors.textMuted, lineHeight: 19 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.raised,
  },

  form: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.mintDeep, padding: space.lg, gap: space.md,
  },
  formTitle: { ...type.heading, color: colors.text },
});
