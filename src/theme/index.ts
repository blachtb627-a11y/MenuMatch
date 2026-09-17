/**
 * MenuMatch visual identity, taken from the app mark: a near-black ground and a
 * single mint accent.
 *
 * Two rules hold the look together, and most of this file exists to enforce
 * them:
 *
 * 1. Surfaces separate by value, not by outline. A dark screen where every box
 *    is drawn with a 1px border reads as a wireframe — it is the fastest way to
 *    make an app look generated rather than designed. `border` here is a
 *    hairline that is felt more than seen; when something genuinely needs to be
 *    picked out, it is lifted with `elevate` or filled with `raised`, not
 *    ringed. `borderBright` is for the handful of cases where the outline *is*
 *    the control.
 * 2. Mint is the only chroma. The grounds carry a trace of green so the app
 *    feels of a piece with the mark, but only a trace: an olive-black ground
 *    competes with the accent and turns it muddy. Everything structural is
 *    within a few points of neutral.
 *
 * §18.3 note on the pass control: it is deliberately a warm clay, not a red X.
 * Red-X-on-a-card is the reference app's trade dress and MenuMatch does not
 * borrow it. Passing a recipe is not a rejection, it is "not tonight".
 */
export const colors = {
  // Grounds, darkest to lightest. The steps are sized in *luminance*, not in
  // hex: near black, equal hex steps give shrinking perceptual steps, so a
  // ramp that looks even in the source reads as flat on the screen. These are
  // solved to ~6.5 and ~8.5 thousandths of luminance apart, which is enough to
  // read as separate planes with no border between them — that being the whole
  // point of the ramp, so resist narrowing it.
  sunken: '#040605',
  ground: '#090B0A',
  surface: '#171918',
  raised: '#232524',

  // A hairline. Low contrast on purpose: it should suggest an edge at a
  // glance and disappear at a read.
  border: '#272928',
  // The outline as a control — focused inputs, selected states, the edge of
  // something you are meant to notice.
  borderBright: '#3A3D3B',

  // the mark
  mint: '#3EBF9F',
  mintDim: '#2E9A7F',
  mintDeep: '#1E6B58',
  mintWash: 'rgba(62,191,159,0.14)',
  onMint: '#04140F',

  // pass side
  clay: '#D9915C',
  clayWash: 'rgba(217,145,92,0.14)',

  text: '#EEF2F0',
  textMuted: '#8D9994',
  // 4.5:1 on `ground`. This tier carries the 11px caps labels, and small text
  // needs more contrast than body, not less — the temptation to take it
  // further down is the reason it is written here with a number.
  textFaint: '#707B77',

  danger: '#D9635C',
  dangerWash: 'rgba(217,99,92,0.14)',

  /**
   * Translucent lifts, for content that sits on a photograph rather than on a
   * ground — a tag over a cover, the scroll hint. Warm white rather than pure
   * white: #FFF over a dark image goes blue-grey and looks like haze.
   */
  tintSoft: 'rgba(238,242,240,0.08)',
  tint: 'rgba(238,242,240,0.13)',
  tintStrong: 'rgba(238,242,240,0.18)',

  // Scrims, keyed to `ground` so they read as the app dimming rather than as a
  // grey sheet laid over it.
  scrim: 'rgba(5,7,6,0.60)',
  scrimStrong: 'rgba(5,7,6,0.78)',
  overlay: 'rgba(5,7,6,0.92)',
} as const;

export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
} as const;

export const radius = {
  sm: 10, md: 14, lg: 20, xl: 24, pill: 999,
} as const;

/**
 * Depth, in place of the outlines. `card` is the deck; `sheet` and `dialog` are
 * for things that come up over the app and need to sit clearly above it.
 *
 * Android takes `elevation` and ignores the rest; iOS takes the shadow and
 * ignores `elevation`. Both are set on every level so the two platforms agree.
 */
export const elevate = {
  card: {
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  sheet: {
    shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 32,
    shadowOffset: { width: 0, height: -6 }, elevation: 20,
  },
  dialog: {
    shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 40,
    shadowOffset: { width: 0, height: 16 }, elevation: 24,
  },
  /** For a control that should look pressable rather than drawn on. */
  control: {
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
} as const;

export const type = {
  display: { fontSize: 31, fontWeight: '700', letterSpacing: -0.7 },
  title:   { fontSize: 22, fontWeight: '700', letterSpacing: -0.45 },
  // 600, not 700. A screen where every heading is bold has no hierarchy in it.
  heading: { fontSize: 17, fontWeight: '600', letterSpacing: -0.25 },
  body:    { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  small:   { fontSize: 13, fontWeight: '500' },
  // Used for the small caps labels. Loosened from 700/0.8: at 11px, heavy and
  // widely tracked reads as a dashboard, not as a quiet label.
  micro:   { fontSize: 11, fontWeight: '600', letterSpacing: 0.55 },
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
