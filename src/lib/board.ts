import { supabase } from './supabase';

/**
 * The weekly board (§16).
 *
 * Deliberately a seven-day window rather than an all-time table: an all-time
 * board freezes at whoever arrived first, and a new creator can see from the
 * outside that they will never catch up. Weekly, the reset does the work.
 */
export type BoardEntry = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  cuisine?: string | null;
  saves: number;
  position?: number;
  impressions?: number;
  isMine: boolean;
  creator: { id: string; username: string; displayName: string };
};

export type MyWeek = {
  saves: number;
  savesPriorWeek: number;
  published: number;
  bestPosition: number | null;
  best: { id: string; title: string; saves: number; position: number } | null;
};

export type WeeklyBoard = {
  from: string;
  to: string;
  top: BoardEntry[];
  rising: BoardEntry[];
  me: MyWeek | null;
};

export async function fetchWeeklyBoard(): Promise<WeeklyBoard> {
  const { data, error } = await supabase.rpc('weekly_board');
  if (error) throw new Error(error.message);
  const b = data as Partial<WeeklyBoard> | null;
  return {
    from: b?.from ?? '',
    to: b?.to ?? '',
    top: b?.top ?? [],
    rising: b?.rising ?? [],
    me: b?.me ?? null,
  };
}

/**
 * How your week went, in a sentence.
 *
 * Written to be worth reading when the number is zero, which is the case that
 * matters: the whole point of leading with your own figures rather than a rank
 * is that they say something to the person who did not place.
 */
export function describeWeek(me: MyWeek): { headline: string; detail: string } {
  const { saves, savesPriorWeek, published, best } = me;
  if (published === 0) {
    return {
      headline: 'Nothing published yet',
      detail: 'Post a recipe and it goes into next week’s board with everyone else’s.',
    };
  }
  if (saves === 0) {
    return {
      headline: 'No saves this week',
      detail: savesPriorWeek > 0
        ? `You had ${savesPriorWeek} last week. Quiet weeks happen — the board resets on its own.`
        : 'Your recipes are in the deck. Saves come from people finding them there.',
    };
  }
  const change = saves - savesPriorWeek;
  const trend = savesPriorWeek === 0
    ? 'your first saves in a week'
    : change > 0 ? `up ${change} on last week`
    : change < 0 ? `down ${-change} on last week`
    : 'the same as last week';
  return {
    headline: `${saves} save${saves === 1 ? '' : 's'} this week`,
    detail: best
      ? `${trend.charAt(0).toUpperCase()}${trend.slice(1)}. Your best was “${best.title}” at number ${best.position}.`
      : `${trend.charAt(0).toUpperCase()}${trend.slice(1)}.`,
  };
}

/** "1–7 September" — the window, without repeating the month twice. */
export function describeWindow(from: string, to: string): string {
  if (!from || !to) return 'The last seven days';
  const start = new Date(from);
  // `to` is exclusive: the day after the last day counted.
  const end = new Date(new Date(to).getTime() - 86_400_000);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'long' });
  const day = (d: Date) => d.getDate();
  return month(start) === month(end)
    ? `${day(start)}–${day(end)} ${month(end)}`
    : `${day(start)} ${month(start)} – ${day(end)} ${month(end)}`;
}
