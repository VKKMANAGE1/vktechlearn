#!/usr/bin/env python3
"""Render brand cover images for posts whose photos were hotlinked from other sites.

Each cover is 1392x752 JPG in the site's navy/cyan style with the post title.
Titles mix Devanagari and Latin, so text is drawn as script runs: Devanagari
runs use Noto Sans Devanagari, Latin/digits use DejaVu Sans (both ship in
tools/fonts or matplotlib). Shaping happens through PIL's Raqm build.

    python3 tools/gen_post_cover.py            # every spec in tools/cover_specs.json
    python3 tools/gen_post_cover.py blog-post  # only matching slugs
"""
import html
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "img", "posts")
SPECS = os.path.join(ROOT, "tools", "cover_specs.json")


def _dejavu_dir():
    local = os.path.join(ROOT, "tools", "fonts")
    if os.path.exists(os.path.join(local, "DejaVuSans-Bold.ttf")):
        return local
    try:
        import matplotlib
        cand = os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")
        if os.path.exists(os.path.join(cand, "DejaVuSans-Bold.ttf")):
            return cand
    except Exception:
        pass
    return "/opt/freestyle/python/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf"


DEJAVU = _dejavu_dir()
DEVANAGARI = os.path.join(ROOT, "tools", "fonts")
S = 2
W, H = 1392, 752

BG = (7, 12, 22)
CYAN = (0, 229, 255)
VIOLET = (160, 107, 255)
TEXT = (226, 236, 250)
MUTED = (127, 151, 181)

_cache = {}


def font(kind, size):
    key = (kind, size)
    if key in _cache:
        return _cache[key]
    if kind == "dev":
        path = os.path.join(DEVANAGARI, "NotoSansDevanagari-Bold.ttf")
    else:
        path = os.path.join(DEJAVU, "DejaVuSans-Bold.ttf")
    _cache[key] = ImageFont.truetype(path, size * S)
    return _cache[key]


LATIN = re.compile(r"[A-Za-z0-9\u0020-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]+")


def runs(text):
    """Split into (kind, chunk) where kind is 'lat' or 'dev'."""
    out, pos = [], 0
    for match in LATIN.finditer(text):
        if match.start() > pos:
            out.append(("dev", text[pos:match.start()]))
        out.append(("lat", match.group(0)))
        pos = match.end()
    if pos < len(text):
        out.append(("dev", text[pos:]))
    return out


def width(draw, text, size):
    total = 0
    for kind, chunk in runs(text):
        total += draw.textlength(chunk, font=font(kind, size))
    return total


def draw_text(draw, x, y, text, size, fill):
    for kind, chunk in runs(text):
        draw.text((x, y), chunk, font=font(kind, size), fill=fill)
        x += draw.textlength(chunk, font=font(kind, size))


def wrap(draw, text, size, max_w):
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if width(draw, trial, size) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def tracked(draw, xy, text, f, fill, tracking=3 * S):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking


def canvas():
    img = Image.new("RGB", (W * S, H * S), BG)
    d = ImageDraw.Draw(img, "RGBA")
    step = 56 * S
    for x in range(-H * S, W * S, step):
        d.line([(x, 0), (x + H * S, H * S)], fill=(255, 255, 255, 8), width=1)
    for y in range(0, H * S, step):
        d.line([(0, y), (W * S, y)], fill=(255, 255, 255, 6), width=1)
    glow = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * S * 0.5, H * S * 0.4, W * S * 1.1, H * S * 1.2], fill=(0, 170, 210, 52))
    gd.ellipse([-W * S * 0.35, -H * S * 0.3, W * S * 0.35, H * S * 0.5], fill=(150, 100, 255, 38))
    glow = glow.filter(ImageFilter.GaussianBlur(150 * S // 2))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    return img, ImageDraw.Draw(img, "RGBA")


def render(spec):
    img, d = canvas()
    label = html.unescape(spec.get("label") or "Tech").strip().upper()
    title = html.unescape(spec.get("title") or spec["slug"]).replace("&amp;", "&")
    title = re.sub(r"\s+", " ", title).strip()

    tracked(d, (72 * S, 64 * S), "VK TECH LEARN", font("lat", 17), CYAN, tracking=4 * S)

    chip_f = font("lat", 15)
    chip_w = d.textlength(label, font=chip_f) + 26 * S
    d.rounded_rectangle([W * S - 72 * S - chip_w, 58 * S, W * S - 72 * S, 100 * S],
                        radius=21 * S, outline=(0, 229, 255, 170), width=2 * S, fill=(0, 60, 80, 90))
    d.text((W * S - 72 * S - chip_w + 13 * S, 68 * S), label, font=chip_f, fill=TEXT)

    d.rounded_rectangle([72 * S, 126 * S, 196 * S, 134 * S], radius=4 * S, fill=VIOLET + (220,))

    size, lines = 62, []
    while size > 34:
        lines = wrap(d, title, size, (W - 200) * S)
        if len(lines) <= 3:
            break
        size -= 4
    lines = lines[:3]

    top = 200 * S if len(lines) == 3 else 230 * S
    line_h = int(size * 1.34) * S
    for i, line in enumerate(lines):
        draw_text(d, 72 * S, top + i * line_h, line, size, TEXT)

    base = top + len(lines) * line_h + 26 * S
    d.rounded_rectangle([72 * S, base, 240 * S, base + 5 * S], radius=3 * S, fill=CYAN + (200,))

    tracked(d, (72 * S, (H - 78) * S), "VKTECHLEARN.SITE", font("lat", 15), MUTED, tracking=3 * S)
    return img.convert("RGB").resize((W, H), Image.LANCZOS)


def main():
    only = sys.argv[1:]
    with open(SPECS, encoding="utf-8") as handle:
        specs = json.load(handle)
    for spec in specs:
        if only and not any(o in spec["slug"] for o in only):
            continue
        path = os.path.join(OUT, spec["slug"] + "-cover.jpg")
        render(spec).save(path, "JPEG", quality=84, optimize=True, progressive=True)
        print(f"written: img/posts/{spec['slug']}-cover.jpg ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    main()
