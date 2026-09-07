import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Toast } from '@/components/Toast';
import { Button, Loading, Screen } from '@/components/ui';
import { fetchConfig } from '@/lib/api';
import { myPreferences, savePreferences, type Preferences } from '@/lib/settings';
import { colors, radius, space, type } from '@/theme';

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

/**
 * §28.1. What onboarding asked once, changeable afterwards.
 *
 * The consequences are stated on the screen rather than left to be discovered:
 * a dietary tag is a hard filter on the deck, a disliked ingredient removes
 * anything containing it, and cuisines only nudge the order.
 */
export default function PreferencesScreen() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);
  const [dislikeDraft, setDislikeDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void myPreferences().then(setPrefs).catch(() => setToast('Could not load your preferences'));
    void fetchConfig()
      .then((c) => setCategories(
        c.categories.filter((x) => !['for_you', 'following'].includes(x.slug))
          .map((x) => ({ slug: x.slug, label: x.label }))))
      .catch(() => {});
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
  }, []);

  function toggle(list: string[], value: string) {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  function addDislike() {
    const value = dislikeDraft.trim().toLowerCase();
    if (!value || !prefs) return;
    if (prefs.dislikedIngredients.includes(value)) { setDislikeDraft(''); return; }
    update({ dislikedIngredients: [...prefs.dislikedIngredients, value] });
    setDislikeDraft('');
  }

  async function save() {
    if (!prefs) return;
    setSaving(true);
    try {
      await savePreferences({
        dietaryTags: prefs.dietaryTags,
        favoriteCategories: prefs.favoriteCategories,
        dislikedIngredients: prefs.dislikedIngredients,
        cuisines: prefs.cuisines,
      });
      setDirty(false);
      setToast('Saved. Your deck updates on the next refresh.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <Pressable onPress={() => router.back()} accessibilityRole="button"
                     accessibilityLabel="Back">
            <Feather name="chevron-left" size={24} color={colors.text} />
          </Pressable>
          <Text style={s.barTitle}>Dietary preferences</Text>
          <View style={{ width: 24 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                              style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">

            <Field label="Diet"
                   hint="A hard filter: recipes without these tags stay out of your deck entirely.">
              <View style={s.wrap}>
                {DIETARY.map((d) => (
                  <Chip key={d.slug} label={d.label} context="diet"
                        on={prefs.dietaryTags.includes(d.slug)}
                        onPress={() => update({ dietaryTags: toggle(prefs.dietaryTags, d.slug) })} />
                ))}
              </View>
            </Field>

            <Field label="Never show me"
                   hint="Any recipe listing one of these as an ingredient is filtered out.">
              <View style={s.addRow}>
                <TextInput
                  value={dislikeDraft}
                  onChangeText={setDislikeDraft}
                  placeholder="Coriander, olives, blue cheese…"
                  placeholderTextColor={colors.textFaint}
                  style={s.input}
                  autoCapitalize="none"
                  onSubmitEditing={addDislike}
                  returnKeyType="done"
                  accessibilityLabel="Ingredient to avoid"
                />
                <Button label="Add" variant="secondary" onPress={addDislike}
                        disabled={!dislikeDraft.trim()} />
              </View>
              {prefs.dislikedIngredients.length ? (
                <View style={s.wrap}>
                  {prefs.dislikedIngredients.map((ing) => (
                    <Pressable key={ing} style={s.removableChip}
                               accessibilityRole="button"
                               accessibilityLabel={`Stop avoiding ${ing}`}
                               onPress={() => update({
                                 dislikedIngredients:
                                   prefs.dislikedIngredients.filter((x) => x !== ing),
                               })}>
                      <Text style={s.removableLabel}>{ing}</Text>
                      <Feather name="x" size={12} color={colors.clay} />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={s.none}>Nothing avoided yet.</Text>
              )}
            </Field>

            <Field label="Cuisines you like"
                   hint="A nudge, not a filter: these come up more often, everything else still appears.">
              <View style={s.wrap}>
                {CUISINES.map((c) => (
                  <Chip key={c} label={c} context="cuisine"
                        on={prefs.cuisines.includes(c)}
                        onPress={() => update({ cuisines: toggle(prefs.cuisines, c) })} />
                ))}
              </View>
            </Field>

            {categories.length ? (
              <Field label="Meals you cook most" hint="Also a nudge.">
                <View style={s.wrap}>
                  {categories.map((c) => (
                    <Chip key={c.slug} label={c.label} context="meals"
                          on={prefs.favoriteCategories.includes(c.slug)}
                          onPress={() => update({
                            favoriteCategories: toggle(prefs.favoriteCategories, c.slug),
                          })} />
                  ))}
                </View>
              </Field>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        {dirty ? (
          <View style={s.footer}>
            <Button label={saving ? 'Saving…' : 'Save preferences'}
                    onPress={() => void save()} disabled={saving} />
          </View>
        ) : null}
      </SafeAreaView>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={s.fieldLabel}>{label.toUpperCase()}</Text>
      {children}
      <Text style={s.hint}>{hint}</Text>
    </View>
  );
}

/**
 * `context` disambiguates the label for assistive tech: "Vegetarian" appears
 * both as a diet and as a meal category, and the two do very different things.
 */
function Chip({
  label, context, on, onPress,
}: { label: string; context: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox"
               accessibilityState={{ checked: on }} aria-checked={on}
               accessibilityLabel={`${label} ${context}`}
               style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipLabel, on && { color: colors.mint }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
  },
  barTitle: { ...type.bodyStrong, color: colors.text },
  body: { padding: space.xl, paddingTop: space.sm, gap: space.xl, paddingBottom: space.xxxl },
  fieldLabel: { ...type.micro, color: colors.textFaint },
  hint: { ...type.small, color: colors.textFaint, lineHeight: 17 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.lg, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  chipLabel: { ...type.small, color: colors.textMuted },
  addRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, height: 46,
    color: colors.text, fontSize: 15,
  },
  removableChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.clayWash, borderWidth: 1, borderColor: colors.clay,
  },
  removableLabel: { ...type.small, color: colors.clay },
  none: { ...type.small, color: colors.textFaint },
  footer: {
    padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
