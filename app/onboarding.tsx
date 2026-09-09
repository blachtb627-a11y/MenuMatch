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
 * The taste pass: roughly fifteen seconds of tapping, and skippable. Shown once,
 * after the account exists, so the picks can be written straight to it.
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
    // The taste pass says what to show; the tutorial says how to use it.
    router.replace('/tutorial');
  }

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
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
          <Button label="Continue" onPress={finish} />
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
      accessibilityState={{ checked: active }} aria-checked={active}
      accessibilityLabel={label}
      style={[s.chip, active && s.chipActive]}
    >
      <Text style={[s.chipLabel, active && s.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({

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
