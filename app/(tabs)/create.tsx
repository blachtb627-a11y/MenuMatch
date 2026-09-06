import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Screen } from '@/components/ui';
import { Header } from './cookbook';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/**
 * §15, the composer. Not built in this pass: the brief for this build was the
 * discovery loop end to end, and the composer is the one MVP surface that needs
 * real depth of its own (structured rows, drag reordering, paste-a-list
 * parsing, autosave every 10 seconds and on every field blur).
 *
 * The database and API behind it are already in place: recipes,
 * recipe_ingredients, recipe_steps, recipe_tags, recipe_versions and the
 * rights-confirmation column all exist, and RLS lets a creator write only
 * their own rows.
 */
export default function Create() {
  const { isGuest } = useSession();

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header title="Create" />
        <View style={s.body}>
          <View style={s.icon}><Feather name="edit-3" size={26} color={colors.mint} /></View>
          <Text style={s.title}>The composer is next</Text>
          <Text style={s.body_}>
            Publishing is the next surface to build. The schema behind it is
            already live: structured ingredient and step rows, tags, versioned
            edit history, and the rights confirmation required at publish.
          </Text>
          {isGuest ? (
            <Button label="Create an account" onPress={() => router.push('/auth')} />
          ) : null}
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.lg },
  icon: {
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.mintWash,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  body_: { ...type.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22, maxWidth: 340 },
});
