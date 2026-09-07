import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, Loading, Screen } from '@/components/ui';
import { AdminHeader } from '@/components/admin/Shared';
import { adminAudit, type AuditEntry } from '@/lib/admin';
import { colors, radius, space, type } from '@/theme';

/** §29: the full audit log. Super admin only, and it includes their own actions. */
export default function Audit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await adminAudit(200));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audit log');
      setEntries([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (entries === null) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader title="Audit log" back subtitle="Every admin action, including super admins" />
        <ScrollView contentContainerStyle={s.body}>
          {error ? <Text style={s.error}>{error}</Text> : null}
          {entries.length === 0 && !error ? (
            <EmptyState title="Nothing logged yet"
                        body="Admin actions appear here as they happen. Nothing is exempt." />
          ) : entries.map((e) => (
            <View key={e.id} style={s.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.action}>{e.action}</Text>
                <Text style={s.meta}>
                  {e.actor ? `@${e.actor}` : 'system'}
                  {e.targetType ? ` · ${e.targetType}` : ''}
                  {' · '}{new Date(e.createdAt).toLocaleString()}
                </Text>
                {e.metadata && Object.keys(e.metadata).length ? (
                  <Text style={s.metadata} numberOfLines={2}>
                    {Object.entries(e.metadata)
                      .filter(([, v]) => v !== null && v !== '')
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { padding: space.xl, paddingTop: 0, gap: space.sm, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger },
  row: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border,
  },
  action: { ...type.bodyStrong, color: colors.text, fontFamily: undefined },
  meta: { ...type.small, color: colors.textMuted },
  metadata: { ...type.small, color: colors.textFaint },
});
