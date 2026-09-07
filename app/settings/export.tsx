import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Toast } from '@/components/Toast';
import { Button, Screen } from '@/components/ui';
import { downloadJson, exportMyData } from '@/lib/settings';
import { colors, radius, space, type } from '@/theme';

/**
 * §28.1 data portability. Everything MenuMatch holds about you, as JSON you can
 * keep — built on request rather than held anywhere, so there is no export file
 * sitting around waiting to leak.
 */
export default function ExportScreen() {
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setPayload(null);
    try {
      const data = await exportMyData();
      const counts = data as {
        recipes?: unknown[]; saves?: unknown[]; collections?: unknown[];
        cooks?: unknown[]; swipes?: { total?: number };
      };
      setSummary(
        `${counts.recipes?.length ?? 0} recipes · ${counts.saves?.length ?? 0} saves · `
        + `${counts.collections?.length ?? 0} collections · ${counts.cooks?.length ?? 0} cooks · `
        + `${counts.swipes?.total ?? 0} swipes`,
      );

      const name = `menumatch-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (downloadJson(name, data)) {
        setToast('Downloaded');
      } else {
        // No file download available here, so hand over the text itself.
        setPayload(JSON.stringify(data, null, 2));
        setToast('Ready to copy');
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not build your export');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!payload) return;
    await Clipboard.setStringAsync(payload);
    setToast('Copied to the clipboard');
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <Pressable onPress={() => router.back()} accessibilityRole="button"
                     accessibilityLabel="Back">
            <Feather name="chevron-left" size={24} color={colors.text} />
          </Pressable>
          <Text style={s.barTitle}>Export my data</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={s.body}>
          <Text style={s.lead}>
            A JSON file containing everything MenuMatch holds about you.
          </Text>

          <View style={s.card}>
            <Text style={s.cardLabel}>WHAT IS IN IT</Text>
            {[
              'Your account details and preferences',
              'Every recipe you have written, drafts included',
              'What you have saved, cooked, and organised into collections',
              'Accounts you have blocked',
              'Your swipe history',
            ].map((line) => (
              <View key={line} style={s.bullet}>
                <Feather name="check" size={13} color={colors.mint} />
                <Text style={s.bulletText}>{line}</Text>
              </View>
            ))}
          </View>

          <Text style={s.note}>
            The file is built when you ask for it and never stored, so there is
            no copy of it sitting anywhere. Swipe history is capped at the most
            recent 1,000 entries; the total count is exact.
          </Text>

          <Button label={busy ? 'Building…' : 'Download my data'}
                  onPress={() => void run()} disabled={busy} />

          {summary ? <Text style={s.summary}>{summary}</Text> : null}

          {payload ? (
            <View style={{ gap: space.md }}>
              <Button label="Copy to clipboard" variant="secondary"
                      onPress={() => void copy()} />
              <View style={s.preview}>
                <Text style={s.previewText} numberOfLines={40}>{payload}</Text>
              </View>
            </View>
          ) : null}

          {Platform.OS !== 'web' ? (
            <Text style={s.note}>
              On this device the export is shown here to copy rather than saved
              as a file.
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>

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
  body: { padding: space.xl, paddingTop: 0, gap: space.lg, paddingBottom: space.xxxl },
  lead: { ...type.body, color: colors.text, lineHeight: 21 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    gap: space.sm, borderWidth: 1, borderColor: colors.border,
  },
  cardLabel: { ...type.micro, color: colors.textFaint },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  bulletText: { ...type.small, color: colors.text, flex: 1, lineHeight: 18 },
  note: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  summary: { ...type.small, color: colors.mint, textAlign: 'center' },
  preview: {
    backgroundColor: colors.ground, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border, maxHeight: 320,
  },
  previewText: { ...type.small, color: colors.textMuted, fontFamily: 'monospace' },
});
