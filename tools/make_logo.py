"""Build the site's transparent logo mark (img/logo.svg).

The emblem is drawn from tapered Bezier "feathers": every feather is a cubic
centre line sampled into a closed outline whose width shrinks to a point at the
tip. Wings are mirrored around the centre line, and a small phoenix crest sits
between them. No text and no background, so the mark works on dark and light
headers.

Usage:
    python3 tools/make_logo.py            # write img/logo.svg
    python3 tools/make_logo.py --check    # fail if img/logo.svg is out of date
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "img", "logo.svg")

WIDTH, HEIGHT = 640, 320
CENTER = WIDTH / 2
GREEN = "#14663a"
RED = "#b3181f"
LIGHT = "#5aa832"

# (base_x, base_y), cubic controls, tip, starting width, colour
FEATHERS = [
    ((326, 152), (420, 194), (548, 146), (632, 86), 27, GREEN),
    ((328, 174), (430, 210), (524, 196), (602, 136), 21, RED),
    ((330, 194), (416, 222), (506, 224), (580, 194), 18, LIGHT),
    ((334, 210), (402, 246), (458, 260), (516, 244), 14, RED),
]

STEPS = 26


def bezier(p0, p1, p2, p3, t):
    mt = 1 - t
    x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
    y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
    return x, y


def feather_path(base, c1, c2, tip, width):
    """Closed outline of one feather: thick at the base, pointed at the tip."""
    left, right = [], []
    for i in range(STEPS + 1):
        t = i / STEPS
        px, py = bezier(base, c1, c2, tip, t)
        nx, ny = bezier(base, c1, c2, tip, min(1, t + 0.02))
        tx, ty = nx - px, ny - py
        length = (tx * tx + ty * ty) ** 0.5 or 1
        # inward normal (curve bends toward the wing root on one side only)
        ox, oy = -ty / length, tx / length
        half = width * (1 - t) ** 0.75 / 2
        left.append((px + ox * half, py + oy * half))
        right.append((px - ox * half, py - oy * half))
    pts = left + right[::-1]
    head = "M%.1f %.1f" % pts[0]
    body = " L".join("%.1f %.1f" % p for p in pts[1:])
    return head + " L" + body + " Z"


def wing_group():
    shapes = []
    for base, c1, c2, tip, width, colour in FEATHERS:
        shapes.append(
            '      <path fill="%s" d="%s"/>'
            % (colour, feather_path(base, c1, c2, tip, width))
        )
    return '  <g id="vk-wing">\n' + "\n".join(shapes) + "\n  </g>"


SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="VK Tech Learn logo">
  <title>VK Tech Learn</title>
  <defs>
{wing_group()}
  </defs>

  <!-- mirrored wings -->
  <use href="#vk-wing"/>
  <use href="#vk-wing" transform="translate({WIDTH} 0) scale(-1 1)"/>

  <!-- phoenix crest -->
  <path fill="{RED}" d="M320 70 C308 96 302 118 312 142 C316 130 318 116 316 102 C324 116 329 128 327 144 C338 124 336 92 320 70 Z"/>
  <path fill="{RED}" d="M308 104 C301 118 300 131 306 143 C309 132 310 118 308 104 Z"/>
  <path fill="{RED}" d="M332 104 C339 118 340 131 334 143 C331 132 330 118 332 104 Z"/>
  <path fill="{LIGHT}" d="M320 104 C315 116 314 128 318 138 C320 128 321 116 320 104 Z"/>
  <!-- body between the wings -->
  <path fill="{GREEN}" d="M320 140 C334 160 342 182 339 197 C336 211 329 218 320 220 C311 218 304 211 301 197 C298 182 306 160 320 140 Z"/>
  <!-- curling shoulders, mirrored -->
  <path fill="{GREEN}" d="M320 216 C306 217 297 208 299 197 C301 189 309 186 316 190 C310 192 308 197 310 201 C312 206 316 210 322 210 Z"/>
  <path fill="{GREEN}" d="M320 216 C334 217 343 208 341 197 C339 189 331 186 324 190 C330 192 332 197 330 201 C328 206 324 210 318 210 Z"/>
</svg>
"""


def main():
    if "--check" in sys.argv:
        current = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if current != SVG:
            raise SystemExit("img/logo.svg is out of date; run python3 tools/make_logo.py")
        print("logo up to date")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        handle.write(SVG)
    print("written:", os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
