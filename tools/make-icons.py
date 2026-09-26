#!/usr/bin/env python3
"""Build the app icon, Android foreground, favicon and splash from the logo.

The source is the Swipzy lockup as supplied: the two recipe cards, the coral
swipe arrow, the pointing hand, and the wordmark under them, all on white.

An app icon cannot carry the wordmark — at 60pt "Swipzy" is four grey pixels —
so the icon is the graphic alone. Separating the two is the only fiddly part:
the tall letters and the leaf start *above* the bottom of the pointing hand, so
a single horizontal cut through the lockup takes the top off the "S". The band
under the cards is cleared first, which leaves the hand as the only thing below
the artwork, and the cut is made under that.

Run from the repo root: python3 tools/make-icons.py <path-to-logo>
Requires Pillow. The outputs are committed, so this is only needed when the
logo changes.
"""
import sys
from PIL import Image

WHITE = (254, 254, 254)
# Measured on the 1254px source. All coordinates below are in its pixels.
SOURCE_WIDTH = 1254
CARD_BOTTOM = 730       # nothing but the hand and the wordmark below this
HAND_LEFT = 790         # the hand's left edge in the overlap band
HAND_BOTTOM = 767       # the hand's lowest pixel


def trim(img):
    """Crop to the non-white content."""
    mask = img.convert('L').point(lambda v: 0 if v > 246 else 255)
    return img.crop(mask.getbbox())


def build_mark(im):
    """The graphic alone — cards, arrow, heart, hand — with no wordmark."""
    work = im.copy()
    px = work.load()
    for y in range(CARD_BOTTOM, HAND_BOTTOM):
        for x in range(0, HAND_LEFT):
            px[x, y] = WHITE
    for y in range(HAND_BOTTOM, min(HAND_BOTTOM + 40, im.size[1])):
        for x in range(im.size[0]):
            px[x, y] = WHITE
    return trim(work.crop((140, 90, 1120, HAND_BOTTOM + 40)))


def place(crop, size, inset, bg=(255, 255, 255), alpha=False):
    """Scale `crop` to `inset` of a `size` square and centre it."""
    w, h = crop.size
    scale = (size * inset) / max(w, h)
    art = crop.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    canvas = (Image.new('RGBA', (size, size), (0, 0, 0, 0)) if alpha
              else Image.new('RGB', (size, size), bg))
    pos = ((size - art.size[0]) // 2, (size - art.size[1]) // 2)
    canvas.paste(art, pos, art if art.mode == 'RGBA' else None)
    return canvas


def knockout_white(img):
    """Drop the white field so an adaptive background shows through."""
    out = img.convert('RGBA')
    px = out.load()
    for y in range(out.size[1]):
        for x in range(out.size[0]):
            r, g, b, _ = px[x, y]
            if r > 247 and g > 247 and b > 247:
                px[x, y] = (r, g, b, 0)
    return out


def main(path):
    im = Image.open(path).convert('RGB')
    if im.size[0] != SOURCE_WIDTH:
        print(f'note: source is {im.size[0]}px wide, the cut lines were '
              f'measured on {SOURCE_WIDTH}px — check the output', file=sys.stderr)
    mark = build_mark(im)

    # App Store and iOS: opaque, square, no alpha channel, no rounded corners.
    place(mark, 1024, 0.86).save('assets/icon.png')
    # Android masks the outer quarter of the foreground, so this sits smaller.
    place(knockout_white(mark), 1024, 0.60, alpha=True).save('assets/adaptive-icon.png')
    place(mark, 96, 0.94).save('assets/favicon.png')
    # The in-app mark, for the welcome screen.
    #
    # Opaque on its own white field, not a transparent cut-out. The card in
    # the artwork is itself white, so knocking the white out punches a hole
    # straight through it, and the navy hand disappears against any dark
    # ground — rendered side by side, both failures are obvious. The screen
    # rounds the corners with overflow instead, which gives the same tile and
    # cannot be used wrongly. 512 because it is drawn at about 108pt.
    place(mark, 512, 0.72).save('assets/mark.png')
    # The splash is the one place the wordmark belongs.
    place(trim(im), 1024, 0.70).save('assets/splash.png')

    for name in ('icon', 'adaptive-icon', 'favicon', 'splash'):
        out = Image.open(f'assets/{name}.png')
        print(f'assets/{name}.png {out.size[0]}x{out.size[1]} {out.mode}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/logo-source.webp')
