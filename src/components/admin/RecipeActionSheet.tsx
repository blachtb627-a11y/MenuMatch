import React, { useEffect, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import { REASON_LABELS } from './Shared';
import {
  STRIKE_REASONS, adminModerateRecipe, type RecipeModeration,
} from '@/lib/admin';
import { colors, fill, radius, space, type } from '@/theme';

/**
 * Take one recipe down, put it under review, or put it back — from wherever
 * you found it, without filing a report against yourself first.
 *
 * Removing is not deleting. The recipe stops being visible anywhere, the
 * creator is told which recipe and why, and the decision is appealable and
 * reversible (§20.5). That is the whole point: the moderator who is wrong at
 * two in the morning has to be able to be wrong reversibly.
 *
 * The reason is required, and it is the same taxonomy reporters use, so the
 * three reasons that cost a strike through the queue cost one here too — where
 * an action was started should not change what it costs (§18.2).
 */

export type ModerationTarget = {
  id: string;
  title: string;
  /** 'removed' | 'under_review' | 'clear' — decides which actions are offered. */
  moderationState: string;
};

const REASONS = Object.keys(REASON_LABELS);

export function RecipeActionSheet({
  recipe, onClose, onDone,
}: {
  /** Null closes the sheet. */
  recipe: ModerationTarget | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [action, setAction] = useState<RecipeModeration>('remove');
  const [reason, setReason] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The sheet stays mounted between openings, so every field is reset here or
  // the next recipe inherits the last one's decision.
  useEffect(() => {
    if (!recipe) return;
    setAction(recipe.moderationState === 'removed' ? 'reinstate' : 'remove');
    setReason(null);
    setNotes('');
    setError(null);
    setBusy(false);
  }, [recipe]);

  if (!recipe) return null;

  const isRemoved = recipe.moderationState === 'removed';
  const needsReason = action !== 'reinstate';

  async function submit() {
    if (!recipe) return;
    if (needsReason && !reason) {
      setError('Pick a reason. The creator is told what it was.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminModerateRecipe(recipe.id, action, needsReason ? reason : null,
                                notes.trim() || null);
      onDone(
        action === 'remove' ? `“${recipe.title}” removed`
          : action === 'restrict' ? `“${recipe.title}” is under review`
          : `“${recipe.title}” is back`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
      setBusy(false);
    }
  }

  const options: { value: RecipeModeration; icon: keyof typeof Feather.glyphMap;
                   label: string; body: string }[] = isRemoved
    ? [{ value: 'reinstate', icon: 'rotate-ccw', label: 'Put it back',
         body: 'Publishes it again and tells the creator the decision was reversed.' }]
    : [
        { value: 'remove', icon: 'trash-2', label: 'Remove it',
          body: 'Stops it appearing anywhere. The creator is told why and can appeal.' },
        { value: 'restrict', icon: 'eye-off', label: 'Put it under review',
          body: 'Hides it from the deck while you decide. Nothing is final yet.' },
      ];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <Text style={s.title} numberOfLines={2}>{recipe.title}</Text>
        <Text style={s.subtitle}>
          {isRemoved
            ? 'This recipe is currently removed.'
            : 'Nothing here deletes anything — every action can be undone.'}
        </Text>

        <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
          {options.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => { setAction(o.value); setError(null); }}
              accessibilityRole="radio"
              accessibilityState={{ selected: action === o.value }}
              accessibilityLabel={o.label}
              style={[s.option, action === o.value && s.optionOn]}
            >
              <Feather name={o.icon} size={16}
                       color={action === o.value ? colors.mint : colors.textMuted} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.optionLabel, action === o.value && { color: colors.mint }]}>
                  {o.label}
                </Text>
                <Text style={s.optionBody}>{o.body}</Text>
              </View>
            </Pressable>
          ))}

          {needsReason ? (
            <>
              <Text style={s.sectionLabel}>REASON</Text>
              <View style={s.reasonWrap}>
                {REASONS.map((r) => (
                  <Pressable
                    key={r}
                    // Clearing here too: an error still on screen next to the
                    // thing you just fixed reads as a second, different problem.
                    onPress={() => { setReason(r); setError(null); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: reason === r }}
                    accessibilityLabel={REASON_LABELS[r] ?? r}
                    style={[s.reason, reason === r && s.reasonOn]}
                  >
                    <Text style={[s.reasonLabel, reason === r && { color: colors.mint }]}>
                      {REASON_LABELS[r] ?? r}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* §18.2: say so before the button is pressed, not after. */}
              {action === 'remove' && reason && STRIKE_REASONS.includes(reason) ? (
                <View style={s.strikeNote}>
                  <Feather name="alert-triangle" size={13} color={colors.clay} />
                  <Text style={s.strikeNoteLabel}>
                    This also puts a strike on the creator's account.
                  </Text>
                </View>
              ) : null}

              <Text style={s.sectionLabel}>NOTES FOR THE RECORD (OPTIONAL)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="What you saw, and anything the next moderator should know."
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="Moderator notes"
                style={s.notes}
              />
            </>
          ) : null}
        </ScrollView>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="Cancel" variant="secondary" onPress={onClose}
                  disabled={busy} style={{ flex: 1 }} />
          <Button
            label={busy ? 'Working…'
              : action === 'remove' ? 'Remove it'
              : action === 'restrict' ? 'Put under review'
              : 'Put it back'}
            onPress={() => void submit()}
            disabled={busy}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { ...fill, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: space.lg,
    paddingBottom: space.xxl, gap: space.md,
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderBright,
    alignSelf: 'center',
  },
  title: { ...type.heading, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted, marginTop: -space.sm, lineHeight: 18 },

  option: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.md,
    padding: space.md, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, marginBottom: space.sm,
  },
  optionOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  optionLabel: { ...type.bodyStrong, color: colors.text },
  optionBody: { ...type.small, color: colors.textMuted, lineHeight: 18 },

  sectionLabel: { ...type.micro, color: colors.textFaint, marginTop: space.md,
                  marginBottom: space.sm },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  reason: {
    paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border,
  },
  reasonOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  reasonLabel: { ...type.small, color: colors.textMuted },

  strikeNote: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md,
    padding: space.md, borderRadius: radius.md, backgroundColor: colors.clayWash,
  },
  strikeNoteLabel: { ...type.small, color: colors.clay, flex: 1, lineHeight: 18 },

  notes: {
    backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: space.md, height: 78,
    color: colors.text, fontSize: 15, textAlignVertical: 'top',
  },
  error: { ...type.small, color: colors.danger },
});
