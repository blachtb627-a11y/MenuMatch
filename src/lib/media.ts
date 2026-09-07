import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { newOpaqueId } from './device';

const BUCKET = 'recipe-media';

export type PickedImage = { uri: string; mimeType: string; width?: number; height?: number };

/**
 * Opens the library or camera. §24 caps uploads at 10MB, so images are
 * downscaled and recompressed here rather than rejected after the round trip.
 */
export async function pickImage(source: 'library' | 'camera'): Promise<PickedImage | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is needed to take a photo.');
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.8,
    // Deliberately no `exif` request: §24 requires GPS never leaves the device.
    exif: false,
  };

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0]!;
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    width: asset.width,
    height: asset.height,
  };
}

/**
 * Uploads to `<user_id>/<folder>/<file>`. Storage policy checks the first path
 * segment against the caller, so a creator can only write inside their own
 * prefix.
 */
/**
 * Reads a picked image as base64, for callers that need the bytes rather than a
 * hosted URL. fetch() on a local file URI yields the bytes on native and web
 * alike; FileReader is the one path available in both runtimes.
 */
export async function readAsBase64(image: PickedImage): Promise<string> {
  const blob = await (await fetch(image.uri)).blob();
  if (blob.size > 10 * 1024 * 1024) {
    throw new Error('That image is over 10MB. Try a smaller one.');
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  // Strip the "data:image/jpeg;base64," prefix the API does not want.
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export async function uploadImage(
  image: PickedImage,
  folder: string,
): Promise<string> {
  const { data: me, error: meErr } = await supabase.rpc('me');
  if (meErr) throw new Error(meErr.message);
  const userId = (me as { id: string } | null)?.id;
  if (!userId) throw new Error('You need an account to upload photos.');

  const extension = image.mimeType.includes('png') ? 'png'
    : image.mimeType.includes('webp') ? 'webp' : 'jpg';
  const path = `${userId}/${folder}/${newOpaqueId()}.${extension}`;

  // fetch() on a local file URI yields the bytes on both native and web.
  const blob = await (await fetch(image.uri)).blob();
  if (blob.size > 10 * 1024 * 1024) {
    throw new Error('That image is over 10MB. Try a smaller one.');
  }

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: image.mimeType,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
