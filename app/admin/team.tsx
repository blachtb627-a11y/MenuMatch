import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Toast } from '@/components/Toast';
import { Button, Loading, Screen } from '@/components/ui';
import { AdminHeader } from '@/components/admin/Shared';
import {
  ROLE_DESCRIPTIONS, ROLE_LABELS, adminFindUser, adminGrantRole, adminListAdmins,
  adminRevokeRole, type AdminAccount, type AdminRole, type FoundUser,
} from '@/lib/admin';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

const ROLES: AdminRole[] = ['moderator', 'content_admin', 'super_admin'];

export default function Team() {
  const { me } = useSession();
  const isSuper = me?.adminRole === 'super_admin';

  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundUser[]>([]);
  const [picked, setPicked] = useState<FoundUser | null>(null);
  const [role, setRole] = useState<AdminRole>('moderator');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAdmins(await adminListAdmins());
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not load the team');
      setAdmins([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function search(text: string) {
    setQuery(text);
    if (text.trim().length < 2) { setResults([]); return; }
    try {
      setResults(await adminFindUser(text.trim()));
    } catch {
      setResults([]);
    }
  }

  async function grant() {
    if (!picked) return;
    setBusy(true);
    try {
      await adminGrantRole(picked.id, role);
      setToast(`${picked.username} is now a ${ROLE_LABELS[role].toLowerCase()}`);
      setPicked(null); setQuery(''); setResults([]);
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not grant that role');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(a: AdminAccount) {
    setBusy(true);
    try {
      await adminRevokeRole(a.userId);
      setToast(`Removed ${a.username} from the team`);
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not remove that admin');
    } finally {
      setBusy(false);
    }
  }

  if (admins === null) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title="Team" back
                     subtitle={`${admins.length} account${admins.length === 1 ? '' : 's'} with access`} />
        <ScrollView contentContainerStyle={s.body}>

          {admins.map((a) => (
            <View key={a.userId} style={s.row}>
              <View style={s.avatar}>
                <Text style={s.avatarLetter}>{a.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.rowTitle}>{a.displayName}</Text>
                <Text style={s.rowMeta}>
                  @{a.username}{a.email ? ` · ${a.email}` : ''}
                </Text>
                <View style={s.rolePill}>
                  <Text style={s.rolePillLabel}>{ROLE_LABELS[a.role].toUpperCase()}</Text>
                </View>
              </View>
              {isSuper && a.userId !== me?.id ? (
                <Pressable onPress={() => void revoke(a)} disabled={busy}
                           accessibilityRole="button"
                           accessibilityLabel={`Remove ${a.username} from the team`}
                           style={s.removeBtn}>
                  <Feather name="user-x" size={17} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
          ))}

          {isSuper ? (
            <View style={s.addCard}>
              <Text style={s.addTitle}>Add someone</Text>
              <Text style={s.addBody}>
                Search by username or email. They need a MenuMatch account first.
              </Text>

              <View style={s.searchRow}>
                <Feather name="search" size={16} color={colors.textFaint} />
                <TextInput value={query} onChangeText={search} style={s.searchInput}
                           placeholder="username or email"
                           placeholderTextColor={colors.textFaint}
                           autoCapitalize="none" autoCorrect={false}
                           accessibilityLabel="Search for an account" />
              </View>

              {results.map((u) => (
                <Pressable key={u.id} onPress={() => setPicked(u)}
                           accessibilityRole="button"
                           accessibilityLabel={`Select ${u.username}`}
                           style={[s.result, picked?.id === u.id && s.resultOn]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{u.displayName}</Text>
                    <Text style={s.rowMeta}>@{u.username} · {u.email}</Text>
                  </View>
                  {u.role ? (
                    <Text style={s.alreadyLabel}>{ROLE_LABELS[u.role]}</Text>
                  ) : picked?.id === u.id ? (
                    <Feather name="check" size={16} color={colors.mint} />
                  ) : null}
                </Pressable>
              ))}

              {picked ? (
                <>
                  <Text style={s.addLabel}>ROLE</Text>
                  {ROLES.map((r) => (
                    <Pressable key={r} onPress={() => setRole(r)}
                               accessibilityRole="radio"
                               accessibilityState={{ selected: role === r }}
                               accessibilityLabel={ROLE_LABELS[r]}
                               style={[s.roleOption, role === r && s.roleOptionOn]}>
                      <View style={[s.radio, role === r && s.radioOn]} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.rowTitle}>{ROLE_LABELS[r]}</Text>
                        <Text style={s.roleBlurb}>{ROLE_DESCRIPTIONS[r]}</Text>
                      </View>
                    </Pressable>
                  ))}
                  <Button label={busy ? 'Granting…' : `Make ${picked.username} a ${ROLE_LABELS[role].toLowerCase()}`}
                          onPress={grant} disabled={busy} />
                </>
              ) : null}
            </View>
          ) : (
            <Text style={s.note}>
              Only a super admin can change who has access.
            </Text>
          )}

          <Text style={s.note}>
            Granting and removing access is written to the audit log, including
            when a super admin does it. The last super admin cannot be removed.
          </Text>
        </ScrollView>
      </SafeAreaView>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { padding: space.xl, paddingTop: 0, gap: space.md, paddingBottom: space.xxxl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.mintDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { ...type.bodyStrong, color: colors.mint },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.small, color: colors.textMuted },
  rolePill: {
    alignSelf: 'flex-start', marginTop: 3, paddingHorizontal: space.sm,
    paddingVertical: 3, borderRadius: radius.sm, backgroundColor: colors.mintWash,
  },
  rolePillLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: colors.mint },
  removeBtn: { padding: space.sm },
  addCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg,
    gap: space.md, borderWidth: 1, borderColor: colors.border, marginTop: space.md,
  },
  addTitle: { ...type.heading, color: colors.text },
  addBody: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  addLabel: { ...type.micro, color: colors.textFaint },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.ground, borderRadius: radius.md,
    paddingHorizontal: space.md, height: 44, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  resultOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  alreadyLabel: { ...type.small, color: colors.textFaint },
  roleOption: {
    flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  roleOptionOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1.5,
    borderColor: colors.borderBright, marginTop: 1,
  },
  radioOn: { borderColor: colors.mint, backgroundColor: colors.mint, borderWidth: 5 },
  roleBlurb: { ...type.small, color: colors.textFaint, lineHeight: 17 },
  note: { ...type.small, color: colors.textFaint, lineHeight: 18, marginTop: space.sm },
});
