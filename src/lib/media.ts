import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';
import { newOpaqueId } from './device';

const BUCKET = 'recipe-media';

/**
 * Long-edge cap for an image sent to the model.
 *
 * Image tokens go roughly as area, and at 1280px the photograph was about half
 * the whole request — 1600 of 3094 input tokens. 1024px is still comfortably
 * legible for printed and handwritten recipe text and costs about a third
 * less, which is a third less to upload, to process, and to count against a
 * rate limit. A 4000px photo base64-encoded into a JSON body is what made
 * scanning hang in the first place.
 */
const SCAN_MAX_EDGE = 1024;

/** Cover photos are displayed, so they keep more detail than a scan needs. */
const COVER_MAX_EDGE = 2048;

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

/** Formats the vision API accepts. An iPhone's HEIC is not among them. */
const MODEL_SAFE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Downscales to fit `maxEdge` and re-encodes as JPEG. A phone camera produces
 * images far larger than anything here needs, and shrinking on the device is
 * dramatically cheaper than shipping the pixels first.
 *
 * `alwaysReencode` forces the pass even when the image already fits, which is
 * what the scan path wants: it guarantees JPEG, and a photo straight off an
 * iPhone is HEIC, which the model cannot read at all.
 *
 * Returns the original untouched if it is already small enough, or if the
 * resize fails for any reason — a slow scan beats a broken one.
 */
export async function downscale(
  image: PickedImage, maxEdge: number, alwaysReencode = false,
): Promise<PickedImage> {
  const longest = Math.max(image.width ?? 0, image.height ?? 0);
  const fits = !!longest && longest <= maxEdge;
  const safeFormat = MODEL_SAFE_TYPES.includes(image.mimeType);
  if (fits && safeFormat && !alwaysReencode) return image;

  try {
    const portrait = (image.height ?? 0) > (image.width ?? 0);
    const context = ImageManipulator.ImageManipulator.manipulate(image.uri);
    if (!fits) context.resize(portrait ? { height: maxEdge } : { width: maxEdge });
    const rendered = await context.renderAsync();
    const out = await rendered.saveAsync({
      compress: 0.75,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: out.uri, mimeType: 'image/jpeg', width: out.width, height: out.height };
  } catch {
    return image;
  }
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

/**
 * Removes an uploaded image, given the public URL that uploadImage returned.
 * Files can only go through the storage API — storage.objects rejects a direct
 * SQL delete — and the bucket policy scopes this to the caller's own prefix.
 *
 * Best effort by design: callers use it to tidy up after the row it belonged to
 * is already gone, and a file left behind must never fail that operation.
 */
export async function removeUploadedImage(publicUrl: string | null): Promise<void> {
  if (!publicUrl) return;
  const marker = `/${BUCKET}/`;
  const at = publicUrl.indexOf(marker);
  if (at === -1) return;
  const path = publicUrl.slice(at + marker.length);
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // An orphaned file is not worth surfacing to the person deleting a draft.
  }
}

export const SCAN_EDGE = SCAN_MAX_EDGE;
export const COVER_EDGE = COVER_MAX_EDGE;
