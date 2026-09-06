/**
 * MenuMatch visual identity, taken from the app mark: a near-black ground with
 * a slight green cast, and a single mint accent.
 *
 * §18.3 note on the pass control: it is deliberately a warm clay, not a red X.
 * Red-X-on-a-card is the reference app's trade dress and MenuMatch does not
 * borrow it. Passing a recipe is not a rejection, it is "not tonight".
 */
export const colors = {
  // grounds, darkest to lightest
  ground: '#0C120F',
  surface: '#151D19',
  raised: '#1E2A24',
  border: '#26332C',
  borderBright: '#35463D',

  // the mark
  mint: '#3EBF9F',
  mintDim: '#2E9A7F',
  mintDeep: '#1E6B58',
  mintWash: 'rgba(62,191,159,0.14)',
  onMint: '#04140F',

  // pass side
  clay: '#D9915C',
  clayWash: 'rgba(217,145,92,0.14)',

  text: '#ECF2EF',
  textMuted: '#93A39C',
  textFaint: '#66766F',

  danger: '#D9635C',
  scrim: 'rgba(6,10,8,0.72)',
  overlay: 'rgba(6,10,8,0.92)',
} as const;

export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
} as const;

export const radius = {
  sm: 8, md: 12, lg: 18, xl: 26, pill: 999,
} as const;

export const type = {
  display: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  title:   { fontSize: 23, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  body:    { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  small:   { fontSize: 13, fontWeight: '500' },
  micro:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
} as const;

/** Motion budget from §8.2: card transitions stay under 250ms. */
export const motion = {
  cardExit: 220,
  fast: 140,
  settle: 260,
} as const;

/**
 * Seed photography is not in place yet (§5 is a content problem, not an
 * engineering one), and §24 asks for a dominant-colour placeholder anyway.
 * A stable hash of the recipe id picks a warm food-toned pair so a card without
 * a loaded image still looks deliberate rather than broken.
 */
const COVER_PAIRS: readonly (readonly [string, string])[] = [
  ['#2C3A2E', '#4A5B3C'], ['#3A3128', '#5C4A33'], ['#26343A', '#3C5560'],
  ['#3A2A2E', '#5E3F42'], ['#2E3A34', '#456254'], ['#3A342A', '#605136'],
  ['#2A2F3A', '#404A66'], ['#333A2A', '#556037'],
];

export function coverGradient(seed: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_PAIRS[h % COVER_PAIRS.length]!;
}

/** RN 0.86 no longer types StyleSheet.absoluteFillObject; this replaces it. */
export const fill = {
  position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
} as const;
