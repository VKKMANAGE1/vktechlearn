#!/usr/bin/env python3
"""Add the SEO head block (Open Graph, Twitter card, JSON-LD, robots, keywords)
and a related hero photo to every generated post page under posts/.

Idempotent: re-running only refreshes the marked SEO block, and a hero figure is
inserted at most once. The same markup is produced by tools/build_posts.py, so
the 3-hourly Blogger sync keeps these tags.

    python3 tools/apply_post_seo.py            # patch every page
    python3 tools/apply_post_seo.py --check    # report only, change nothing
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import post_seo  # noqa: E402


def update_index_images(check_only=False):
    """Point empty/placeholder homepage cards at the new local hero photos."""
    path = os.path.join(ROOT, "index.html")
    with open(path, encoding="utf-8") as handle:
        page = handle.read()
    match = re.search(r"const POSTS = (\[.*?\]);", page, flags=re.S)
    if not match:
        print("index.html: POSTS array not found")
        return 0
    posts = json.loads(match.group(1))
    fixed = 0
    for post in posts:
        image = (post.get("image") or "").strip()
        slug = (post.get("url") or "").rsplit("/", 1)[-1].replace(".html", "")
        local = os.path.join(ROOT, "img", "posts", f"{slug}.jpg")
        broken = (not image) or post_seo.PLACEHOLDER_RE.search(image) or image == "IMAGE_URL_HERE"
        if broken and os.path.exists(local):
            post["image"] = f"img/posts/{slug}.jpg"
            fixed += 1
    if fixed and not check_only:
        rebuilt = "const POSTS = " + json.dumps(posts, ensure_ascii=False) + ";"
        page = page[:match.start()] + rebuilt + page[match.end():]
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(page)
    print(f"homepage cards with a new photo: {fixed}" + (" (check only)" if check_only else ""))
    return fixed


def main():
    check_only = "--check" in sys.argv[1:]
    update_index_images(check_only)
    pages = sorted(glob.glob(os.path.join(ROOT, "posts", "*.html")))
    changed = heroes = 0
    for path in pages:
        with open(path, encoding="utf-8") as handle:
            page = handle.read()
        new_page, did_change = post_seo.apply_to_page(page)
        if did_change:
            if '<figure class="post-hero">' in new_page and '<figure class="post-hero">' not in page:
                heroes += 1
            if not check_only:
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(new_page)
            changed += 1
    print(f"pages: {len(pages)} | updated: {changed} | heroes added: {heroes}"
          + (" (check only, nothing written)" if check_only else ""))


if __name__ == "__main__":
    main()
