import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { AdminHeader, AgePill, PriorityPill, REASON_LABELS, StatTile } from '@/components/admin/Shared';
import { adminReports, adminStats, type AdminStats, type QueuedReport } from '@/lib/admin';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all', label: 'All' },
];

export default function AdminDashboard() {
  const { me, ready } = useSession();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [reports, setReports] = useState<QueuedReport[] | null>(null);
  const [filter, setFilter] = useState('open');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([adminStats(), adminReports(filter)]);
      setStats(s);
      setReports(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the queue');
      setReports([]);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The server refuses non-admins anyway; this keeps the route from flashing.
  if (ready && me && !me.isAdmin) return <Redirect href="/(tabs)/profile" />;
  if (!stats && !error) return <Screen><Loading label="Loading the queue" /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title="Moderation" back
                     subtitle={me?.adminRole ? me.adminRole.replace('_', ' ') : undefined} />

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

          {stats ? (
            <>
              <View style={s.tiles}>
                <StatTile label="Open reports" value={stats.openReports}
                          tone={stats.openReports > 0 ? 'alert' : 'good'} />
                <StatTile label="Past SLA" value={stats.overdue}
                          tone={stats.overdue > 0 ? 'alert' : 'good'} />
                <StatTile label="Open appeals" value={stats.openAppeals} />
              </View>
              <View style={s.tiles}>
                <StatTile label="Published" value={stats.publishedRecipes} />
                <StatTile label="Removed" value={stats.removedRecipes} />
                <StatTile label="Accounts" value={stats.totalUsers} />
              </View>

              <View style={s.linkRow}>
                <LinkCard icon="user" label="Accounts"
                          onPress={() => router.push('/admin/users')} />
                <LinkCard icon="message-square" label="Appeals"
                          count={stats.openAppeals} onPress={() => router.push('/admin/appeals')} />
                <LinkCard icon="users" label="Team"
                          onPress={() => router.push('/admin/team')} />
                {me?.adminRole === 'super_admin' ? (
                  <LinkCard icon="list" label="Audit log"
                            onPress={() => router.push('/admin/audit')} />
                ) : null}
              </View>
            </>
          ) : null}

          <View style={s.filterRow}>
            {FILTERS.map((f) => (
              <Pressable key={f.value} onPress={() => setFilter(f.value)}
                         accessibilityRole="tab"
                         accessibilityState={{ selected: filter === f.value }}
                         style={[s.filter, filter === f.value && s.filterOn]}>
                <Text style={[s.filterLabel, filter === f.value && { color: colors.mint }]}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {reports === null ? <Loading /> : reports.length === 0 ? (
            <EmptyState title="Queue is clear"
                        body="Nothing waiting. Reports appear here the moment they are filed." />
          ) : (
            reports.map((r) => (
              <Pressable key={r.id} style={s.row}
                         onPress={() => router.push(`/admin/report/${r.id}`)}
                         accessibilityRole="button"
                         accessibilityLabel={`${REASON_LABELS[r.reason] ?? r.reason} on ${r.targetTitle ?? 'content'}`}>
                <View style={s.rowTop}>
                  <PriorityPill priority={r.priority} />
                  <AgePill ageHours={r.ageHours} slaHours={r.slaHours} overdue={r.overdue} />
                  {r.reportCount > 1 ? (
                    <View style={s.countPill}>
                      <Text style={s.countLabel}>{r.reportCount} reports</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {REASON_LABELS[r.reason] ?? r.reason}
                </Text>
                <Text style={s.rowMeta} numberOfLines={1}>
                  {r.targetType === 'recipe' ? 'Recipe' : 'Account'}
                  {r.targetTitle ? ` · ${r.targetTitle}` : ''}
                  {r.targetCreator ? ` · @${r.targetCreator}` : ''}
                </Text>
                {r.details ? (
                  <Text style={s.rowDetails} numberOfLines={2}>“{r.details}”</Text>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function LinkCard({
  icon, label, count, onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string; count?: number; onPress: () => void;
}) {
  return (
    <Pressable style={s.linkCard} onPress={onPress} accessibilityRole="button"
               accessibilityLabel={label}>
      <Feather name={icon} size={16} color={colors.mint} />
      <Text style={s.linkLabel}>{label}</Text>
      {count ? <View style={s.badge}><Text style={s.badgeLabel}>{count}</Text></View> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { padding: space.xl, paddingTop: 0, gap: space.md, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger },
  tiles: { flexDirection: 'row', gap: space.md },
  linkRow: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  linkCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md,
    alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border,
  },
  linkLabel: { ...type.small, color: colors.text },
  badge: {
    position: 'absolute', top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.clay, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeLabel: { fontSize: 10, fontWeight: '800', color: colors.ground },
  filterRow: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  filter: {
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  filterOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  filterLabel: { ...type.small, color: colors.textMuted },
  row: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    gap: 6, borderWidth: 1, borderColor: colors.border,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.small, color: colors.textMuted },
  rowDetails: { ...type.small, color: colors.textFaint, fontStyle: 'italic' },
  countPill: {
    paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm,
    backgroundColor: colors.mintWash,
  },
  countLabel: { fontSize: 10, fontWeight: '700', color: colors.mint },
});
