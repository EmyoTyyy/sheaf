"""Cut the website assets out of the screenshots taken by site-screenshots.cjs.

    npm run build
    node scripts/site-screenshots.cjs
    python3 scripts/site-crops.py

Boxes are given in the application's own CSS pixels (the captured window is 1440
wide) and the captures are at device scale 2, so every box is doubled on the way
in. Each crop is cut at the size of the slot it lands in on the page, so the
interface is shown at close to its real size instead of being scaled down into
mush. Change a box here and the matching width and height attributes in
docs/index.html have to change with it.

Needs Pillow: python3 -m pip install pillow
"""

import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - depends on the machine, not the code
    sys.exit('Pillow is required: python3 -m pip install pillow')

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'out' / 'site-shots'
OUT = ROOT / 'docs' / 'assets'

# name -> (source shot, left, top, width, height) in application CSS pixels
CROPS = {
    'errors': ('error', 274, 668, 590, 165),
    'files': ('workbench', 36, 60, 246, 143),
    'search': ('search', 36, 62, 255, 246),
    'engines': ('latex-status', 486, 182, 590, 140),
    'log': ('raw-log', 274, 668, 690, 200),
}


def save(image: Image.Image, name: str) -> None:
    path = OUT / f'{name}.webp'
    image.save(path, 'WEBP', quality=86, method=6)
    print(f'{path.name:24} {image.width}x{image.height}  {path.stat().st_size // 1024} kB')


def main() -> None:
    if not SHOTS.exists():
        sys.exit(f'{SHOTS} is missing. Run node scripts/site-screenshots.cjs first.')
    OUT.mkdir(parents=True, exist_ok=True)

    for theme in ('dark', 'light'):
        folder = SHOTS / theme
        for name, (shot, left, top, width, height) in CROPS.items():
            source = Image.open(folder / f'{shot}.png').convert('RGB')
            box = (left * 2, top * 2, (left + width) * 2, (top + height) * 2)
            save(source.crop(box), f'{name}-{theme}')

        # The whole window, at a sensible delivery width.
        window = Image.open(folder / 'workbench.png').convert('RGB')
        ratio = 2200 / window.width
        save(window.resize((2200, round(window.height * ratio)), Image.LANCZOS), f'hero-{theme}')

    # Social card: 1.91:1, cut off the top of the dark window so the toolbar and
    # both panes are in frame.
    window = Image.open(SHOTS / 'dark' / 'workbench.png').convert('RGB')
    card = window.crop((0, 0, window.width, round(window.width / 1.905)))
    card.resize((1200, 630), Image.LANCZOS).save(OUT / 'social.jpg', 'JPEG', quality=88, optimize=True)
    print(f'social.jpg               1200x630  {(OUT / "social.jpg").stat().st_size // 1024} kB')

    shutil.copyfile(ROOT / 'build' / 'icon-256.png', OUT / 'mark.png')
    print('mark.png                 copied from build/icon-256.png')


if __name__ == '__main__':
    main()
