"""Draws the Sheaf mark and writes every icon the packager and the site need.

    python3 scripts/make-icons.py

The mark is a leaf whose veins are lines of text: sheaf, leaf, and a page of
prose in one shape. It is built as a solid silhouette with the midrib and the
lines cut out of it, which survives being shrunk to 16 pixels far better than an
outline would. One geometry feeds the PNGs, the .ico and the SVG on the website,
so they can never drift apart.

Needs Pillow: python3 -m pip install pillow
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - depends on the machine, not the code
    sys.exit('Pillow is required: python3 -m pip install pillow')

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'build'
SITE = ROOT / 'docs' / 'assets'

GRID = 32.0
SS = 8  # supersampling factor

# The leaf: widest below the middle, tapering to a point, on a short stem.
LEFT = [(16, 26.4), (3.0, 22.6), (6.2, 5.2), (16, 1.8)]
RIGHT = [(16, 1.8), (25.8, 5.2), (29.0, 22.6), (16, 26.4)]
STEM = (25.8, 30.4)
MIDRIB = (4.8, 25.4)
RIB_W = 1.5
RULE_W = 1.5
# (y, right end). Ragged on purpose: these are meant to read as lines of text.
LINES = [(9.9, 21.0), (13.6, 22.6), (17.3, 19.4), (21.0, 20.2)]

ACCENT = (82, 146, 217, 255)  # the application's blue, used inside the app icon
ACCENT_ON_PLATE = (99, 160, 228, 255)
SITE_ACCENT = (47, 111, 191, 255)  # the website's blue, used for the favicon
PLATE = (23, 26, 31, 255)
CLEAR = (0, 0, 0, 0)


def cubic(points, steps=240):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = points
    out = []
    for index in range(steps + 1):
        t = index / steps
        u = 1 - t
        out.append(
            (
                u**3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t**3 * x3,
                u**3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t**3 * y3,
            )
        )
    return out


def mark_layer(size, colour, knockout=CLEAR):
    """The mark, drawn to fill a size x size RGBA image at full resolution."""
    canvas = Image.new('RGBA', (size, size), CLEAR)
    draw = ImageDraw.Draw(canvas)
    scale = size / GRID
    p = lambda q: (q[0] * scale, q[1] * scale)

    draw.polygon([p(q) for q in cubic(LEFT) + cubic(RIGHT)], fill=colour)
    draw.line([p((16, STEM[0])), p((16, STEM[1]))], fill=colour, width=max(1, round(1.7 * scale)))
    draw.line(
        [p((16, MIDRIB[0])), p((16, MIDRIB[1]))],
        fill=knockout,
        width=max(1, round(RIB_W * scale)),
    )
    for y, end in LINES:
        draw.line([p((16, y)), p((end, y))], fill=knockout, width=max(1, round(RULE_W * scale)))
    return canvas


def glyph(size, colour=ACCENT):
    return mark_layer(size * SS, colour).resize((size, size), Image.LANCZOS)


def app_icon(size):
    """The packaged application icon: the mark on a dark rounded plate."""
    big = size * SS
    canvas = Image.new('RGBA', (big, big), CLEAR)
    ImageDraw.Draw(canvas).rounded_rectangle(
        [0, 0, big - 1, big - 1], radius=big * 0.22, fill=PLATE
    )
    pad = round(big * 0.14)
    inner = mark_layer(big - 2 * pad, ACCENT_ON_PLATE, knockout=PLATE)
    canvas.paste(inner, (pad, pad), inner)
    return canvas.resize((size, size), Image.LANCZOS)


def svg():
    """The same geometry as a single evenodd path, for the website."""
    half_rib = RIB_W / 2
    half_rule = RULE_W / 2
    parts = [
        f'M{LEFT[0][0]} {LEFT[0][1]}'
        f'C{LEFT[1][0]} {LEFT[1][1]} {LEFT[2][0]} {LEFT[2][1]} {LEFT[3][0]} {LEFT[3][1]}'
        f'C{RIGHT[1][0]} {RIGHT[1][1]} {RIGHT[2][0]} {RIGHT[2][1]} {RIGHT[3][0]} {RIGHT[3][1]}Z',
        # stem
        f'M{16 - 0.85} {STEM[0]}h1.7v{round(STEM[1] - STEM[0], 2)}h-1.7Z',
        # midrib, cut out of the leaf
        f'M{16 - half_rib} {MIDRIB[0]}h{RIB_W}v{round(MIDRIB[1] - MIDRIB[0], 2)}h-{RIB_W}Z',
    ]
    for y, end in LINES:
        # Starts at the far edge of the midrib so the holes never overlap.
        start = 16 + half_rib
        parts.append(
            f'M{start} {round(y - half_rule, 2)}h{round(end - start, 2)}v{RULE_W}h-{round(end - start, 2)}Z'
        )
    path = ''.join(parts)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor" '
        f'aria-hidden="true"><path fill-rule="evenodd" d="{path}"/></svg>\n'
    )


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    SITE.mkdir(parents=True, exist_ok=True)

    sizes = (16, 24, 32, 48, 64, 128, 256, 512)
    icons = {size: app_icon(size) for size in sizes}
    for size, image in icons.items():
        image.save(BUILD / f'icon-{size}.png')
    icons[512].save(BUILD / 'icon.png')
    icons[256].save(
        BUILD / 'icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    )
    print(f'build/icon.png, icon.ico and {len(sizes)} sized PNGs')

    # The website carries the bare mark in its own accent, so the browser tab
    # matches the masthead rather than the packaged application icon.
    glyph(256, SITE_ACCENT).save(SITE / 'mark.png')
    (SITE / 'mark.svg').write_text(svg())
    print('docs/assets/mark.png and mark.svg')


if __name__ == '__main__':
    main()
