import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Screen } from '@/components/ui';
import { Header } from './cookbook';
import { listMyRecipes } from '@/lib/composer';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

export default function Profile() {
  const { isGuest, me, signOut } = useSession();
  const [counts, setCounts] = useState({ published: 0, drafts: 0 });

  // The numbers here were hardcoded zeros, which read as "you have published
  // nothing" to someone who had.
  useFocusEffect(useCallback(() => {
    if (isGuest) return;
    void listMyRecipes()
      .then((rows) => setCounts({
        published: rows.filter((r) => r.status === 'published').length,
        drafts: rows.filter((r) => r.status === 'draft').length,
      }))
      .catch(() => {});
  }, [isGuest]));

  if (isGuest) {
    return (
      <Screen><SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header title="Profile" />
        <View style={s.guest}>
          <Text style={s.guestTitle}>You're browsing as a guest</Text>
          <Text style={s.guestBody}>
            Everything you swipe is remembered on this device and moves to your
            account when you create one.
          </Text>
          <Button label="Create an account" onPress={() => router.push('/auth')} />
        </View>
      </SafeAreaView></Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header title="Profile" />
        <ScrollView contentContainerStyle={s.body}>
          <View style={s.identity}>
            <View style={s.avatar}>
              <Text style={s.avatarLetter}>
                {(me?.displayName ?? '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ gap: 2, flex: 1 }}>
              <Text style={s.name}>{me?.displayName ?? 'Cook'}</Text>
              <Text style={s.handle}>@{me?.username ?? ''}</Text>
            </View>
          </View>

          <View style={s.stats}>
            <Stat label="Saved" value={String(me?.savedCount ?? 0)}
                  onPress={() => router.push('/(tabs)/cookbook')} />
            <Stat label="Published" value={String(counts.published)}
                  onPress={() => router.push('/(tabs)/create')} />
            <Stat label="Drafts" value={String(counts.drafts)}
                  onPress={() => router.push('/(tabs)/create')} />
          </View>

          <Section title="Your recipes">
            <Row icon="book-open"
                 label={counts.published || counts.drafts
                   ? `${counts.published} published · ${counts.drafts} draft${counts.drafts === 1 ? '' : 's'}`
                   : 'Nothing written yet'}
                 onPress={() => router.push('/(tabs)/create')} />
            <Row icon="plus-square" label="Write a new recipe"
                 onPress={() => router.push('/compose/new')} />
          </Section>

          {me?.isAdmin ? (
            <Section title="Moderation">
              <Row icon="shield" label="Moderation queue"
                   onPress={() => router.push('/admin')} />
              <Row icon="user" label="Accounts"
                   onPress={() => router.push('/admin/users')} />
              <Row icon="message-square" label="Appeals"
                   onPress={() => router.push('/admin/appeals')} />
              <Row icon="users" label="Team"
                   onPress={() => router.push('/admin/team')} />
              {me.adminRole === 'super_admin' ? (
                <Row icon="list" label="Audit log"
                     onPress={() => router.push('/admin/audit')} />
              ) : null}
            </Section>
          ) : null}

          {/* §28.1 settings. §20.6 and §28.4 make deletion and reporting
              in-app requirements, not email-support paths. */}
          <Section title="Settings">
            <Row icon="sliders" label="Dietary preferences"
                 onPress={() => router.push('/settings/preferences')} />
            <Row icon="slash" label="Blocked accounts"
                 onPress={() => router.push('/settings/blocked')} />
            <Row icon="download" label="Export my data"
                 onPress={() => router.push('/settings/export')} />
          </Section>

          <Section title="Trust and safety">
            <Row icon="flag" label="Report a problem" />
            <Row icon="shield" label="Community Guidelines"
                 onPress={() => router.push('/legal/guidelines')} />
            <Row icon="file-text" label="Terms of Service"
                 onPress={() => router.push('/legal/terms')} />
            <Row icon="lock" label="Privacy Policy"
                 onPress={() => router.push('/legal/privacy')} />
            <Row icon="mail" label="Contact MenuMatch" />
          </Section>

          <Section title="Account">
            <Row icon="log-out" label="Sign out" onPress={() => void signOut()} />
            <Row icon="trash-2" label="Delete my account" tone="danger" />
          </Section>

          <Text style={s.footnote}>
            Deleting your account removes it from MenuMatch immediately and
            purges your personal data within 30 days.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={s.sectionLabel}>{title.toUpperCase()}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

function Row({
  icon, label, onPress, tone = 'default',
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string; onPress?: () => void; tone?: 'default' | 'danger';
}) {
  const fg = tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
               style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.raised }]}>
      <Feather name={icon} size={17} color={fg} />
      <Text style={[s.rowLabel, { color: fg }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

function Stat({
  label, value, onPress,
}: { label: string; value: string; onPress?: () => void }) {
  return (
    <Pressable style={s.stat} onPress={onPress} disabled={!onPress}
               accessibilityRole={onPress ? 'button' : undefined}
               accessibilityLabel={onPress ? `${value} ${label}` : undefined}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  guest: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.lg },
  guestTitle: { ...type.title, color: colors.text, textAlign: 'center' },
  guestBody: { ...type.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22, maxWidth: 330 },

  body: { padding: space.xl, gap: space.xl, paddingBottom: space.xxxl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mintDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontSize: 22, fontWeight: '700', color: colors.mint },
  name: { ...type.heading, color: colors.text },
  handle: { ...type.small, color: colors.textMuted },

  stats: { flexDirection: 'row', gap: space.xxl },
  stat: { gap: 2 },
  statValue: { ...type.title, color: colors.text },
  statLabel: { ...type.small, color: colors.textMuted },

  sectionLabel: { ...type.micro, color: colors.textFaint },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  rowLabel: { ...type.body, flex: 1 },
  footnote: { ...type.small, color: colors.textFaint, lineHeight: 18 },
});
