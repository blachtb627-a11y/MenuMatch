/**
 * Cook Mode timers (§11).
 *
 * Durations are parsed server-side at publish time and stored on the step, so
 * this parser is the fallback for steps published before that ran, and for the
 * composer's live preview. It mirrors public.parse_timer_seconds in SQL.
 */
const DURATION = /(\d+)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)/i;

export function parseTimerSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = DURATION.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith('h')) return n * 3600;
  if (unit.startsWith('m')) return n * 60;
  return n;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "25 min" style label for the timer offer button. */
export function describeDuration(seconds: number): string {
  if (seconds % 3600 === 0 && seconds >= 3600) return `${seconds / 3600} hr`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds} sec`;
}

export function formatTotalTime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '--';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
