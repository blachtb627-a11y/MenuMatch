import React, { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Avatar } from '@/components/Avatar';
import { Toast } from '@/components/Toast';
import { BackButton, Button, ConfirmDialog, Screen } from '@/components/ui';
import { AVATAR_EDGE, downscale, pickImage, uploadImage } from '@/lib/media';
import { goBack } from '@/lib/nav';
import { replaceAvatar, updateProfile } from '@/lib/profile';
import { useSession } from '@/state/session';
import { colors, radius, space, type } from '@/theme';

/** §28.1: your name, your picture and your bio, editable by you. */
export default function EditProfile() {
  const { me, refreshMe } = useSession();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(me?.avatarUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!me) {
    return (
      <Screen><SafeAreaView style={s.center}>
        <Text style={s.body}>You need to be signed in to edit a profile.</Text>
        <Button label="Back" onPress={() => goBack('/(tabs)/profile')} />
      </SafeAreaView></Screen>
    );
  }

  /**
   * The picture saves on its own, immediately.
   *
   * Anything else would mean uploading a file and then losing it if the person
   * backs out of the screen, and a half-saved upload is worse than either
   * outcome.
   */
  async function chooseAvatar(source: 'library' | 'camera') {
    setError(null);
    try {
      const picked = await pickImage(source);
      if (!picked) return;
      setUploading(true);
      const small = await downscale(picked, AVATAR_EDGE, true);
      const url = await uploadImage(small, 'avatar');
      await replaceAvatar(me!.id, url, avatarUrl);
      setAvatarUrl(url);
      await refreshMe();
      setToast('Profile picture updated');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use that image');
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    setConfirmRemove(false);
    setError(null);
    setUploading(true);
    try {
      await replaceAvatar(me!.id, null, avatarUrl);
      setAvatarUrl(null);
      await refreshMe();
      setToast('Profile picture removed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateProfile(me!.id, { displayName, bio });
      await refreshMe();
      setToast('Profile saved');
      setTimeout(() => goBack('/(tabs)/profile'), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }

  const dirty = displayName.trim() !== (me.displayName ?? '')
    || bio.trim() !== (me.bio ?? '');

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.bar}>
          <BackButton fallback="/(tabs)/profile" />
          <Text style={s.barTitle}>Edit profile</Text>
          <View style={{ width: 44 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                              style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <View style={s.avatarBlock}>
              <View>
                {/* The typed name drives the initial, so the fallback previews live. */}
                <Avatar uri={avatarUrl} name={displayName || me.displayName} size={96} />
                {uploading ? (
                  <View style={s.avatarBusy}>
                    <ActivityIndicator color={colors.mint} />
                  </View>
                ) : null}
              </View>
              <View style={s.avatarActions}>
                <Button label="Choose a photo" variant="secondary" disabled={uploading}
                        onPress={() => void chooseAvatar('library')} />
                <Button label="Take one" variant="secondary" disabled={uploading}
                        onPress={() => void chooseAvatar('camera')} />
                {avatarUrl ? (
                  <Pressable onPress={() => setConfirmRemove(true)} disabled={uploading}
                             accessibilityRole="button"
                             accessibilityLabel="Remove profile picture" hitSlop={8}>
                    <Text style={s.remove}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            <Text style={s.hint}>
              Your picture and name are public, and appear on every recipe you
              publish.
            </Text>

            <View style={s.field}>
              <Text style={s.label}>DISPLAY NAME</Text>
              <TextInput value={displayName} onChangeText={setDisplayName}
                         style={s.input} maxLength={60}
                         placeholder="What people should call you"
                         placeholderTextColor={colors.textFaint}
                         accessibilityLabel="Display name" />
            </View>

            <View style={s.field}>
              <Text style={s.label}>USERNAME</Text>
              <View style={[s.input, s.readOnly]}>
                <Text style={s.readOnlyText}>@{me.username}</Text>
                <Feather name="lock" size={14} color={colors.textFaint} />
              </View>
              <Text style={s.hint}>
                Usernames are how people find you again, so they are fixed for
                now.
              </Text>
            </View>

            <View style={s.field}>
              <Text style={s.label}>BIO</Text>
              <TextInput value={bio} onChangeText={setBio} multiline
                         style={[s.input, s.multiline]} maxLength={300}
                         placeholder="One or two lines about how you cook."
                         placeholderTextColor={colors.textFaint}
                         accessibilityLabel="Bio" />
              <Text style={s.count}>{bio.trim().length}/300</Text>
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={s.footer}>
          <Button label={saving ? 'Saving…' : 'Save'} onPress={() => void save()}
                  disabled={!dirty || saving || uploading} />
        </View>
      </SafeAreaView>

      <ConfirmDialog
        visible={confirmRemove}
        title="Remove your profile picture?"
        body="Your initial goes back in its place. You can add another whenever you like."
        confirmLabel="Remove"
        busy={uploading}
        onConfirm={() => void removeAvatar()}
        onCancel={() => setConfirmRemove(false)}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xxl },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  barTitle: { ...type.bodyStrong, color: colors.text },
  body: { padding: space.xl, gap: space.lg, paddingBottom: space.xxxl },
  avatarBlock: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  avatarBusy: {
    position: 'absolute', left: 0, top: 0, width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center',
  },
  avatarActions: { flex: 1, gap: space.sm, alignItems: 'flex-start' },
  remove: { ...type.small, color: colors.danger, paddingVertical: space.xs },
  field: { gap: space.xs },
  label: { ...type.micro, color: colors.textFaint },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    color: colors.text, fontSize: 15, minHeight: 46,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md },
  readOnly: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  readOnlyText: { ...type.body, color: colors.textMuted },
  hint: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  count: { ...type.small, color: colors.textFaint, alignSelf: 'flex-end' },
  error: { ...type.small, color: colors.danger },
  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border },
});
