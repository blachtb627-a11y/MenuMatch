import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { Button, Loading, Screen } from '@/components/ui';
import { fetchRecipe } from '@/lib/api';
import { queueCook } from '@/lib/queue';
import { renderIngredient } from '@/lib/quantity';
import { describeDuration, formatDuration, parseTimerSeconds } from '@/lib/timers';
import { useSession } from '@/state/session';
import { colors, fill, radius, space, type } from '@/theme';
import type { Recipe } from '@/lib/types';
import { goBack } from '@/lib/nav';

/**
 * Cook Mode (§11). One step at a time, large type, high contrast, screen kept
 * awake, ingredients reachable without leaving the step, and a one-tap timer
 * for any step whose text names a duration.
 *
 * "Cook Mode is where a recipe app earns retention." — §11
 */
export default function CookMode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isGuest } = useSession();
  useKeepAwake();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [index, setIndex] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [askCooked, setAskCooked] = useState(false);

  // timer state
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const notificationId = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void fetchRecipe(id).then(setRecipe).catch(() => setRecipe(null));
  }, [id]);

  useEffect(() => {
    if (!running || remaining === null) return;
    if (remaining <= 0) {
      setRunning(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [running, remaining]);

  const cancelNotification = useCallback(async () => {
    if (notificationId.current) {
      await Notifications.cancelScheduledNotificationAsync(notificationId.current).catch(() => {});
      notificationId.current = null;
    }
  }, []);

  const startTimer = useCallback(
    async (seconds: number, stepText: string) => {
      setRemaining(seconds);
      setRunning(true);
      // §11: timers continue in the background and fire a local notification.
      try {
        const { status } = await Notifications.getPermissionsAsync();
        const granted =
          status === 'granted' || (await Notifications.requestPermissionsAsync()).status === 'granted';
        if (granted) {
          await cancelNotification();
          notificationId.current = await Notifications.scheduleNotificationAsync({
            content: { title: 'Timer done', body: stepText.slice(0, 120), sound: true },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                       seconds, repeats: false },
          });
        }
      } catch {
        // an in-app countdown still runs without notification permission
      }
    },
    [cancelNotification],
  );

  const stopTimer = useCallback(async () => {
    setRunning(false);
    setRemaining(null);
    await cancelNotification();
  }, [cancelNotification]);

  if (!recipe) return <Screen><Loading label="Getting ready" /></Screen>;

  const steps = recipe.steps;
  const step = steps[index];
  const isLast = index === steps.length - 1;
  const timerSeconds = step ? step.timerSeconds ?? parseTimerSeconds(step.instruction) : null;

  async function exit(markCooked: boolean) {
    await stopTimer();
    if (markCooked && !isGuest) await queueCook(recipe!.id);
    goBack(`/recipe/${id}`);
  }

  function advance() {
    if (isLast) {
      // §11: prompt "Cooked it?" once, on exit at the final step.
      setAskCooked(true);
      return;
    }
    void stopTimer();
    setIndex((i) => Math.min(steps.length - 1, i + 1));
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={s.topBar}>
          <Pressable onPress={() => void exit(false)} accessibilityRole="button"
                     accessibilityLabel="Leave Cook Mode" style={s.topButton}>
            <Feather name="x" size={20} color={colors.textMuted} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${((index + 1) / steps.length) * 100}%` }]} />
          </View>
          <Text style={s.progressLabel}>{index + 1}/{steps.length}</Text>
        </View>

        <ScrollView contentContainerStyle={s.stepBody}>
          <Text style={s.stepEyebrow}>STEP {index + 1}</Text>
          <Text style={s.stepText}>{step?.instruction ?? ''}</Text>

          {timerSeconds ? (
            <View style={s.timerBlock}>
              {remaining === null ? (
                <Button
                  label={`Start ${describeDuration(timerSeconds)} timer`}
                  onPress={() => void startTimer(timerSeconds, step!.instruction)}
                />
              ) : (
                <View style={s.timerRunning}>
                  <Text style={s.timerValue} accessibilityLiveRegion="polite">
                    {formatDuration(remaining)}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: space.md }}>
                    <Button
                      label={running ? 'Pause' : 'Resume'}
                      variant="secondary"
                      onPress={() => setRunning((r) => !r)}
                    />
                    <Button label="Stop" variant="ghost" onPress={() => void stopTimer()} />
                  </View>
                  {remaining <= 0 ? <Text style={s.timerDone}>Time is up.</Text> : null}
                </View>
              )}
            </View>
          ) : null}
        </ScrollView>

        <View style={s.bottomBar}>
          <Pressable
            onPress={() => setDrawer(true)}
            accessibilityRole="button"
            accessibilityLabel="Show ingredients"
            style={s.drawerButton}
          >
            <Feather name="list" size={18} color={colors.text} />
            <Text style={s.drawerLabel}>Ingredients</Text>
          </Pressable>

          <View style={s.navRow}>
            <Button
              label="Back"
              variant="secondary"
              disabled={index === 0}
              onPress={() => { void stopTimer(); setIndex((i) => Math.max(0, i - 1)); }}
            />
            <Button label={isLast ? 'Finish' : 'Next'} onPress={advance} style={{ flex: 1 }} />
          </View>
        </View>
      </SafeAreaView>

      {/* §11: a persistent ingredient drawer reachable without leaving the step */}
      <Modal visible={drawer} transparent animationType="slide" onRequestClose={() => setDrawer(false)}>
        <Pressable style={s.scrim} onPress={() => setDrawer(false)} accessibilityLabel="Close" />
        <View style={s.drawer}>
          <View style={s.grabber} />
          <Text style={s.drawerTitle}>Ingredients</Text>
          <ScrollView>
            {recipe.ingredients.map((ing) => (
              <Text key={ing.id} style={s.drawerItem}>
                {renderIngredient(ing, recipe.servings, recipe.servings)}
                {ing.note ? <Text style={{ color: colors.textMuted }}>{`, ${ing.note}`}</Text> : null}
              </Text>
            ))}
          </ScrollView>
          <Button label="Close" variant="secondary" onPress={() => setDrawer(false)} />
        </View>
      </Modal>

      <Modal visible={askCooked} transparent animationType="fade">
        <View style={s.askScrim}>
          <View style={s.askCard}>
            <Text style={s.askTitle}>Cooked it?</Text>
            <Text style={s.askBody}>
              Logging a cook helps other people find recipes that actually work.
            </Text>
            <View style={{ gap: space.sm }}>
              <Button label="Yes, cooked it" onPress={() => void exit(true)} />
              <Button label="Not this time" variant="ghost" onPress={() => void exit(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  topButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.raised },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.mint },
  progressLabel: { ...type.small, color: colors.textMuted, minWidth: 40, textAlign: 'right' },

  stepBody: { padding: space.xl, paddingTop: space.xxl, gap: space.xl, flexGrow: 1 },
  stepEyebrow: { ...type.micro, color: colors.mint },
  // large type, high contrast (§11)
  stepText: { fontSize: 28, lineHeight: 39, fontWeight: '600', color: colors.text },
  timerBlock: { marginTop: space.lg },
  timerRunning: { gap: space.lg, alignItems: 'flex-start' },
  timerValue: { fontSize: 56, fontWeight: '700', color: colors.mint, letterSpacing: -1 },
  timerDone: { ...type.bodyStrong, color: colors.mint },

  bottomBar: {
    padding: space.lg, gap: space.md, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  drawerButton: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start',
    paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill,
    backgroundColor: colors.raised,
  },
  drawerLabel: { ...type.small, color: colors.text },
  navRow: { flexDirection: 'row', gap: space.md },

  scrim: { ...fill, backgroundColor: colors.scrim },
  drawer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '72%',
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xxl, gap: space.md,
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderBright, alignSelf: 'center',
  },
  drawerTitle: { ...type.heading, color: colors.text },
  drawerItem: { ...type.body, color: colors.text, paddingVertical: space.sm, lineHeight: 22 },

  askScrim: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  askCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl,
    gap: space.lg, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: colors.border,
  },
  askTitle: { ...type.title, color: colors.text },
  askBody: { ...type.body, color: colors.textMuted, lineHeight: 21 },
});
