#!/usr/bin/env python3
"""Builds the M09 vision fixture: a PNG whose text can only be read by looking at it.

    python3 tools/make-m09-fixtures.py TOKEN-VISION-1234 artifacts/m09-fixtures/vision-note.png

The token, amount and district are drawn with the repo's Noto Sans Devanagari font, so
the file carries real pixels (not an SVG the renderer may drop for lack of fonts).
"""
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = "artifacts/fonts/NotoSansDevanagari.ttf"


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    token, out = sys.argv[1], sys.argv[2]
    rows = [
        (token, 46, (103, 232, 249)),
        ("Invoice total: 445000 rupees", 34, (226, 232, 240)),
        ("District: Gorakhpur", 34, (226, 232, 240)),
        ("SHAVI AI vision check", 30, (148, 163, 184)),
    ]
    image = Image.new("RGB", (900, 420), (15, 23, 42))
    draw = ImageDraw.Draw(image)
    y = 55
    for text, size, colour in rows:
        draw.text((40, y), text, font=ImageFont.truetype(FONT, size), fill=colour)
        y += size + 45
    image.save(out, "PNG")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
