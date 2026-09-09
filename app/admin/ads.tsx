import React, { useCallback, useState } from 'react';
import {
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { AdminHeader, StatTile } from '@/components/admin/Shared';
import { Toast } from '@/components/Toast';
import {
  STATUS_LABELS, adminCampaigns, adminSetCampaignStatus, clickRate, describeDelivery,
  goalProgress, type Campaign, type CampaignStatus,
} from '@/lib/ads';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/**
 * Every campaign, and whether it is actually being seen (§38).
 *
 * The question this page exists to answer is the one an advertiser asks on the
 * phone — "is my ad running?" — so each row leads with delivery rather than
 * with a status word. A campaign can be Running and still be showing nothing
 * today, having already met its pace, and a page that only said "Running"
 * would be technically true and useless.
 */

/**
 * "Current" covers everything that could be running — paused included, so
 * pausing something does not make it disappear from the view you paused it in
 * and leave you hunting for the tab that un-pauses it.
 */
const FILTERS: { value: 'current' | 'all' | CampaignStatus; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'draft', label: 'Drafts' },
  { value: 'completed', label: 'Finished' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

export default function AdminAds() {
  const { me, ready } = useSession();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('current');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCampaigns(await adminCampaigns());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load campaigns');
      setCampaigns([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function setStatus(c: Campaign, status: CampaignStatus) {
    setBusy(c.id);
    try {
      await adminSetCampaignStatus(c.id, status);
      setToast(status === 'active' ? `${c.name} is live` : `${c.name} ${STATUS_LABELS[status].toLowerCase()}`);
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not change that');
    } finally {
      setBusy(null);
    }
  }

  // Selling placement is not a moderator's job; the RPCs refuse them anyway.
  if (ready && me && me.adminRole !== 'content_admin' && me.adminRole !== 'super_admin') {
    return <Redirect href="/admin" />;
  }
  if (campaigns === null && !error) return <Screen><Loading label="Loading campaigns" /></Screen>;

  const all = campaigns ?? [];
  const shown = all.filter((c) =>
    filter === 'all' ? true
      : filter === 'current'
        ? c.status === 'active' || c.status === 'scheduled' || c.status === 'paused'
      : c.status === filter);

  const running = all.filter((c) => c.status === 'active');
  const viewsToday = running.reduce((n, c) => n + c.impressionsToday, 0);
  const clicksAll = all.reduce((n, c) => n + c.clicks, 0);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title="Ads" back subtitle="Advertisers and campaigns" />

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

          <View style={s.tiles}>
            <StatTile label="Running now" value={running.length}
                      tone={running.length > 0 ? 'good' : undefined} />
            <StatTile label="Views today" value={viewsToday} />
            <StatTile label="Clicks all time" value={clicksAll} />
          </View>

          <View style={s.actions}>
            <Button label="New campaign" onPress={() => router.push('/admin/campaign/new')}
                    style={{ flex: 1 }} />
            <Button label="Companies" variant="secondary" style={{ flex: 1 }}
                    onPress={() => router.push('/admin/advertisers')} />
          </View>

          <View style={s.filters}>
            {FILTERS.map((f) => (
              <Pressable key={f.value} onPress={() => setFilter(f.value)}
                         accessibilityRole="button"
                         accessibilityState={{ selected: filter === f.value }}
                         style={[s.filter, filter === f.value && s.filterOn]}>
                <Text style={[s.filterLabel, filter === f.value && s.filterLabelOn]}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {shown.length === 0 ? (
            <EmptyState
              title={all.length ? 'Nothing here' : 'No campaigns yet'}
              body={all.length
                ? 'Try another filter.'
                : 'Add the company first, then build their ad and set how long it runs and how many views it should get.'}
              action={all.length ? undefined : (
                <Button label="Add a company"
                        onPress={() => router.push('/admin/advertisers')} />
              )}
            />
          ) : (
            shown.map((c) => (
              <CampaignRow key={c.id} campaign={c} busy={busy === c.id}
                           onStatus={(st) => void setStatus(c, st)} />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function CampaignRow({
  campaign: c, busy, onStatus,
}: { campaign: Campaign; busy: boolean; onStatus: (s: CampaignStatus) => void }) {
  const progress = goalProgress(c);
  const live = c.status === 'active';
  const canRun = c.status !== 'completed' && c.status !== 'archived';

  return (
    <View style={s.card}>
      <Pressable
        onPress={() => router.push(`/admin/campaign/${c.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${c.name} for ${c.advertiser}`}
        style={({ pressed }) => [s.cardTop, pressed && { opacity: 0.7 }]}
      >
        <Image source={{ uri: c.imageUrl }} style={s.thumb} contentFit="cover"
               accessibilityIgnoresInvertColors />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.advertiser} numberOfLines={1}>{c.advertiser}</Text>
          <Text style={s.name} numberOfLines={1}>{c.name}</Text>
          <Text style={s.delivery} numberOfLines={2}>{describeDelivery(c)}</Text>
        </View>
        <StatusPill status={c.status} />
      </Pressable>

      {progress !== null ? (
        <View style={s.progressWrap}>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={s.progressLabel}>
            {c.impressions.toLocaleString()} of {c.impressionGoal?.toLocaleString()} views
          </Text>
        </View>
      ) : null}

      <View style={s.metrics}>
        <Metric label="VIEWS" value={c.impressions.toLocaleString()} />
        <Metric label="CLICKS" value={c.clicks.toLocaleString()} />
        <Metric label="CLICK RATE" value={clickRate(c)} />
        <Metric label="EVERY" value={`${c.deckInterval} cards`} />
      </View>

      {canRun ? (
        <View style={s.rowActions}>
          <Pressable
            onPress={() => onStatus(live ? 'paused' : 'active')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={live ? `Pause ${c.name}` : `Start ${c.name}`}
            style={({ pressed }) => [s.rowAction, pressed && { opacity: 0.6 }]}
          >
            <Feather name={live ? 'pause' : 'play'} size={14}
                     color={live ? colors.clay : colors.mint} />
            <Text style={[s.rowActionLabel, { color: live ? colors.clay : colors.mint }]}>
              {busy ? '…' : live ? 'Pause' : 'Start'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: CampaignStatus }) {
  const tone = status === 'active' ? colors.mint
    : status === 'paused' ? colors.clay
    : status === 'completed' ? colors.textMuted
    : colors.textFaint;
  return (
    <View style={[s.pill, { borderColor: tone }]}>
      <Text style={[s.pillLabel, { color: tone }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: space.xl, gap: space.lg, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger },
  tiles: { flexDirection: 'row', gap: space.md },
  actions: { flexDirection: 'row', gap: space.md },

  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  filter: {
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  filterOn: { backgroundColor: colors.mintWash, borderColor: colors.mint },
  filterLabel: { ...type.small, color: colors.textMuted },
  filterLabelOn: { color: colors.mint },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: space.md, gap: space.md,
  },
  cardTop: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  thumb: { width: 54, height: 54, borderRadius: radius.sm, backgroundColor: colors.raised },
  advertiser: { ...type.micro, color: colors.mint },
  name: { ...type.bodyStrong, color: colors.text },
  delivery: { ...type.small, color: colors.textMuted, lineHeight: 18 },

  pill: {
    paddingHorizontal: space.sm, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1,
  },
  pillLabel: { ...type.micro },

  progressWrap: { gap: 5 },
  progressTrack: {
    height: 5, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden',
  },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: colors.mint },
  progressLabel: { ...type.small, color: colors.textFaint },

  metrics: {
    flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap',
    gap: space.md, borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: space.md,
  },
  metricLabel: { ...type.micro, color: colors.textFaint },
  metricValue: { ...type.bodyStrong, color: colors.text },

  rowActions: { flexDirection: 'row', gap: space.md },
  rowAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: space.md, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
  },
  rowActionLabel: { ...type.small, fontWeight: '700' },
});
