import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Toast } from '@/components/Toast';
import { CollectionSheet } from '@/components/CollectionSheet';
import { Button, Disclaimer, EmptyState, Loading, Screen } from '@/components/ui';
import { fetchRecipe } from '@/lib/api';
import { queueSave, queueUnsave, queueCook } from '@/lib/queue';
import { renderIngredient } from '@/lib/quantity';
import { formatTotalTime } from '@/lib/timers';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';
import type { Recipe } from '@/lib/types';

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isGuest, setPendingSave } = useSession();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [organising, setOrganising] = useState(false);

  useEffect(() => {
    if (!id) return;
    void fetchRecipe(id)
      .then((r) => {
        setRecipe(r);
        setSaved(r.isSaved);
        setServings(r.servings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this recipe'));
  }, [id]);

  const toggleCheck = useCallback((key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  async function onSave() {
    if (!recipe) return;
    if (isGuest) {
      setPendingSave({ recipeId: recipe.id, source: 'detail' });
      router.push('/auth');
      return;
    }
    if (saved) {
      setSaved(false);
      await queueUnsave(recipe.id);
      setToast('Removed from your Cookbook');
    } else {
      setSaved(true);
      await queueSave(recipe.id, 'detail');
      setToast('Saved to your Cookbook');
    }
  }

  async function onCooked() {
    if (!recipe) return;
    if (isGuest) { router.push('/auth'); return; }
    await queueCook(recipe.id);
    setToast('Nice. Logged as cooked.');
  }

  if (error) {
    return (
      <Screen><SafeAreaView style={{ flex: 1 }}>
        <EmptyState title="Could not load this recipe" body={error}
                    action={<Button label="Go back" onPress={() => router.back()} />} />
      </SafeAreaView></Screen>
    );
  }
  if (!recipe) return <Screen><Loading /></Screen>;

  // §17: a recipe that was removed or unpublished shows a clear state.
  if (recipe.unavailable) {
    return (
      <Screen><SafeAreaView style={{ flex: 1 }}>
        <EmptyState
          title="This recipe is no longer available"
          body="The creator unpublished it, or it was removed. It stays in your Cookbook until you remove it."
          action={<Button label="Go back" onPress={() => router.back()} />}
        />
      </SafeAreaView></Screen>
    );
  }

  const base = recipe.servings;
  const target = servings ?? base;
  const allergens = recipe.tags.filter((t) => t.type === 'allergen');
  const dietary = recipe.tags.filter((t) => t.type === 'dietary');
  const other = recipe.tags.filter((t) => !['allergen', 'dietary'].includes(t.type));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxxl }}>
        <RecipeCover uri={recipe.coverImageUrl} seed={recipe.id} title={recipe.title} style={s.hero}>
          <LinearGradient colors={['rgba(6,10,8,0.55)', 'transparent', 'rgba(6,10,8,0.95)']}
                          locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
          <SafeAreaView style={s.heroBar} edges={['top']}>
            <IconButton icon="arrow-left" label="Go back" onPress={() => router.back()} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <IconButton icon="flag" label="Report this recipe"
                          onPress={() => router.push(`/report/${recipe.id}`)} />
              <IconButton icon="folder-plus" label="Add to a collection"
                          onPress={() => {
                            if (isGuest) { router.push('/auth'); return; }
                            setOrganising(true);
                          }} />
              <IconButton icon={saved ? 'check' : 'bookmark'}
                          label={saved ? 'Remove from Cookbook' : 'Save to Cookbook'}
                          active={saved} onPress={onSave} />
            </View>
          </SafeAreaView>
        </RecipeCover>

        <View style={s.body}>
          <View style={{ gap: space.sm }}>
            <Text style={s.title}>{recipe.title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Creator ${recipe.creator.displayName}`}
              style={s.creatorRow}
            >
              <View style={s.avatar}>
                <Text style={s.avatarLetter}>
                  {recipe.creator.displayName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <Text style={s.creatorName}>{recipe.creator.displayName}</Text>
              {recipe.creator.isSeedAccount ? (
                <View style={s.seedBadge}><Text style={s.seedBadgeLabel}>MENUMATCH</Text></View>
              ) : null}
            </Pressable>
            {recipe.description ? <Text style={s.description}>{recipe.description}</Text> : null}
          </View>

          <View style={s.statRow}>
            <Stat label="Prep" value={formatTotalTime(recipe.prepMinutes)} />
            <Stat label="Cook" value={formatTotalTime(recipe.cookMinutes)} />
            <Stat label="Total" value={formatTotalTime(recipe.totalMinutes)} />
            {recipe.difficulty ? <Stat label="Level" value={recipe.difficulty} /> : null}
          </View>

          <View style={s.socialRow}>
            <Text style={s.social}>{recipe.saveCount} saved</Text>
            <Text style={s.dot}>·</Text>
            <Text style={s.social}>Cooked by {recipe.cookCount}</Text>
          </View>

          {/* §10: serving scaling is MVP. Quantities scale, times do not. */}
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Ingredients</Text>
              <ServingScaler value={target} base={base} onChange={setServings} />
            </View>

            {recipe.ingredients.map((ing) => {
              const key = ing.id;
              const on = checked.has(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => toggleCheck(key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={renderIngredient(ing, base, target)}
                  style={s.ingredientRow}
                >
                  <View style={[s.checkbox, on && s.checkboxOn]}>
                    {on ? <Feather name="check" size={13} color={colors.onMint} /> : null}
                  </View>
                  <Text style={[s.ingredientText, on && s.ingredientDone]}>
                    {renderIngredient(ing, base, target)}
                    {ing.note ? <Text style={s.ingredientNote}>{`, ${ing.note}`}</Text> : null}
                  </Text>
                </Pressable>
              );
            })}

            {target !== base ? (
              <Text style={s.scaleNote}>
                Scaled from {base} servings. Cooking times may need adjusting.
              </Text>
            ) : null}
          </View>

          <View style={s.section}>
            <Text style={s.sectionTitle}>Method</Text>
            {recipe.steps.map((step) => {
              const key = step.id;
              const on = checked.has(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => toggleCheck(key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Step ${step.position + 1}. ${step.instruction}`}
                  style={s.stepRow}
                >
                  <View style={[s.stepNumber, on && s.stepNumberOn]}>
                    <Text style={[s.stepNumberLabel, on && { color: colors.onMint }]}>
                      {step.position + 1}
                    </Text>
                  </View>
                  <Text style={[s.stepText, on && s.ingredientDone]}>{step.instruction}</Text>
                </Pressable>
              );
            })}
          </View>

          {recipe.nutrition ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Nutrition</Text>
              <View style={s.statRow}>
                {recipe.nutrition.calories != null ? <Stat label="Calories" value={String(recipe.nutrition.calories)} /> : null}
                {recipe.nutrition.proteinG != null ? <Stat label="Protein" value={`${recipe.nutrition.proteinG}g`} /> : null}
                {recipe.nutrition.carbsG != null ? <Stat label="Carbs" value={`${recipe.nutrition.carbsG}g`} /> : null}
                {recipe.nutrition.fatG != null ? <Stat label="Fat" value={`${recipe.nutrition.fatG}g`} /> : null}
              </View>
              {/* §19.3, verbatim requirement. Where the figures came from is
                  said plainly first, because "estimated by AI" and "copied off
                  the packet" deserve different amounts of trust. */}
              {recipe.nutrition.source === 'estimated' ? (
                <Text style={s.nutritionSource}>
                  Estimated from the ingredients, not measured.
                </Text>
              ) : null}
              <Disclaimer>
                Nutrition information is provided by the recipe creator and is an
                estimate. It has not been verified by MenuMatch.
              </Disclaimer>
            </View>
          ) : null}

          {(dietary.length || allergens.length || other.length) ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Tags</Text>
              <View style={s.tagWrap}>
                {[...dietary, ...other].map((t) => (
                  <View key={t.slug} style={s.tag}><Text style={s.tagLabel}>{t.name}</Text></View>
                ))}
              </View>
              {allergens.length ? (
                <View style={{ gap: space.sm, marginTop: space.md }}>
                  <Text style={s.allergenHead}>Contains</Text>
                  <View style={s.tagWrap}>
                    {allergens.map((t) => (
                      <View key={t.slug} style={[s.tag, s.allergenTag]}>
                        <Text style={[s.tagLabel, { color: colors.clay }]}>{t.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {/* §19.2: creator-supplied unless verified, and never auto-derived. */}
              <Disclaimer>
                Dietary and allergen tags are supplied by the creator and are not
                verified by MenuMatch. If you cook for an allergy, check every
                ingredient yourself.
              </Disclaimer>
            </View>
          ) : null}

          {recipe.attribution ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Attribution</Text>
              <Text style={s.description}>{recipe.attribution}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={s.actionBar}>
        <Button label="Cook Mode" onPress={() => router.push(`/cook/${recipe.id}`)} style={{ flex: 1 }} />
        <Button label="Cooked it" variant="secondary" onPress={onCooked} style={{ flex: 1 }} />
      </SafeAreaView>

      {/* §12: saving puts a recipe in the Cookbook; collections organise it. */}
      <CollectionSheet
        recipeId={organising ? recipe.id : null}
        recipeTitle={recipe.title}
        onClose={() => setOrganising(false)}
        onSaved={(message) => { setOrganising(false); setSaved(true); setToast(message); }}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

/** §10: scales quantities, never cook times. */
function ServingScaler({
  value, base, onChange,
}: { value: number; base: number; onChange: (v: number) => void }) {
  return (
    <View style={s.scaler}>
      <Pressable
        onPress={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        accessibilityRole="button"
        accessibilityLabel="Fewer servings"
        style={[s.scalerButton, value <= 1 && { opacity: 0.35 }]}
      >
        <Feather name="minus" size={16} color={colors.text} />
      </Pressable>
      <Text style={s.scalerValue} accessibilityLabel={`${value} servings`}>
        {value} {value === 1 ? 'serving' : 'servings'}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(48, value + 1))}
        accessibilityRole="button"
        accessibilityLabel="More servings"
        style={s.scalerButton}
      >
        <Feather name="plus" size={16} color={colors.text} />
      </Pressable>
      {value !== base ? (
        <Pressable onPress={() => onChange(base)} accessibilityRole="button"
                   accessibilityLabel="Reset servings">
          <Text style={s.reset}>Reset</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label.toUpperCase()}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

function IconButton({
  icon, label, onPress, active,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string; onPress: () => void; active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[s.iconButton, active && { backgroundColor: colors.mint }]}
    >
      <Feather name={icon} size={19} color={active ? colors.onMint : colors.text} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  hero: { height: 340 },
  heroBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    padding: space.lg, alignItems: 'flex-start',
  },
  iconButton: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(6,10,8,0.6)',
  },

  body: { padding: space.xl, gap: space.xl, marginTop: -space.xl },
  title: { ...type.display, color: colors.text, lineHeight: 36 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.mintDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { ...type.small, color: colors.mint, fontWeight: '700' },
  creatorName: { ...type.small, color: colors.text },
  seedBadge: { backgroundColor: colors.mintWash, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm },
  seedBadgeLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7, color: colors.mint },
  description: { ...type.body, color: colors.textMuted, lineHeight: 22 },

  statRow: { flexDirection: 'row', gap: space.xl, flexWrap: 'wrap' },
  stat: { gap: 2 },
  statLabel: { ...type.micro, color: colors.textFaint },
  statValue: { ...type.bodyStrong, color: colors.text, textTransform: 'capitalize' },

  socialRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  social: { ...type.small, color: colors.textMuted },
  dot: { color: colors.textFaint },

  section: { gap: space.md },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.md },
  nutritionSource: { ...type.small, color: colors.clay },
  sectionTitle: { ...type.heading, color: colors.text },

  scaler: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  scalerButton: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised,
    alignItems: 'center', justifyContent: 'center',
  },
  scalerValue: { ...type.small, color: colors.text, minWidth: 82, textAlign: 'center' },
  reset: { ...type.small, color: colors.mint },

  ingredientRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderBright,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.mint, borderColor: colors.mint },
  ingredientText: { ...type.body, color: colors.text, flex: 1, lineHeight: 22 },
  ingredientNote: { color: colors.textMuted },
  ingredientDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  scaleNote: { ...type.small, color: colors.textFaint, marginTop: space.sm, lineHeight: 18 },

  stepRow: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  stepNumber: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.raised,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumberOn: { backgroundColor: colors.mint },
  stepNumberLabel: { ...type.small, color: colors.textMuted, fontWeight: '700' },
  stepText: { ...type.body, color: colors.text, flex: 1, lineHeight: 23 },

  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: { backgroundColor: colors.raised, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  allergenTag: { backgroundColor: colors.clayWash },
  tagLabel: { ...type.small, color: colors.text },
  allergenHead: { ...type.micro, color: colors.textFaint },

  actionBar: {
    flexDirection: 'row', gap: space.md, padding: space.lg,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
});
