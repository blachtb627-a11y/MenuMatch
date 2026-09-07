import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { BackButton, Button, EmptyState, Loading, Screen } from '@/components/ui';
import {
  describeWeek, describeWindow, fetchWeeklyBoard,
  type BoardEntry, type WeeklyBoard,
} from '@/lib/board';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/**
 * This week's most-saved recipes (§16).
 *
 * Your own week comes first, above the table and whether or not you placed in
 * it. A rank motivates the few people who can win one; "seven saves, up three"
 * says something to everyone, including the only person who posted. The board
 * underneath is the thing to aim at, not the verdict on your week.
 */
export default function Leaderboard() {
  const { isGuest } = useSession();
  const [board, setBoard] = useState<WeeklyBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let live = true;
    setError(null);
    void fetchWeeklyBoard()
      .then((b) => { if (live) setBoard(b); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the board'); });
    return () => { live = false; };
  }, []));

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <BackButton fallback="/(tabs)/create" />
          <Text style={s.barTitle}>This week</Text>
          <View style={{ width: 44 }} />
        </View>

        {error ? (
          <View style={s.pad}><Text style={s.error}>{error}</Text></View>
        ) : !board ? (
          <Loading label="Counting this week's saves" />
        ) : (
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.window}>{describeWindow(board.from, board.to)}</Text>

            {board.me ? <MyWeekCard board={board} /> : (
              <View style={s.meCard}>
                <Text style={s.meHeadline}>Post a recipe and you're on this board</Text>
                <Text style={s.meDetail}>
                  It counts saves over the last seven days and starts again every
                  day, so a recipe posted today competes with everything else
                  posted this week.
                </Text>
                {isGuest ? (
                  <Button label="Create an account"
                          onPress={() => router.push('/auth')} />
                ) : null}
              </View>
            )}

            <Section title="Most saved"
                     hint="Saves in the last seven days. Saving your own recipe does not count.">
              {board.top.length === 0 ? (
                <EmptyState
                  title="Nothing saved yet this week"
                  body="The first recipe anyone saves takes the top spot."
                />
              ) : board.top.map((e) => <TopRow key={e.id} entry={e} />)}
            </Section>

            {board.rising.length ? (
              <Section title="Rising"
                       hint="Best save rate among recipes that haven't been shown much yet — where a new recipe can place before it has the numbers.">
                {board.rising.map((e) => <RisingRow key={e.id} entry={e} />)}
              </Section>
            ) : null}

            <Text style={s.footnote}>
              Counted from saves, the same signal the deck ranks on. It resets on
              a rolling seven days, so nobody sits on top of it forever.
            </Text>
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}

function MyWeekCard({ board }: { board: WeeklyBoard }) {
  const { headline, detail } = describeWeek(board.me!);
  const me = board.me!;
  return (
    <View style={s.meCard}>
      <Text style={s.meLabel}>YOUR WEEK</Text>
      <Text style={s.meHeadline}>{headline}</Text>
      <Text style={s.meDetail}>{detail}</Text>
      {me.published === 0 ? (
        <Button label="Write a recipe" onPress={() => router.push('/compose/new')} />
      ) : me.bestPosition == null ? (
        <Text style={s.meDetail}>
          Not on the board this week. It only takes one save more than the
          bottom of the ten below.
        </Text>
      ) : null}
    </View>
  );
}

function Section({
  title, hint, children,
}: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionHint}>{hint}</Text>
      <View style={{ gap: space.sm }}>{children}</View>
    </View>
  );
}

function TopRow({ entry }: { entry: BoardEntry }) {
  return (
    <Pressable style={[s.row, entry.isMine && s.rowMine]}
               onPress={() => router.push(`/recipe/${entry.id}`)}
               accessibilityRole="button"
               accessibilityLabel={`Number ${entry.position}, ${entry.title}, ${entry.saves} saves`}>
      <Text style={[s.position, entry.position === 1 && { color: colors.mint }]}>
        {entry.position}
      </Text>
      <RecipeCover uri={entry.coverImageUrl} seed={entry.id} title={entry.title}
                   style={s.thumb} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{entry.title}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {entry.isMine ? 'Yours' : `@${entry.creator.username}`}
          {entry.cuisine ? ` · ${entry.cuisine}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.saves}>{entry.saves}</Text>
        <Text style={s.savesLabel}>{entry.saves === 1 ? 'save' : 'saves'}</Text>
      </View>
    </Pressable>
  );
}

function RisingRow({ entry }: { entry: BoardEntry }) {
  return (
    <Pressable style={[s.row, entry.isMine && s.rowMine]}
               onPress={() => router.push(`/recipe/${entry.id}`)}
               accessibilityRole="button"
               accessibilityLabel={`${entry.title}, ${entry.saves} saves from ${entry.impressions} views`}>
      <Feather name="trending-up" size={16} color={colors.mint} style={{ width: 22 }} />
      <RecipeCover uri={entry.coverImageUrl} seed={entry.id} title={entry.title}
                   style={s.thumb} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{entry.title}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {entry.isMine ? 'Yours' : `@${entry.creator.username}`}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.saves}>{entry.saves}</Text>
        <Text style={s.savesLabel}>of {entry.impressions} shown</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  barTitle: { ...type.bodyStrong, color: colors.text },
  pad: { padding: space.xl },
  body: { padding: space.lg, paddingBottom: space.xxxl, gap: space.lg },
  window: { ...type.small, color: colors.textFaint },
  meCard: {
    gap: space.sm, padding: space.lg, borderRadius: radius.lg,
    backgroundColor: colors.mintWash, borderWidth: 1, borderColor: colors.mintDeep,
  },
  meLabel: { ...type.micro, color: colors.mintDim },
  meHeadline: { ...type.title, color: colors.text },
  meDetail: { ...type.body, color: colors.textMuted, lineHeight: 22 },
  section: { gap: space.xs },
  sectionTitle: { ...type.heading, color: colors.text },
  sectionHint: { ...type.small, color: colors.textFaint, lineHeight: 18, marginBottom: space.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  rowMine: { borderColor: colors.mintDeep },
  position: { ...type.heading, color: colors.textFaint, width: 22, textAlign: 'center' },
  thumb: { width: 46, height: 46, borderRadius: radius.sm },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.small, color: colors.textFaint },
  saves: { ...type.bodyStrong, color: colors.text },
  savesLabel: { ...type.small, color: colors.textFaint, fontSize: 11 },
  footnote: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  error: { ...type.body, color: colors.danger },
});
