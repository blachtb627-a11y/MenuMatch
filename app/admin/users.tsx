import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { AdminHeader } from '@/components/admin/Shared';
import { StatusPill } from '@/components/admin/StatusPill';
import {
  adminUsers, relativeTime, ROLE_LABELS,
  type AdminUserPage, type AdminUserRow,
} from '@/lib/admin';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

const PAGE = 50;

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'banned', label: 'Banned' },
  { value: 'deleted', label: 'Deleted' },
];

export default function AdminUsersScreen() {
  const { me, ready } = useSession();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState<AdminUserPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Typing shouldn't fire a query per keystroke against a table this wide.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(query.trim()); setOffset(0); }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    try {
      setPage(await adminUsers(debounced, status, PAGE, offset));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load accounts');
      setPage({ total: 0, users: [] });
    }
  }, [debounced, status, offset]);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = page?.users ?? [];
  const total = page?.total ?? 0;
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PAGE)), [total]);
  const pageIndex = Math.floor(offset / PAGE);

  if (ready && me && !me.isAdmin) return <Redirect href="/(tabs)/profile" />;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title="Accounts" back
                     subtitle={total ? `${total} account${total === 1 ? '' : 's'}` : undefined} />

        <View style={s.searchWrap}>
          <Feather name="search" size={15} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            style={s.search}
            placeholder={me?.adminRole === 'super_admin'
              ? 'Search name, username or email'
              : 'Search name or username'}
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search accounts"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button"
                       accessibilityLabel="Clear search">
              <Feather name="x" size={15} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    style={s.filterBarOuter}
                    contentContainerStyle={s.filterRow}>
          {FILTERS.map((f) => (
            <Pressable key={f.value}
                       onPress={() => { setStatus(f.value); setOffset(0); }}
                       accessibilityRole="tab"
                       accessibilityState={{ selected: status === f.value }}
                       style={[s.filter, status === f.value && s.filterOn]}>
              <Text style={[s.filterLabel, status === f.value && { color: colors.mint }]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView
          contentContainerStyle={s.body}
          refreshControl={
            <RefreshControl refreshing={refreshing} tintColor={colors.mint}
                            onRefresh={async () => {
                              setRefreshing(true); await load(); setRefreshing(false);
                            }} />
          }
        >
          {error ? <Text style={s.error}>{error}</Text> : null}

          {page === null ? <Loading /> : rows.length === 0 ? (
            <EmptyState
              title={debounced ? 'No matches' : 'No accounts'}
              body={debounced
                ? `Nothing matched “${debounced}”.`
                : 'Accounts appear here as people sign up.'} />
          ) : rows.map((u) => <UserRow key={u.id} user={u} />)}

          {pageCount > 1 ? (
            <View style={s.pager}>
              <Pressable disabled={pageIndex === 0}
                         onPress={() => setOffset(Math.max(0, offset - PAGE))}
                         accessibilityRole="button" accessibilityLabel="Previous page"
                         style={[s.pageBtn, pageIndex === 0 && s.pageBtnOff]}>
                <Feather name="chevron-left" size={16}
                         color={pageIndex === 0 ? colors.textFaint : colors.text} />
              </Pressable>
              <Text style={s.pageLabel}>Page {pageIndex + 1} of {pageCount}</Text>
              <Pressable disabled={pageIndex + 1 >= pageCount}
                         onPress={() => setOffset(offset + PAGE)}
                         accessibilityRole="button" accessibilityLabel="Next page"
                         style={[s.pageBtn, pageIndex + 1 >= pageCount && s.pageBtnOff]}>
                <Feather name="chevron-right" size={16}
                         color={pageIndex + 1 >= pageCount ? colors.textFaint : colors.text} />
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function UserRow({ user }: { user: AdminUserRow }) {
  return (
    <Pressable style={s.row}
               onPress={() => router.push(`/admin/user/${user.id}`)}
               accessibilityRole="button"
               accessibilityLabel={`${user.displayName}, @${user.username}`}>
      <View style={s.rowTop}>
        <Text style={s.rowName} numberOfLines={1}>{user.displayName}</Text>
        <StatusPill status={user.status} />
        {user.adminRole ? (
          <View style={s.rolePill}>
            <Text style={s.roleLabel}>{ROLE_LABELS[user.adminRole].toUpperCase()}</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.rowHandle} numberOfLines={1}>
        @{user.username}{user.email ? ` · ${user.email}` : ''}
      </Text>
      <View style={s.rowStats}>
        <Stat icon="clock" label={`Active ${relativeTime(user.lastActiveAt)}`} />
        <Stat icon="book-open" label={`${user.recipeCount}`} />
        <Stat icon="bookmark" label={`${user.saveCount}`} />
        {user.strikes ? (
          <Stat icon="alert-triangle" label={`${user.strikes}`} tone="alert" />
        ) : null}
        {user.reportsAgainst ? (
          <Stat icon="flag" label={`${user.reportsAgainst}`} tone="alert" />
        ) : null}
      </View>
    </Pressable>
  );
}

function Stat({
  icon, label, tone,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string; tone?: 'alert';
}) {
  const fg = tone === 'alert' ? colors.clay : colors.textFaint;
  return (
    <View style={s.stat}>
      <Feather name={icon} size={11} color={fg} />
      <Text style={[s.statLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.xl, paddingHorizontal: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  search: { flex: 1, paddingVertical: 11, color: colors.text, fontSize: 15 },
  // flexGrow/Shrink 0 keeps the horizontal chip strip from stretching vertically.
  filterBarOuter: { flexGrow: 0, flexShrink: 0, marginTop: space.md },
  filterRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xl },
  filter: {
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  filterOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  filterLabel: { ...type.small, color: colors.textMuted },
  body: { padding: space.xl, gap: space.md, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger },
  row: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    gap: 5, borderWidth: 1, borderColor: colors.border,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  rowName: { ...type.bodyStrong, color: colors.text, flexShrink: 1 },
  rowHandle: { ...type.small, color: colors.textMuted },
  rowStats: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap', marginTop: 2 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11, fontWeight: '600' },
  rolePill: {
    paddingHorizontal: space.sm, paddingVertical: 3,
    borderRadius: radius.sm, backgroundColor: colors.mintWash,
  },
  roleLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: colors.mint },
  pager: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.lg, marginTop: space.md,
  },
  pageBtn: {
    width: 34, height: 34, borderRadius: radius.md, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  pageBtnOff: { opacity: 0.4 },
  pageLabel: { ...type.small, color: colors.textMuted },
});
