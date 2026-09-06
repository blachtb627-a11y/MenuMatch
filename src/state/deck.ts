import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { fetchFeed } from '@/lib/api';
import { queueSwipe, queueSave, queueUnsave, dropQueuedFor } from '@/lib/queue';
import { undoSwipe } from '@/lib/api';
import { newOpaqueId } from '@/lib/device';
import type { FeedPage, RecipeCard, SwipeAction } from '@/lib/types';

/** §8.3 deck supply: keep at least 5 buffered, refill when it drops to 3. */
const MIN_BUFFER = 3;
const TARGET_BUFFER = 5;
const PAGE_SIZE = 20;
const PREFETCH_AHEAD = 3;
/** §8.2: undo covers the last 3 actions in the session. */
const UNDO_DEPTH = 3;

type UndoEntry = { card: RecipeCard; action: SwipeAction; index: number };

export type DeckState = {
  cards: RecipeCard[];
  loading: boolean;
  error: string | null;
  fallback: FeedPage['fallback'] | null;
  canUndo: boolean;
  /** True when the ranked pool and every fallback are empty. */
  exhausted: boolean;
};

export function useDeck(category: string, isGuest: boolean) {
  const [cards, setCards] = useState<RecipeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<FeedPage['fallback'] | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  const sessionId = useRef(newOpaqueId());
  const seen = useRef<Set<string>>(new Set());
  const loadingMore = useRef(false);
  const categoryRef = useRef(category);

  const loadMore = useCallback(
    async (replace = false) => {
      if (loadingMore.current) return;
      loadingMore.current = true;
      try {
        const page = await fetchFeed({
          category,
          limit: PAGE_SIZE,
          exclude: Array.from(seen.current),
        });
        setFallback(page.fallback);
        const fresh = (page.cards ?? []).filter((c) => !seen.current.has(c.id));
        fresh.forEach((c) => seen.current.add(c.id));
        setCards((prev) => (replace ? fresh : [...prev, ...fresh]));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the deck');
      } finally {
        loadingMore.current = false;
        setLoading(false);
      }
    },
    [category],
  );

  // Switching category starts a fresh deck.
  useEffect(() => {
    categoryRef.current = category;
    seen.current = new Set();
    setCards([]);
    setUndoStack([]);
    setLoading(true);
    void loadMore(true);
  }, [category, loadMore]);

  // §8.3: a swipe must never wait on a network request, so the next few images
  // are warmed before the user reaches them.
  useEffect(() => {
    const urls = cards
      .slice(0, PREFETCH_AHEAD)
      .map((c) => c.coverImageUrl)
      .filter((u): u is string => !!u);
    if (urls.length) void Image.prefetch(urls);
  }, [cards]);

  useEffect(() => {
    if (!loading && cards.length <= MIN_BUFFER) void loadMore();
  }, [cards.length, loading, loadMore]);

  const act = useCallback(
    async (action: SwipeAction, card?: RecipeCard) => {
      const target = card ?? cards[0];
      if (!target) return;

      // Optimistic: the card leaves immediately, the write goes to the queue.
      setCards((prev) => prev.filter((c) => c.id !== target.id));
      setUndoStack((prev) =>
        [{ card: target, action, index: 0 }, ...prev].slice(0, UNDO_DEPTH),
      );

      await queueSwipe({
        recipeId: target.id,
        action,
        categoryContext: categoryRef.current,
        sessionId: sessionId.current,
      });

      // A guest can swipe freely; only saving is gated (§7 soft gate), and the
      // caller intercepts that before we get here.
      if (action === 'save' && !isGuest) {
        await queueSave(target.id, 'deck');
      }
    },
    [cards, isGuest],
  );

  const undo = useCallback(async () => {
    const [entry, ...rest] = undoStack;
    if (!entry) return;
    setUndoStack(rest);

    // If the write never left the device, dropping it is the whole undo.
    const wasQueued = await dropQueuedFor(entry.card.id);
    if (!wasQueued) {
      try {
        await undoSwipe(entry.card.id);
      } catch {
        // Undo is best effort; the card returns to the deck regardless.
      }
    } else if (entry.action === 'save' && !isGuest) {
      await queueUnsave(entry.card.id);
    }

    seen.current.delete(entry.card.id);
    // §8.2: undoing a pass returns the card to the front of the deck.
    setCards((prev) => [entry.card, ...prev.filter((c) => c.id !== entry.card.id)]);
  }, [undoStack, isGuest]);

  const state: DeckState = {
    cards,
    loading,
    error,
    fallback,
    canUndo: undoStack.length > 0,
    exhausted: !loading && cards.length === 0 && fallback === 'exhausted',
  };

  return { ...state, act, undo, reload: () => loadMore(true), lastAction: undoStack[0] ?? null };
}
