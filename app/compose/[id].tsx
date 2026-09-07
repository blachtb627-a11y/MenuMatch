import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RecipeCover } from '@/components/RecipeCover';
import { Toast } from '@/components/Toast';
import { Button, ConfirmDialog, Loading, Screen } from '@/components/ui';
import { ChoiceRow, Input, Labelled, RowActions } from '@/components/composer/Fields';
import {
  deleteDraft, emptyDraft, getDraft, publishRecipe, saveDraft, scanRecipe, ScanError,
  type Draft, type DraftIngredient,
} from '@/lib/composer';
import { parseIngredientList, parseSteps } from '@/lib/parseIngredients';
import {
  COVER_EDGE, downscale, pickImage, readAsBase64, SCAN_EDGE, uploadImage,
} from '@/lib/media';
import { fetchConfig } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { formatQuantity } from '@/lib/quantity';
import { colors, fill, radius, space, type } from '@/theme';

/** §15: autosave every 10 seconds and on every field blur. */
const AUTOSAVE_MS = 10_000;
const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export default function Compose() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const [draft, setDraft] = useState<Draft | null>(isNew ? emptyDraft() : null);
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [tagOptions, setTagOptions] = useState<{ value: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [pasteOpen, setPasteOpen] = useState<'ingredients' | 'steps' | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStage, setScanStage] = useState('');
  const [scanSeconds, setScanSeconds] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // Set once the server says scanning has no API key configured. Retrying would
  // fail the same way every time, so the card collapses instead of teasing it.
  const [scanUnavailable, setScanUnavailable] = useState(false);
  const [busyImage, setBusyImage] = useState(false);

  // The autosave timer reads the latest draft without re-arming on every keystroke.
  const draftRef = useRef<Draft | null>(draft);
  draftRef.current = draft;
  const dirty = useRef(false);

  useEffect(() => {
    void fetchConfig().then((c) => {
      setCategories(c.categories
        .filter((x) => !['for_you', 'following'].includes(x.slug))
        .map((x) => ({ value: x.slug, label: x.label })));
    }).catch(() => {});
    void supabase.from('tags').select('slug, name, type')
      .in('type', ['dietary', 'equipment', 'occasion'])
      .then(({ data }) => {
        setTagOptions(((data ?? []) as { slug: string; name: string }[])
          .map((t) => ({ value: t.slug, label: t.name })));
      });
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    void getDraft(id)
      .then((d) => { setDraft(d); setRightsConfirmed(!!d.rightsConfirmedAt); })
      .catch(() => setToast('Could not open that draft'));
  }, [id, isNew]);

  const persist = useCallback(async (): Promise<string | null> => {
    const current = draftRef.current;
    if (!current) return null;
    setSaving(true);
    try {
      const { id: savedId, savedAt: at } = await saveDraft(current);
      dirty.current = false;
      setSavedAt(at);
      if (!current.id) setDraft((d) => (d ? { ...d, id: savedId } : d));
      return savedId;
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not save');
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  // §15: losing a creator's half-finished recipe is an unrecoverable trust
  // failure, so this runs on a timer regardless of what the user is doing.
  useEffect(() => {
    const t = setInterval(() => { if (dirty.current) void persist(); }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [persist]);

  // A count-up is the difference between "still working" and "frozen".
  useEffect(() => {
    if (!scanning) { setScanSeconds(0); return; }
    const startedAt = Date.now();
    const t = setInterval(
      () => setScanSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [scanning]);

  const update = useCallback((patch: Partial<Draft>) => {
    dirty.current = true;
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  const onBlur = useCallback(() => { if (dirty.current) void persist(); }, [persist]);

  if (!draft) return <Screen><Loading label="Opening your draft" /></Screen>;

  function setIngredient(index: number, patch: Partial<DraftIngredient>) {
    const next = [...draft!.ingredients];
    next[index] = { ...next[index]!, ...patch };
    update({ ingredients: next });
  }

  function moveRow<T>(list: T[], from: number, to: number): T[] {
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    return next;
  }

  async function chooseCover(source: 'library' | 'camera') {
    setBusyImage(true);
    try {
      const picked = await pickImage(source);
      if (!picked) return;
      const url = await uploadImage(await downscale(picked, COVER_EDGE), 'covers');
      update({ coverImageUrl: url });
      await persist();
      setToast('Cover photo added');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not add that photo');
    } finally {
      setBusyImage(false);
    }
  }

  /** Scan the creator's own written recipe and fill the fields for review. */
  async function runScan(source: 'library' | 'camera') {
    setScanNote(null);
    setScanError(null);
    let picked;
    try {
      picked = await pickImage(source);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not open the camera');
      return;
    }
    if (!picked) return;

    setScanning(true);
    try {
      // Shrink on the device first. Sending a full-size camera photo is what
      // made this hang: the request never finished uploading.
      setScanStage('Preparing the photo…');
      const small = await downscale(picked, SCAN_EDGE, true);
      setScanStage('Reading the recipe…');
      const scanned = await scanRecipe({
        base64: await readAsBase64(small),
        mimeType: small.mimeType,
      });

      const ingredients = (scanned.ingredients ?? []).length
        ? scanned.ingredients!
        : draft!.ingredients;
      const steps = (scanned.steps ?? []).length ? scanned.steps! : draft!.steps;

      dirty.current = true;
      setDraft((d) => (d ? {
        ...d,
        title: scanned.title || d.title,
        description: scanned.description || d.description,
        category: scanned.category || d.category,
        cuisine: scanned.cuisine || d.cuisine,
        prepMinutes: scanned.prepMinutes ?? d.prepMinutes,
        cookMinutes: scanned.cookMinutes ?? d.cookMinutes,
        servings: scanned.servings ?? d.servings,
        difficulty: (scanned.difficulty as Draft['difficulty']) || d.difficulty,
        ingredients,
        steps,
        tags: scanned.tags?.length ? scanned.tags : d.tags,
      } : d));

      await persist();
      setScanNote(
        scanned.confidence === 'high'
          ? 'Scanned. Check it over before publishing.'
          : `Scanned, but some of it was hard to read${scanned.notes ? `: ${scanned.notes}` : ''}. Check every field.`,
      );
    } catch (e) {
      if (e instanceof ScanError && e.code === 'not_configured') {
        setScanUnavailable(true);
      } else {
        // Kept in the card rather than a toast that disappears: when a scan
        // fails the reason is the only thing worth acting on.
        setScanError(e instanceof Error ? e.message : 'Could not scan that photo');
      }
    } finally {
      setScanning(false);
      setScanStage('');
    }
  }

  async function commitDelete() {
    if (!draft?.id) return;
    setDeleting(true);
    try {
      await deleteDraft(draft.id);
      setConfirmDelete(false);
      router.replace('/(tabs)/create');
    } catch (e) {
      setConfirmDelete(false);
      setToast(e instanceof Error ? e.message : 'Could not delete that draft');
    } finally {
      setDeleting(false);
    }
  }

  async function onPublish() {
    const savedId = await persist();
    if (!savedId) return;
    const result = await publishRecipe(savedId, rightsConfirmed);
    if (result.published) {
      setToast('Published');
      setTimeout(() => router.replace('/(tabs)/create'), 600);
    } else {
      setMissing(result.missing ?? []);
      setToast('Not quite ready to publish');
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <Pressable onPress={() => { void persist(); router.back(); }}
                     accessibilityRole="button" accessibilityLabel="Close the composer">
            <Feather name="chevron-left" size={24} color={colors.text} />
          </Pressable>
          <Text style={s.barTitle}>{draft.status === 'published' ? 'Edit recipe' : 'New recipe'}</Text>
          <Text style={s.saveState}>
            {saving ? 'Saving…' : savedAt ? 'Saved' : ' '}
          </Text>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                              style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">

            {/* Scan — framed as transcribing the creator's own recipe (§18.2). */}
            <View style={s.scanCard}>
              <View style={s.scanHead}>
                <Feather name="camera" size={17} color={colors.mint} />
                <Text style={s.scanTitle}>Scan your recipe</Text>
              </View>
              {scanUnavailable ? null : (
                <Text style={s.scanBody}>
                  Photograph a recipe you wrote — a card, a notebook page, your own
                  printout — and we'll fill these fields in for you to check. The
                  photo is read and discarded; it is not saved anywhere.
                </Text>
              )}
              {scanUnavailable ? null : (
                <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                  <Button label={scanning ? 'Reading…' : 'Take a photo'}
                          onPress={() => void runScan('camera')} disabled={scanning} />
                  <Button label="Choose an image" variant="secondary"
                          onPress={() => void runScan('library')} disabled={scanning} />
                </View>
              )}
              {scanUnavailable ? (
                <Text style={s.scanOff}>
                  Scanning isn't switched on yet. Write the recipe out below in the
                  meantime — nothing else here depends on it.
                </Text>
              ) : null}
              {scanning ? (
                <View style={s.scanBusy}>
                  <ActivityIndicator color={colors.mint} size="small" />
                  <Text style={s.scanBusyLabel}>
                    {scanStage || 'Reading the photo…'}
                    {scanSeconds > 3 ? `  ${scanSeconds}s` : ''}
                  </Text>
                </View>
              ) : null}
              {scanNote ? <Text style={s.scanNote}>{scanNote}</Text> : null}
              {scanError ? (
                <View style={s.scanErrorBox}>
                  <Feather name="alert-triangle" size={13} color={colors.danger} />
                  <Text style={s.scanErrorText}>{scanError}</Text>
                </View>
              ) : null}
            </View>

            <Labelled label="Cover photo" required
                      hint="The card is mostly photograph, so this one matters more than anything else here.">
              <Pressable onPress={() => void chooseCover('library')} disabled={busyImage}
                         accessibilityRole="button" accessibilityLabel="Choose a cover photo"
                         style={s.coverPicker}>
                {draft.coverImageUrl ? (
                  <RecipeCover uri={draft.coverImageUrl} seed={draft.id ?? 'draft'}
                               title={draft.title || 'Recipe'} style={StyleSheet.absoluteFill} />
                ) : (
                  <View style={s.coverEmpty}>
                    <Feather name={busyImage ? 'loader' : 'image'} size={22} color={colors.textMuted} />
                    <Text style={s.coverEmptyLabel}>
                      {busyImage ? 'Uploading…' : 'Add a cover photo'}
                    </Text>
                  </View>
                )}
              </Pressable>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label="Camera" variant="secondary" onPress={() => void chooseCover('camera')} />
                <Button label="Library" variant="secondary" onPress={() => void chooseCover('library')} />
              </View>
            </Labelled>

            <Labelled label="Title" required>
              <Input value={draft.title} onChangeText={(t) => update({ title: t })}
                     onBlur={onBlur} placeholder="Charred Lemon Chicken Thighs" maxLength={100} />
            </Labelled>

            <Labelled label="Description"
                      hint="One or two lines on why this is worth cooking.">
              <Input value={draft.description} onChangeText={(t) => update({ description: t })}
                     onBlur={onBlur} multiline maxLength={1000}
                     placeholder="Weeknight sheet-pan chicken with a bright lemon crust." />
            </Labelled>

            <Labelled label="Meal" required>
              <ChoiceRow options={categories} value={draft.category}
                         onChange={(v) => { update({ category: v }); void persist(); }} />
            </Labelled>

            <Labelled label="Cuisine" required>
              <Input value={draft.cuisine} onChangeText={(t) => update({ cuisine: t })}
                     onBlur={onBlur} placeholder="Mediterranean" />
            </Labelled>

            <View style={s.threeUp}>
              <View style={{ flex: 1 }}>
                <Labelled label="Prep (min)" required>
                  <Input value={draft.prepMinutes?.toString() ?? ''} keyboardType="number-pad"
                         onChangeText={(t) => update({ prepMinutes: t ? Number(t) : null })}
                         onBlur={onBlur} placeholder="10" />
                </Labelled>
              </View>
              <View style={{ flex: 1 }}>
                <Labelled label="Cook (min)" required>
                  <Input value={draft.cookMinutes?.toString() ?? ''} keyboardType="number-pad"
                         onChangeText={(t) => update({ cookMinutes: t ? Number(t) : null })}
                         onBlur={onBlur} placeholder="25" />
                </Labelled>
              </View>
              <View style={{ flex: 1 }}>
                <Labelled label="Serves" required>
                  <Input value={draft.servings?.toString() ?? ''} keyboardType="number-pad"
                         onChangeText={(t) => update({ servings: t ? Number(t) : null })}
                         onBlur={onBlur} placeholder="4" />
                </Labelled>
              </View>
            </View>

            <Labelled label="Difficulty">
              <ChoiceRow options={DIFFICULTIES} value={draft.difficulty}
                         onChange={(v) => { update({ difficulty: v as Draft['difficulty'] }); void persist(); }} />
            </Labelled>

            {/* ---------------------------------------------- ingredients */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>Ingredients</Text>
                <Pressable onPress={() => setPasteOpen('ingredients')} accessibilityRole="button">
                  <Text style={s.link}>Paste a list</Text>
                </Pressable>
              </View>

              {draft.ingredients.map((row, i) => (
                <View key={i} style={s.ingredientRow}>
                  <View style={{ flex: 1, gap: space.sm }}>
                    <View style={{ flexDirection: 'row', gap: space.sm }}>
                      <Input
                        value={row.quantity ? String(formatQuantity(row.quantity, row.unit) ?? '') : ''}
                        onChangeText={(t) => {
                          const parsed = parseIngredientList(`${t} x`)[0];
                          setIngredient(i, { quantity: parsed?.quantity ?? null });
                        }}
                        onBlur={onBlur}
                        placeholder="1 1/2"
                        style={[s.qtyInput]}
                        accessibilityLabel={`Amount for ingredient ${i + 1}`}
                      />
                      <Input value={row.unit} onChangeText={(t) => setIngredient(i, { unit: t })}
                             onBlur={onBlur} placeholder="lb" style={s.unitInput}
                             accessibilityLabel={`Unit for ingredient ${i + 1}`} />
                      <View style={{ flex: 1 }}>
                        <Input value={row.ingredient}
                               onChangeText={(t) => setIngredient(i, { ingredient: t })}
                               onBlur={onBlur} placeholder="bone-in chicken thighs"
                               accessibilityLabel={`Ingredient ${i + 1}`} />
                      </View>
                    </View>
                    {row.ingredient ? (
                      <Input value={row.note} onChangeText={(t) => setIngredient(i, { note: t })}
                             onBlur={onBlur} placeholder="note, e.g. skin on"
                             accessibilityLabel={`Note for ingredient ${i + 1}`} />
                    ) : null}
                  </View>
                  <RowActions
                    label={`ingredient ${i + 1}`}
                    canUp={i > 0} canDown={i < draft.ingredients.length - 1}
                    onUp={() => update({ ingredients: moveRow(draft.ingredients, i, i - 1) })}
                    onDown={() => update({ ingredients: moveRow(draft.ingredients, i, i + 1) })}
                    onRemove={() => update({
                      ingredients: draft.ingredients.filter((_, x) => x !== i),
                    })}
                  />
                </View>
              ))}
              <Button label="Add an ingredient" variant="secondary"
                      onPress={() => update({
                        ingredients: [...draft.ingredients,
                          { quantity: null, unit: '', ingredient: '', note: '' }],
                      })} />
            </View>

            {/* ---------------------------------------------- steps */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>Method</Text>
                <Pressable onPress={() => setPasteOpen('steps')} accessibilityRole="button">
                  <Text style={s.link}>Paste the method</Text>
                </Pressable>
              </View>

              {draft.steps.map((step, i) => (
                <View key={i} style={s.stepRow}>
                  <View style={s.stepNumber}><Text style={s.stepNumberLabel}>{i + 1}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Input value={step} multiline
                           onChangeText={(t) => {
                             const next = [...draft.steps];
                             next[i] = t;
                             update({ steps: next });
                           }}
                           onBlur={onBlur}
                           placeholder="Roast for 25 minutes, until deeply browned."
                           accessibilityLabel={`Step ${i + 1}`} />
                  </View>
                  <RowActions
                    label={`step ${i + 1}`}
                    canUp={i > 0} canDown={i < draft.steps.length - 1}
                    onUp={() => update({ steps: moveRow(draft.steps, i, i - 1) })}
                    onDown={() => update({ steps: moveRow(draft.steps, i, i + 1) })}
                    onRemove={() => update({ steps: draft.steps.filter((_, x) => x !== i) })}
                  />
                </View>
              ))}
              <Text style={s.hintSmall}>
                Mentioning a duration ("simmer for 20 minutes") adds a one-tap timer in Cook Mode.
              </Text>
              <Button label="Add a step" variant="secondary"
                      onPress={() => update({ steps: [...draft.steps, ''] })} />
            </View>

            {/* ---------------------------------------------- tags */}
            <Labelled label="Tags"
                      hint="Dietary tags are shown as creator-supplied and are not verified by MenuMatch.">
              <View style={s.tagWrap}>
                {tagOptions.map((t) => {
                  const on = draft.tags.includes(t.value);
                  return (
                    <Pressable key={t.value}
                               onPress={() => {
                                 update({ tags: on
                                   ? draft.tags.filter((x) => x !== t.value)
                                   : [...draft.tags, t.value] });
                                 void persist();
                               }}
                               accessibilityRole="checkbox"
                               accessibilityState={{ checked: on }}
                               accessibilityLabel={t.label}
                               style={[s.tag, on && s.tagOn]}>
                      <Text style={[s.tagLabel, on && { color: colors.mint }]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Labelled>

            <Labelled label="Adapted from"
                      hint="If this started as someone else's recipe, credit them here.">
              <Input value={draft.attribution} onChangeText={(t) => update({ attribution: t })}
                     onBlur={onBlur} placeholder="Adapted from…" maxLength={300} />
            </Labelled>

            {/* §18.2: unticked by default, required, stored with a timestamp. */}
            <Pressable onPress={() => setRightsConfirmed((v) => !v)}
                       accessibilityRole="checkbox"
                       accessibilityState={{ checked: rightsConfirmed }}
                       accessibilityLabel="Confirm you have the rights to publish this"
                       style={s.rightsRow}>
              <View style={[s.checkbox, rightsConfirmed && s.checkboxOn]}>
                {rightsConfirmed ? <Feather name="check" size={13} color={colors.onMint} /> : null}
              </View>
              <Text style={s.rightsLabel}>
                This recipe and these photos are my own work, or I have permission
                to publish them.
              </Text>
            </Pressable>

            {/* Only an unpublished draft that exists on the server. Publishing
                turns this into unpublish, which keeps it for anyone who saved. */}
            {draft.id && draft.status === 'draft' ? (
              <Pressable onPress={() => setConfirmDelete(true)} style={s.deleteRow}
                         accessibilityRole="button" accessibilityLabel="Delete this draft">
                <Feather name="trash-2" size={15} color={colors.danger} />
                <Text style={s.deleteLabel}>Delete this draft</Text>
              </Pressable>
            ) : null}

            {missing.length ? (
              <View style={s.missingBox}>
                <Text style={s.missingTitle}>Still needed before publishing</Text>
                {missing.map((m) => (
                  <Text key={m} style={s.missingItem}>• {m}</Text>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={s.footer}>
          <Button label="Save draft" variant="secondary"
                  onPress={() => { void persist(); setToast('Draft saved'); }} style={{ flex: 1 }} />
          <Button label="Publish" onPress={onPublish} style={{ flex: 1 }} />
        </View>
      </SafeAreaView>

      <ConfirmDialog
        visible={confirmDelete}
        title={`Delete “${draft.title || 'Untitled draft'}”?`}
        body="This draft has never been published, so nothing else links to it. It goes for good."
        confirmLabel="Delete draft"
        busy={deleting}
        onConfirm={() => void commitDelete()}
        onCancel={() => setConfirmDelete(false)}
      />

      <PasteSheet
        mode={pasteOpen}
        onClose={() => setPasteOpen(null)}
        onApply={(text) => {
          if (pasteOpen === 'ingredients') {
            const rows = parseIngredientList(text);
            if (rows.length) update({ ingredients: rows });
          } else {
            const steps = parseSteps(text);
            if (steps.length) update({ steps });
          }
          setPasteOpen(null);
          void persist();
          setToast('Added — check the rows over');
        }}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function PasteSheet({
  mode, onClose, onApply,
}: {
  mode: 'ingredients' | 'steps' | null;
  onClose: () => void;
  onApply: (text: string) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => { if (mode) setText(''); }, [mode]);
  if (!mode) return null;

  const isIngredients = mode === 'ingredients';
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <Text style={s.sheetTitle}>
          {isIngredients ? 'Paste your ingredients' : 'Paste your method'}
        </Text>
        <Text style={s.sheetBody}>
          {isIngredients
            ? 'One ingredient per line. We split the amount, unit and preparation out for you to correct.'
            : 'One step per line, or paste it as a paragraph and we will split it.'}
        </Text>
        <Input
          value={text}
          onChangeText={setText}
          multiline
          style={s.pasteInput}
          accessibilityLabel={isIngredients ? 'Ingredient list' : 'Method text'}
          placeholder={isIngredients
            ? '400g spaghetti\n2 cloves garlic, sliced\n3 tbsp olive oil'
            : '1. Heat the oven to 220C.\n2. Roast for 25 minutes.'}
        />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button label="Add rows" onPress={() => onApply(text)}
                  disabled={!text.trim()} style={{ flex: 1 }} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  barTitle: { ...type.bodyStrong, color: colors.text },
  saveState: { ...type.small, color: colors.textFaint, minWidth: 56, textAlign: 'right' },

  body: { padding: space.xl, gap: space.xl, paddingBottom: space.xxxl },

  scanCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg,
    gap: space.md, borderWidth: 1, borderColor: colors.mintDeep,
  },
  scanHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  scanTitle: { ...type.heading, color: colors.text },
  scanBody: { ...type.small, color: colors.textMuted, lineHeight: 19 },
  scanBusy: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  scanBusyLabel: { ...type.small, color: colors.textMuted },
  scanNote: { ...type.small, color: colors.mint, lineHeight: 18 },

  coverPicker: {
    height: 180, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    marginBottom: space.sm,
  },
  coverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  coverEmptyLabel: { ...type.small, color: colors.textMuted },

  threeUp: { flexDirection: 'row', gap: space.md },

  section: { gap: space.md },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...type.heading, color: colors.text },
  link: { ...type.small, color: colors.mint, fontWeight: '600' },
  hintSmall: { ...type.small, color: colors.textFaint, lineHeight: 17 },

  ingredientRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  qtyInput: { width: 74 },
  unitInput: { width: 74 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  stepNumber: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.raised,
    alignItems: 'center', justifyContent: 'center', marginTop: space.md,
  },
  stepNumberLabel: { ...type.small, color: colors.textMuted, fontWeight: '700' },

  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: {
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tagOn: { borderColor: colors.mint, backgroundColor: colors.mintWash },
  tagLabel: { ...type.small, color: colors.textMuted },

  rightsRow: {
    flexDirection: 'row', gap: space.md, alignItems: 'flex-start',
    backgroundColor: colors.surface, padding: space.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5,
    borderColor: colors.borderBright, alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.mint, borderColor: colors.mint },
  rightsLabel: { ...type.small, color: colors.text, flex: 1, lineHeight: 19 },

  missingBox: {
    backgroundColor: colors.clayWash, padding: space.lg, borderRadius: radius.md, gap: space.xs,
  },
  missingTitle: { ...type.bodyStrong, color: colors.clay },
  missingItem: { ...type.small, color: colors.text },

  scanOff: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  scanErrorBox: {
    flexDirection: 'row', gap: space.sm, alignItems: 'flex-start',
    backgroundColor: colors.dangerWash, borderRadius: radius.md, padding: space.md,
  },
  scanErrorText: { ...type.small, color: colors.danger, flex: 1, lineHeight: 18 },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.sm, paddingVertical: space.md,
  },
  deleteLabel: { ...type.body, color: colors.danger },
  footer: {
    flexDirection: 'row', gap: space.md, padding: space.lg,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
  },

  scrim: { ...fill, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xxl, gap: space.md,
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderBright, alignSelf: 'center',
  },
  sheetTitle: { ...type.heading, color: colors.text },
  sheetBody: { ...type.small, color: colors.textMuted, lineHeight: 19 },
  pasteInput: { minHeight: 160 },
});
