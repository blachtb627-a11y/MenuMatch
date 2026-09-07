import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Toast } from '@/components/Toast';
import { Avatar } from '@/components/Avatar';
import { BackButton, ConfirmDialog, EmptyState, Loading, Screen } from '@/components/ui';
import { fetchCreator, formatCount, type CreatorProfile } from '@/lib/search';
import { blockUser, isBlockedByMe, unblockUser } from '@/lib/settings';
import { formatTotalTime } from '@/lib/timers';
import { useSession } from '@/state/session';
import { colors, fill, radius, space, type } from '@/theme';

/**
 * §14. A creator's public page: who they are and what they have published,
 * their most-saved recipes first — which is also the order the deck favours.
 */
export default function CreatorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, isGuest } = useSession();
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setCreator(await fetchCreator(id));
      setError(null);
    } catch {
      // The RPC refuses a blocked or removed account the same way as a missing
      // one, deliberately: which of the three it is, is not the viewer's business.
      setError('That creator is not available.');
    }
    if (!isGuest) {
      try { setBlocked(await isBlockedByMe(id)); } catch { /* leave as unblocked */ }
    }
  }, [id, isGuest]);

  useEffect(() => { void load(); }, [load]);

  async function toggleBlock() {
    if (!id) return;
    setBusy(true);
    try {
      if (blocked) {
        await unblockUser(id);
        setBlocked(false);
        setToast('Unblocked');
      } else {
        await blockUser(id);
        setBlocked(true);
        setConfirmBlock(false);
        setToast('Blocked. Neither of you will see the other.');
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Screen><SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Bar />
        <EmptyState title="Not available"
                    body="This creator page cannot be shown." />
      </SafeAreaView></Screen>
    );
  }
  if (!creator) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Bar />
        <ScrollView contentContainerStyle={s.body}>
          <View style={s.identity}>
            <Avatar uri={creator.avatarUrl}
                    name={creator.displayName || creator.username} size={64} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.name}>{creator.displayName}</Text>
              <Text style={s.handle}>
                @{creator.username}
                {/* §5.3: a company-operated account says so. */}
                {creator.isSeedAccount ? ' · MenuMatch account' : ''}
              </Text>
            </View>
          </View>

          {creator.bio ? <Text style={s.bio}>{creator.bio}</Text> : null}

          {/* §20.1. Not offered on your own page, and not to a guest, who has
              no account for a block to belong to. */}
          {!isGuest && me?.id !== creator.id ? (
            <Pressable onPress={() => (blocked ? void toggleBlock() : setConfirmBlock(true))}
                       disabled={busy}
                       accessibilityRole="button"
                       accessibilityLabel={blocked
                         ? `Unblock ${creator.displayName}`
                         : `Block ${creator.displayName}`}
                       style={s.blockRow}>
              <Feather name={blocked ? 'user-check' : 'slash'} size={14}
                       color={blocked ? colors.textMuted : colors.danger} />
              <Text style={[s.blockLabel, blocked && { color: colors.textMuted }]}>
                {blocked ? 'Unblock this creator' : 'Block this creator'}
              </Text>
            </Pressable>
          ) : null}

          <View style={s.stats}>
            <Stat label={creator.recipes.length === 1 ? 'Recipe' : 'Recipes'}
                  value={String(creator.recipes.length)} />
            <Stat label={creator.saves === 1 ? 'Save' : 'Saves'}
                  value={formatCount(creator.saves)} />
            <Stat label="Joined"
                  value={new Date(creator.joinedAt).toLocaleDateString(undefined,
                    { month: 'short', year: 'numeric' })} />
          </View>

          {creator.recipes.length === 0 ? (
            <EmptyState title="Nothing published yet"
                        body="When this creator publishes, their recipes appear here." />
          ) : (
            <View style={s.grid}>
              {creator.recipes.map((r) => (
                <Pressable key={r.id} style={s.tile}
                           onPress={() => router.push(`/recipe/${r.id}`)}
                           accessibilityRole="button" accessibilityLabel={r.title}>
                  <RecipeCover uri={r.coverImageUrl} seed={r.id} title={r.title}
                               style={StyleSheet.absoluteFill} />
                  <View style={s.tileScrim} />
                  {r.saveCount > 0 ? (
                    <View style={s.saveBadge}>
                      <Feather name="bookmark" size={10} color={colors.mint} />
                      <Text style={s.saveBadgeLabel}>{formatCount(r.saveCount)}</Text>
                    </View>
                  ) : null}
                  <View style={s.tileText}>
                    <Text style={s.tileTitle} numberOfLines={2}>{r.title}</Text>
                    <Text style={s.tileMeta}>{formatTotalTime(r.totalMinutes)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <ConfirmDialog
        visible={confirmBlock}
        title={`Block ${creator.displayName}?`}
        body="Their recipes disappear from your deck, search and Cookbook, and yours from theirs. You can undo this from Profile → Blocked accounts."
        confirmLabel="Block"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={() => void toggleBlock()}
        onCancel={() => setConfirmBlock(false)}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function Bar() {
  return (
    <View style={s.bar}>
      <BackButton fallback="/(tabs)/search" />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { paddingHorizontal: space.lg, paddingVertical: space.md },
  body: { padding: space.xl, paddingTop: 0, gap: space.lg, paddingBottom: space.xxxl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  name: { ...type.title, color: colors.text },
  handle: { ...type.small, color: colors.textMuted },
  bio: { ...type.body, color: colors.text, lineHeight: 21 },
  blockRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: space.sm,
  },
  blockLabel: { ...type.small, color: colors.danger },
  stats: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md,
    padding: space.lg, borderWidth: 1, borderColor: colors.border,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { ...type.heading, color: colors.text },
  statLabel: { ...type.small, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    // flexGrow stays 0: with one result a growing tile fills the row and
    // becomes a full-width slab taller than the screen.
    flexBasis: '47%', flexGrow: 0, aspectRatio: 0.82,
    borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface,
  },
  tileScrim: { ...fill, backgroundColor: colors.scrim },
  tileText: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.md, gap: 2 },
  tileTitle: { ...type.bodyStrong, color: colors.text },
  tileMeta: { ...type.small, color: colors.textMuted },
  saveBadge: {
    position: 'absolute', top: space.sm, right: space.sm,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.overlay,
  },
  saveBadgeLabel: { fontSize: 11, fontWeight: '700', color: colors.mint },
});
