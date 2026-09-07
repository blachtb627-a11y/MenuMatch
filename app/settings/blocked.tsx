import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Toast } from '@/components/Toast';
import { Button, ConfirmDialog, EmptyState, Loading, Screen } from '@/components/ui';
import { myBlocks, unblockUser, type BlockedAccount } from '@/lib/settings';
import { colors, radius, space, type } from '@/theme';

/**
 * §20.1. Blocking is bidirectional invisibility — neither of you sees the
 * other's recipes anywhere in the app. This is where it gets undone.
 */
export default function BlockedScreen() {
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  const [pending, setPending] = useState<BlockedAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBlocked(await myBlocks());
    } catch {
      setToast('Could not load your blocked accounts');
      setBlocked([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function commitUnblock() {
    if (!pending) return;
    setBusy(true);
    try {
      await unblockUser(pending.id);
      setBlocked((cur) => (cur ?? []).filter((b) => b.id !== pending.id));
      setToast(`Unblocked @${pending.username}`);
      setPending(null);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not unblock that account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <Pressable onPress={() => router.back()} accessibilityRole="button"
                     accessibilityLabel="Back">
            <Feather name="chevron-left" size={24} color={colors.text} />
          </Pressable>
          <Text style={s.barTitle}>Blocked accounts</Text>
          <View style={{ width: 24 }} />
        </View>

        {blocked === null ? <Loading /> : blocked.length === 0 ? (
          <EmptyState
            title="Nobody blocked"
            body="Blocking someone hides their recipes from you and yours from them. You can block a creator from their page." />
        ) : (
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.note}>
              Neither of you sees the other's recipes anywhere in the app.
            </Text>
            {blocked.map((b) => (
              <View key={b.id} style={s.row}>
                <View style={s.avatar}>
                  <Text style={s.avatarLetter}>
                    {(b.displayName || b.username).slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.name} numberOfLines={1}>{b.displayName}</Text>
                  <Text style={s.meta} numberOfLines={1}>
                    @{b.username} · blocked {new Date(b.blockedAt).toLocaleDateString()}
                  </Text>
                </View>
                <Button label="Unblock" variant="secondary"
                        onPress={() => setPending(b)} />
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      <ConfirmDialog
        visible={!!pending}
        title={`Unblock @${pending?.username ?? ''}?`}
        body="Their recipes can appear in your deck again, and yours in theirs."
        confirmLabel="Unblock"
        cancelLabel="Keep blocked"
        busy={busy}
        onConfirm={() => void commitUnblock()}
        onCancel={() => setPending(null)}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
  },
  barTitle: { ...type.bodyStrong, color: colors.text },
  body: { padding: space.xl, paddingTop: 0, gap: space.md, paddingBottom: space.xxxl },
  note: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.raised,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { ...type.bodyStrong, color: colors.textMuted },
  name: { ...type.bodyStrong, color: colors.text },
  meta: { ...type.small, color: colors.textMuted },
});
