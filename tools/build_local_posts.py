#!/usr/bin/env python3
"""Render repo-owned posts (tools/local_posts/*.json + matching .html) into posts/.

Blogger stays the source of truth for synced posts. A post kept here is written
straight from the repo, which is handy when it should go live without waiting
for the Blogger feed. The Blogger sync never deletes files in posts/, so these
pages survive the 3-hourly rebuild; their homepage card lives in EXTRA_POSTS in
index.html, which tools/build_posts.py --update-index does not touch.

Usage:
    python3 tools/build_local_posts.py            # render every local post
    python3 tools/build_local_posts.py --check     # fail if posts/ is out of date
"""
import html
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_posts as bp  # noqa: E402  (shared PAGE template + clean_content)
import post_seo  # noqa: E402

ROOT = bp.ROOT
SRC = os.path.join(ROOT, "tools", "local_posts")
OUT = os.path.join(ROOT, "posts")


def load_posts():
    posts = []
    if not os.path.isdir(SRC):
        return posts
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(SRC, name), encoding="utf-8") as handle:
            meta = json.load(handle)
        body_path = os.path.join(SRC, meta["slug"] + ".html")
        with open(body_path, encoding="utf-8") as handle:
            meta["content"] = handle.read()
        posts.append(meta)
    return posts


def hero_figure(meta, title):
    path = meta.get("hero", "")
    if not path or not os.path.exists(os.path.join(ROOT, path)):
        return ""
    alt = post_seo.clean_text(title, 110)
    caption = meta.get("hero_caption", "")
    cap = f"\n      <figcaption>{html.escape(caption)}</figcaption>" if caption else ""
    return (
        '    <figure class="post-hero">\n'
        f'      <img src="../{path}" alt="{html.escape(alt)}" '
        f'width="{meta.get("hero_width", 1280)}" height="{meta.get("hero_height", 720)}" '
        f'loading="eager" decoding="async" fetchpriority="high">{cap}\n'
        "    </figure>"
    )


def render(meta):
    dt = datetime.fromisoformat(meta["published"])
    title = meta["title"]
    slug = meta["slug"]
    body = bp.clean_content(meta["content"], {}, title)
    description = meta.get("description") or post_seo.meta_description(body)
    canonical = f"{bp.SITE_URL}/posts/{slug}.html"
    labels = meta.get("labels", [])
    hero = hero_figure(meta, title)
    image = post_seo.absolute(meta.get("hero", "")) or post_seo.first_usable_image(body)
    label_html = "".join(f'<span class="tag">{html.escape(l)}</span>' for l in labels[:2])
    seo_html = post_seo.seo_block(
        title=title,
        description=description,
        canonical=canonical,
        published=dt.isoformat(),
        modified=dt.isoformat(),
        labels=labels,
        image=image,
        image_alt=title,
    )
    return bp.PAGE.format(
        title=html.escape(title),
        description=html.escape(description),
        url=html.escape(canonical),
        canonical=html.escape(canonical),
        author=bp.AUTHOR,
        year=dt.year,
        original=html.escape(canonical),
        label_html=label_html,
        iso=dt.isoformat(),
        date=f"{dt.day} {dt.strftime('%B %Y')}",
        hero_html=hero,
        seo_html=seo_html,
        body="\n".join(("      " + line) if line.strip() else "" for line in body.splitlines()),
    )


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    for meta in load_posts():
        page = render(meta)
        path = os.path.join(OUT, f"{meta['slug']}.html")
        current = ""
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                current = handle.read()
        if current == page:
            print(f"up to date: {meta['slug']}")
            continue
        stale.append(meta["slug"])
        if not check:
            os.makedirs(OUT, exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(page)
            print(f"written: posts/{meta['slug']}.html")
    if check and stale:
        raise SystemExit("out of date: " + ", ".join(stale))
    if not stale:
        print("nothing to write")


if __name__ == "__main__":
    main()
