import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Screen } from '@/components/ui';
import { fetchConfig, savePreferences } from '@/lib/api';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';
import { ONBOARDED_KEY } from './index';

/**
 * §7. Two screens, both skippable, and no account required before the deck.
 * The taste pass is roughly fifteen seconds of tapping, or nothing at all.
 */

const CUISINES = ['Italian', 'Mexican', 'Japanese', 'Indian', 'Mediterranean',
                  'Thai', 'Chinese', 'Korean', 'French', 'Middle Eastern'];
const DIETARY = [
  { slug: 'vegetarian', label: 'Vegetarian' },
  { slug: 'vegan', label: 'Vegan' },
  { slug: 'gluten-free', label: 'Gluten-free' },
  { slug: 'dairy-free', label: 'Dairy-free' },
  { slug: 'high-protein', label: 'High protein' },
  { slug: 'low-carb', label: 'Low carb' },
];

export default function Onboarding() {
  const { isGuest } = useSession();
  const [step, setStep] = useState<'welcome' | 'taste'>('welcome');
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);
  const [pickedCats, setPickedCats] = useState<string[]>([]);
  const [pickedCuisines, setPickedCuisines] = useState<string[]>([]);
  const [pickedDiets, setPickedDiets] = useState<string[]>([]);

  useEffect(() => {
    void fetchConfig()
      .then((c) =>
        setCategories(
          c.categories.filter((x) => !['for_you', 'following'].includes(x.slug)),
        ),
      )
      .catch(() => setCategories([]));
  }, []);

  async function finish() {
    await AsyncStorage.setItem(ONBOARDED_KEY, '1');
    // Preferences persist only once there is an account to attach them to;
    // a guest's picks are applied when they sign up.
    if (!isGuest) {
      try {
        await savePreferences({
          favoriteCategories: pickedCats,
          cuisines: pickedCuisines,
          dietaryTags: pickedDiets,
        });
      } catch {
        // never block entry to the deck on a preferences write
      }
    } else if (pickedCats.length || pickedCuisines.length || pickedDiets.length) {
      await AsyncStorage.setItem(
        'menumatch.guestPreferences',
        JSON.stringify({ pickedCats, pickedCuisines, pickedDiets }),
      );
    }
    router.replace('/(tabs)');
  }

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  if (step === 'welcome') {
    return (
      <Screen>
        <SafeAreaView style={s.welcome}>
          <View style={s.markRow}>
            <View style={s.mark}><Text style={s.markLetters}>MM</Text></View>
          </View>
          <View style={{ gap: space.md }}>
            <Text style={s.headline}>MenuMatch</Text>
            <Text style={s.sub}>
              Discover recipes by swiping, save your favourites, share your own.
            </Text>
          </View>
          <View style={{ gap: space.md }}>
            <Button label="Get started" onPress={() => setStep('taste')} />
            <Button label="Skip to the deck" variant="ghost" onPress={finish} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.tasteBody}>
          <Text style={s.stepTitle}>What are you cooking?</Text>
          <Text style={s.stepSub}>
            A few taps sharpens your first deck. You can skip this and change
            everything later.
          </Text>

          <Group title="Meals">
            {categories.map((c) => (
              <Chip key={c.slug} label={c.label} active={pickedCats.includes(c.slug)}
                    onPress={() => toggle(pickedCats, setPickedCats, c.slug)} />
            ))}
          </Group>

          <Group title="Cuisines">
            {CUISINES.map((c) => (
              <Chip key={c} label={c} active={pickedCuisines.includes(c)}
                    onPress={() => toggle(pickedCuisines, setPickedCuisines, c)} />
            ))}
          </Group>

          <Group title="Anything you avoid">
            {DIETARY.map((d) => (
              <Chip key={d.slug} label={d.label} active={pickedDiets.includes(d.slug)}
                    onPress={() => toggle(pickedDiets, setPickedDiets, d.slug)} />
            ))}
          </Group>
          <Text style={s.note}>
            Dietary preferences stay private and never appear on your profile.
          </Text>
        </ScrollView>

        <View style={s.tasteFooter}>
          <Button label="Start swiping" onPress={finish} />
          <Button label="Skip" variant="ghost" onPress={finish} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <Text style={s.groupTitle}>{title}</Text>
      <View style={s.chipWrap}>{children}</View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
      style={[s.chip, active && s.chipActive]}
    >
      <Text style={[s.chipLabel, active && s.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  welcome: { flex: 1, padding: space.xl, justifyContent: 'space-between', gap: space.xxl },
  markRow: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 108, height: 108, borderRadius: 30, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  markLetters: { fontSize: 42, fontWeight: '800', color: colors.mint, letterSpacing: -1 },
  headline: { ...type.display, color: colors.text },
  sub: { ...type.body, color: colors.textMuted, lineHeight: 22, maxWidth: 320 },

  tasteBody: { padding: space.xl, gap: space.xl, paddingBottom: space.xxl },
  stepTitle: { ...type.title, color: colors.text },
  stepSub: { ...type.body, color: colors.textMuted, lineHeight: 21, marginTop: -space.md },
  groupTitle: { ...type.micro, color: colors.textFaint },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.lg, paddingVertical: 10, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.mintWash, borderColor: colors.mint },
  chipLabel: { ...type.small, color: colors.textMuted },
  chipLabelActive: { color: colors.mint },
  note: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  tasteFooter: { padding: space.xl, gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
});
