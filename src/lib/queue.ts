import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { getDeviceKey, newOpaqueId } from './device';
import type { SwipeAction } from './types';

/**
 * Offline write queue (§23.2, §27).
 *
 * Every entry carries an idempotency key generated once, at the moment of the
 * user's action, and reused on every retry. That is what makes a replay safe:
 * the server records the key and ignores the second delivery, so a flaky
 * network cannot double-count a cook or resurrect an unsaved recipe.
 *
 * The queue persists to storage on every mutation, so it survives app
 * termination, and drains with exponential backoff.
 */

const STORAGE_KEY = 'menumatch.writeQueue';
const MAX_BATCH = 20; // §23.2 caps a swipe batch at 20
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60_000;

type SwipeEntry = {
  kind: 'swipe';
  idempotencyKey: string;
  recipeId: string;
  action: SwipeAction;
  categoryContext: string | null;
  sessionId: string;
  clientTs: string;
};

type SaveEntry = {
  kind: 'save' | 'unsave';
  idempotencyKey: string;
  recipeId: string;
  source: string;
};

type CookEntry = {
  kind: 'cook';
  idempotencyKey: string;
  recipeId: string;
};

export type QueueEntry = SwipeEntry | SaveEntry | CookEntry;

let queue: QueueEntry[] = [];
let loaded = false;
let draining = false;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(pending: number) => void>();

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // If storage is full the in-memory queue still drains this session.
  }
  listeners.forEach((l) => l(queue.length));
}

export async function loadQueue(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) queue = JSON.parse(raw) as QueueEntry[];
  } catch {
    queue = [];
  }
  if (queue.length) void drain();
}

export function onQueueChange(fn: (pending: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pendingCount(): number {
  return queue.length;
}

async function enqueue(entry: QueueEntry): Promise<void> {
  queue.push(entry);
  await persist();
  void drain();
}

export function makeIdempotencyKey(): string {
  return newOpaqueId();
}

export async function queueSwipe(args: {
  recipeId: string;
  action: SwipeAction;
  categoryContext: string | null;
  sessionId: string;
}): Promise<void> {
  await enqueue({
    kind: 'swipe',
    idempotencyKey: makeIdempotencyKey(),
    clientTs: new Date().toISOString(),
    ...args,
  });
}

export async function queueSave(recipeId: string, source: string): Promise<void> {
  await enqueue({ kind: 'save', idempotencyKey: makeIdempotencyKey(), recipeId, source });
}

export async function queueUnsave(recipeId: string): Promise<void> {
  await enqueue({ kind: 'unsave', idempotencyKey: makeIdempotencyKey(), recipeId, source: '' });
}

export async function queueCook(recipeId: string): Promise<void> {
  await enqueue({ kind: 'cook', idempotencyKey: makeIdempotencyKey(), recipeId });
}

/**
 * Undo (§8.2) removes a not-yet-sent entry outright rather than sending an
 * action and then reversing it on the server.
 */
export async function dropQueuedFor(recipeId: string): Promise<boolean> {
  const before = queue.length;
  queue = queue.filter((e) => e.recipeId !== recipeId);
  if (queue.length !== before) {
    await persist();
    return true;
  }
  return false;
}

function scheduleRetry(): void {
  if (timer) return;
  const delay = Math.min(BASE_DELAY_MS * 2 ** failures, MAX_DELAY_MS);
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, delay);
}

export async function drain(): Promise<void> {
  if (draining || queue.length === 0) return;
  draining = true;

  try {
    while (queue.length > 0) {
      const head = queue[0]!;
      let sent = 0;

      if (head.kind === 'swipe') {
        // Batch consecutive swipes: one round trip per swipe is needless load.
        const batch: SwipeEntry[] = [];
        for (const e of queue) {
          if (e.kind !== 'swipe' || batch.length >= MAX_BATCH) break;
          batch.push(e);
        }
        const deviceKey = await getDeviceKey();
        const { error } = await supabase.rpc('record_swipes', {
          p_swipes: batch.map((e) => ({
            recipeId: e.recipeId,
            action: e.action,
            categoryContext: e.categoryContext,
            sessionId: e.sessionId,
            clientTs: e.clientTs,
            idempotencyKey: e.idempotencyKey,
          })),
          p_device_key: deviceKey,
        });
        if (error) throw error;
        sent = batch.length;
      } else if (head.kind === 'save') {
        const { error } = await supabase.rpc('save_recipe', {
          p_recipe_id: head.recipeId,
          p_source: head.source || 'deck',
          p_idempotency_key: head.idempotencyKey,
        });
        if (error) throw error;
        sent = 1;
      } else if (head.kind === 'unsave') {
        const { error } = await supabase.rpc('unsave_recipe', { p_recipe_id: head.recipeId });
        if (error) throw error;
        sent = 1;
      } else {
        const { error } = await supabase.rpc('record_cook', {
          p_recipe_id: head.recipeId,
          p_photo_url: null,
          p_idempotency_key: head.idempotencyKey,
        });
        if (error) throw error;
        sent = 1;
      }

      queue.splice(0, sent);
      failures = 0;
      await persist();
    }
  } catch {
    // Offline, or the server rejected the batch. Keep the entries and back off;
    // the idempotency keys make the eventual retry safe.
    failures += 1;
    scheduleRetry();
  } finally {
    draining = false;
  }
}
