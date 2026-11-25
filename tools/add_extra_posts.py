#!/usr/bin/env python3
"""Add repo-owned posts to the homepage EXTRA_POSTS array in index.html.

Existing entries are kept exactly as they are (custom excerpts included); only
slugs that are missing get inserted, newest first.

    python3 tools/add_extra_posts.py                # add every local post
    python3 tools/add_extra_posts.py slug-a slug-b  # add only these
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def entry(meta):
    published = meta["published"][:10]
    labels = meta.get("labels") or []
    return {
        "title": meta["title"],
        "url": f"posts/{meta['slug']}.html",
        "date": published,
        "labels": labels[:1],
        "image": meta.get("hero", ""),
        "excerpt": meta.get("description", ""),
    }


def main():
    path = os.path.join(ROOT, "index.html")
    with open(path, encoding="utf-8") as handle:
        page = handle.read()
    match = re.search(r"const EXTRA_POSTS = (\[.*?\]);\n", page, re.S)
    if not match:
        raise SystemExit("EXTRA_POSTS array not found")
    posts = json.loads(match.group(1))
    have = {p["url"] for p in posts}

    wanted = set(sys.argv[1:])
    new = []
    for name in sorted(glob.glob(os.path.join(ROOT, "tools", "local_posts", "*.json"))):
        with open(name, encoding="utf-8") as handle:
            meta = json.load(handle)
        if wanted and meta["slug"] not in wanted:
            continue
        if f"posts/{meta['slug']}.html" in have:
            continue
        new.append(entry(meta))

    if not new:
        print("nothing to add")
        return
    new.sort(key=lambda item: item["date"], reverse=True)
    merged = new + posts
    blob = json.dumps(merged, ensure_ascii=False, separators=(", ", ": "))
    page = page[: match.start(1)] + blob + page[match.end(1):]
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(page)
    print(f"added {len(new)}: " + ", ".join(p["url"] for p in new))


if __name__ == "__main__":
    main()
