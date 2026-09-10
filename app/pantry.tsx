import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Toast } from '@/components/Toast';
import {
  BackButton, Button, ConfirmDialog, EmptyState, Loading, Screen,
} from '@/components/ui';
import { downscale, pickImage, readAsBase64, SCAN_EDGE } from '@/lib/media';
import {
  STAPLE_NAMES, addPantryItems, clearPantry, cookFromPantry, describeMatch,
  myPantry, removePantryItem, scanPantry, splitItems, tidyMissing,
  type PantryItem, type PantryMatch,
} from '@/lib/pantry';
import { formatTotalTime } from '@/lib/timers';
import { colors, radius, space, type } from '@/theme';

/**
 * Cook from what you have.
 *
 * Two halves on one screen, because they are useless apart: the things in your
 * kitchen, and what those things add up to. Editing the list re-ranks the
 * results underneath it, so the connection between "I bought lemons" and "now
 * I can make this" is visible rather than a round trip.
 *
 * The matching is a good guess, not a guarantee — "chicken" covering "chicken
 * thighs" is the same rule that lets it cover things it should not — so every
 * result says what it thinks is missing and nothing here says "you can
 * definitely make this".
 */

/** How short of ingredients a recipe may be and still be worth showing. */
const SLACK = [
  { value: 0, label: 'Have it all' },
  { value: 1, label: '1 short' },
  { value: 3, label: '3 short' },
  { value: 5, label: '5 short' },
];

export default function Pantry() {
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [matches, setMatches] = useState<PantryMatch[] | null>(null);
  const [draft, setDraft] = useState('');
  const [slack, setSlack] = useState(3);
  const [useStaples, setUseStaples] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [matching, setMatching] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      setItems(await myPantry());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your kitchen');
      setItems([]);
    }
  }, []);

  useEffect(() => { void loadItems(); }, [loadItems]);

  // Re-ranked whenever the list or the filters change, so the results are
  // never quietly about a kitchen you no longer have.
  useEffect(() => {
    if (items === null) return;
    if (!items.length) { setMatches([]); return; }
    let live = true;
    setMatching(true);
    void cookFromPantry(slack, 30, useStaples)
      .then((rows) => { if (live) setMatches(rows); })
      .catch(() => { if (live) setMatches([]); })
      .finally(() => { if (live) setMatching(false); });
    return () => { live = false; };
  }, [items, slack, useStaples]);

  async function add(names: string[]) {
    const clean = names.filter(Boolean);
    if (!clean.length) return;
    setBusy(true);
    setError(null);
    try {
      const { added, skipped } = await addPantryItems(clean);
      setDraft('');
      await loadItems();
      setToast(
        added && skipped ? `${added} added, ${skipped} already there`
          : added ? `${added} added`
          : 'Already in your kitchen',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add those');
    } finally {
      setBusy(false);
    }
  }

  async function scan(source: 'camera' | 'library') {
    setError(null);
    try {
      const picked = await pickImage(source);
      if (!picked) return;
      setScanning(true);
      const small = await downscale(picked, SCAN_EDGE);
      const base64 = await readAsBase64(small);
      const found = await scanPantry({ base64, mimeType: small.mimeType });
      // Straight in, because everything here is reviewable: the list is right
      // there and a wrong item is one tap to remove. Holding them behind a
      // confirmation step would be a second review of the same list.
      await add(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not scan that photo');
    } finally {
      setScanning(false);
    }
  }

  async function remove(item: PantryItem) {
    setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? prev);
    try {
      await removePantryItem(item.id);
    } catch {
      void loadItems();
    }
  }

  if (items === null && !error) return <Screen><Loading label="Opening your kitchen" /></Screen>;

  const list = items ?? [];

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.header}>
          <BackButton fallback="/(tabs)/search" style={{ marginLeft: -space.sm }} />
          <Text style={s.headerTitle}>What can I make?</Text>
          <Text style={s.headerSub}>
            {list.length
              ? `${list.length} thing${list.length === 1 ? '' : 's'} in your kitchen`
              : 'Add what you have'}
          </Text>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }}
                              behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {error ? <Text style={s.error}>{error}</Text> : null}

            {/* ---------------------------------------------------- adding */}
            <View style={s.addRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="eggs, milk, spinach"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="Add what you have"
                accessibilityHint="Separate several with commas"
                style={s.input}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={() => void add(splitItems(draft))}
              />
              <Pressable
                onPress={() => void add(splitItems(draft))}
                disabled={!draft.trim() || busy}
                accessibilityRole="button"
                accessibilityLabel="Add these"
                style={[s.addBtn, (!draft.trim() || busy) && { opacity: 0.4 }]}
              >
                <Feather name="plus" size={20} color={colors.onMint} />
              </Pressable>
            </View>
            <Text style={s.hint}>Commas or new lines add several at once.</Text>

            <View style={s.scanRow}>
              <Button label={scanning ? 'Reading the photo…' : 'Scan a shelf'}
                      onPress={() => void scan('camera')} disabled={scanning || busy}
                      variant="secondary" style={{ flex: 1 }} />
              <Button label="Choose a photo" onPress={() => void scan('library')}
                      disabled={scanning || busy} variant="secondary" style={{ flex: 1 }} />
            </View>
            {scanning ? (
              <View style={s.scanning}>
                <ActivityIndicator color={colors.mint} size="small" />
                <Text style={s.hint}>
                  Naming what it can see. Anything it gets wrong is one tap to remove.
                </Text>
              </View>
            ) : null}

            {/* --------------------------------------------- what you have */}
            {list.length ? (
              <>
                <View style={s.sectionRow}>
                  <Text style={s.sectionLabel}>IN YOUR KITCHEN</Text>
                  <Pressable onPress={() => setConfirmClear(true)} hitSlop={10}
                             accessibilityRole="button" accessibilityLabel="Empty the list"
                             style={({ pressed }) => pressed ? { opacity: 0.6 } : null}>
                    <Text style={s.clear}>Empty it</Text>
                  </Pressable>
                </View>
                <View style={s.chipWrap}>
                  {list.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => void remove(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.name}`}
                      style={({ pressed }) => [s.chip, pressed && { opacity: 0.6 }]}
                    >
                      <Text style={s.chipLabel}>{item.name}</Text>
                      <Feather name="x" size={12} color={colors.textFaint} />
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  onPress={() => setUseStaples((v) => !v)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: useStaples }}
                  aria-checked={useStaples}
                  accessibilityLabel={`Assume I have ${STAPLE_NAMES}`}
                  style={s.staples}
                >
                  <View style={[s.checkbox, useStaples && s.checkboxOn]}>
                    {useStaples ? <Feather name="check" size={12} color={colors.onMint} /> : null}
                  </View>
                  <Text style={s.staplesLabel}>
                    Assume I have {STAPLE_NAMES}
                  </Text>
                </Pressable>
              </>
            ) : null}

            {/* ------------------------------------------------- the results */}
            {!list.length ? (
              <EmptyState
                title="Tell it what you have"
                body="Type a few things, or point the camera at a shelf. It will find recipes you can make now and the ones you are one or two ingredients away from."
              />
            ) : (
              <>
                <View style={s.sectionRow}>
                  <Text style={s.sectionLabel}>
                    {matching ? 'LOOKING…'
                      : `${matches?.length ?? 0} RECIPE${matches?.length === 1 ? '' : 'S'}`}
                  </Text>
                  <View style={s.slackWrap}>
                    {SLACK.map((o) => (
                      <Pressable key={o.value} onPress={() => setSlack(o.value)}
                                 accessibilityRole="radio"
                                 accessibilityState={{ selected: slack === o.value }}
                                 accessibilityLabel={o.label}
                                 style={[s.slack, slack === o.value && s.slackOn]}>
                        <Text style={[s.slackLabel, slack === o.value && { color: colors.mint }]}>
                          {o.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {matches === null || matching ? (
                  <View style={s.matching}><ActivityIndicator color={colors.mint} /></View>
                ) : matches.length === 0 ? (
                  <EmptyState
                    title="Nothing quite fits yet"
                    body={slack < 5
                      ? 'Try allowing a few more missing ingredients, or add more of what you have.'
                      : 'Add a few more things and it will have more to work with.'}
                  />
                ) : (
                  matches.map((m) => <MatchRow key={m.card.id} match={m} />)
                )}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ConfirmDialog
        visible={confirmClear}
        title="Empty your kitchen?"
        body="This clears everything you have added. The recipes stay where they are."
        confirmLabel="Empty it"
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setConfirmClear(false);
          try {
            const { removed } = await clearPantry();
            setToast(`${removed} removed`);
          } catch (e) {
            setToast(e instanceof Error ? e.message : 'Could not empty that');
          }
          void loadItems();
        }}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function MatchRow({ match: m }: { match: PantryMatch }) {
  const complete = m.have === m.total;
  return (
    <Pressable
      onPress={() => router.push(`/recipe/${m.card.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${m.card.title}. ${describeMatch(m)}`}
      style={({ pressed }) => [s.match, pressed && { opacity: 0.7 }]}
    >
      <RecipeCover uri={m.card.coverImageUrl} seed={m.card.id} title={m.card.title}
                   style={s.matchThumb} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.matchTitle} numberOfLines={2}>{m.card.title}</Text>
        <Text style={s.matchMeta}>
          {formatTotalTime(m.card.totalMinutes)}
          {m.card.cuisine ? ` · ${m.card.cuisine}` : ''}
        </Text>

        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${Math.round((m.have / m.total) * 100)}%` },
                        complete && { backgroundColor: colors.mint }]} />
        </View>

        <Text style={[s.matchStatus, complete && { color: colors.mint }]} numberOfLines={2}>
          {complete
            ? `You have all ${m.total}`
            : `${m.have} of ${m.total} · need ${m.missing.slice(0, 3).map(tidyMissing).join(', ')}`
            + (m.missing.length > 3 ? ` +${m.missing.length - 3}` : '')}
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: {
    paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md, gap: 2,
  },
  headerTitle: { ...type.title, color: colors.text },
  headerSub: { ...type.small, color: colors.textMuted },

  body: { padding: space.xl, gap: space.md, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger },
  hint: { ...type.small, color: colors.textFaint, lineHeight: 18 },

  addRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.md, height: 46,
    color: colors.text, fontSize: 15,
  },
  addBtn: {
    width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.mint,
    alignItems: 'center', justifyContent: 'center',
  },
  scanRow: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  scanning: { flexDirection: 'row', alignItems: 'center', gap: space.md },

  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: space.md, marginTop: space.lg, flexWrap: 'wrap',
  },
  sectionLabel: { ...type.micro, color: colors.textFaint },
  clear: { ...type.small, color: colors.textMuted },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.mintWash, borderWidth: 1, borderColor: colors.mintDeep,
  },
  chipLabel: { ...type.small, color: colors.mint },

  staples: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  checkbox: {
    width: 18, height: 18, borderRadius: 5, borderWidth: 1.5,
    borderColor: colors.borderBright, alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.mint, borderColor: colors.mint },
  staplesLabel: { ...type.small, color: colors.textMuted, flex: 1 },

  slackWrap: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  slack: {
    paddingHorizontal: space.sm, paddingVertical: 5, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
  },
  slackOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  slackLabel: { ...type.small, fontSize: 12, color: colors.textMuted },

  matching: { paddingVertical: space.xxl, alignItems: 'center' },
  match: {
    flexDirection: 'row', gap: space.md, alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border,
  },
  matchThumb: { width: 62, height: 62, borderRadius: radius.sm, overflow: 'hidden' },
  matchTitle: { ...type.bodyStrong, color: colors.text },
  matchMeta: { ...type.small, color: colors.textFaint },
  barTrack: {
    height: 4, borderRadius: 2, backgroundColor: colors.raised,
    overflow: 'hidden', marginTop: 2,
  },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.mintDim },
  matchStatus: { ...type.small, color: colors.textMuted, lineHeight: 17 },
});
