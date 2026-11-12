#!/usr/bin/env python3
"""Build static post pages for vktechlearn from the public Blogger JSON feed.

Usage:
    python3 tools/build_posts.py [feed.json] [--out posts]

It writes one HTML file per Blogger post into posts/ plus the shared post.css,
and prints a JSON map of original post URL -> local page (also saved to
/tmp/vk-slugmap.json) so the homepage cards can be pointed at local pages.
"""
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime

FEED_URL = os.environ.get("FEED_URL", "https://www.vktechlearn.site/feeds/posts/default?alt=json&max-results=500")
SITE_URL = os.environ.get("SITE_URL", "https://vktechlearn.online").rstrip("/")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "posts")
CSS_PATH = os.path.join(ROOT, "post.css")

POST_CSS = """/* VK Tech Learn - single post page */
:root {
  --bg: #05070d;
  --panel: #0b1020;
  --panel-2: #0e1526;
  --line: rgba(0, 229, 255, .22);
  --cyan: #00e5ff;
  --pink: #ff2d95;
  --text: #dbe6f5;
  --muted: #8ea0b8;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background:
    radial-gradient(900px 500px at 15% -10%, rgba(0, 229, 255, .14), transparent 60%),
    radial-gradient(700px 420px at 90% 0%, rgba(255, 45, 149, .12), transparent 60%),
    var(--bg);
  color: var(--text);
  font-family: "Rajdhani", "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 17px;
  line-height: 1.75;
  min-height: 100vh;
}
a { color: var(--cyan); }
a:hover { color: #7cf3ff; }
.wrap { width: min(860px, 100% - 2rem); margin: 0 auto; }
header.post-head {
  position: sticky; top: 0; z-index: 5;
  backdrop-filter: blur(14px);
  background: rgba(5, 7, 13, .82);
  border-bottom: 1px solid var(--line);
}
.post-head .wrap {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; padding: .8rem 0;
}
.brand {
  font-family: "Orbitron", "Rajdhani", sans-serif;
  font-weight: 700; letter-spacing: .12em; text-decoration: none;
  font-size: .95rem; color: #fff;
  text-shadow: 0 0 14px rgba(0, 229, 255, .55);
}
.brand span { color: var(--cyan); }
.back {
  font-size: .82rem; text-decoration: none; color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px; padding: .3rem .8rem;
  white-space: nowrap;
}
.back:hover { color: var(--cyan); border-color: var(--cyan); }
main.post { padding: 2.2rem 0 3rem; }
.meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: .7rem;
  font-size: .78rem; letter-spacing: .14em; text-transform: uppercase;
  color: var(--muted); margin-bottom: .9rem;
}
.tag {
  color: var(--pink); border: 1px solid rgba(255, 45, 149, .4);
  border-radius: 6px; padding: .12rem .5rem;
}
h1.post-title {
  font-family: "Orbitron", "Noto Sans Devanagari", sans-serif;
  font-size: clamp(1.5rem, 4vw, 2.3rem);
  line-height: 1.3; margin: 0 0 1.1rem; color: #f4f8ff;
}
.hero-img {
  width: 100%; border-radius: 14px; margin: 0 0 1.6rem;
  border: 1px solid var(--line); display: block;
}
.post-body {
  background: linear-gradient(180deg, rgba(11, 16, 32, .92), rgba(8, 12, 24, .92));
  border: 1px solid var(--line); border-radius: 16px;
  padding: clamp(1.1rem, 3vw, 2rem);
  box-shadow: 0 0 40px rgba(0, 229, 255, .07);
  overflow-wrap: anywhere;
}
.post-body h1, .post-body h2, .post-body h3, .post-body h4 {
  font-family: "Orbitron", "Noto Sans Devanagari", sans-serif;
  color: #eaf7ff; line-height: 1.35; margin: 1.7rem 0 .6rem;
}
.post-body h1 { font-size: 1.32rem; }
.post-body h2 { font-size: 1.28rem; }
.post-body h3 { font-size: 1.1rem; }
.post-body p { margin: .85rem 0; }
.post-body ul, .post-body ol { padding-left: 1.4rem; margin: .9rem 0; }
.post-body li { margin: .35rem 0; }
.post-body img { max-width: 100%; height: auto; border-radius: 10px; display: block; margin: 1rem auto; }
.post-body a { text-decoration: underline; text-underline-offset: 2px; }
.post-body blockquote {
  margin: 1.2rem 0; padding: .6rem 1rem; border-left: 3px solid var(--cyan);
  background: rgba(0, 229, 255, .06); color: #cfe6f5; border-radius: 0 10px 10px 0;
}
.post-body code {
  background: rgba(0, 229, 255, .1); padding: .1rem .35rem; border-radius: 5px;
  font-size: .92em;
}
.post-body pre {
  background: #050a14; border: 1px solid var(--line); border-radius: 10px;
  padding: 1rem; overflow-x: auto;
}
.post-body table { width: 100%; display: block; overflow-x: auto; border-collapse: collapse; margin: 1rem 0; }
.post-body th, .post-body td { border: 1px solid var(--line); padding: .5rem .7rem; text-align: left; }
.post-body iframe { width: 100%; aspect-ratio: 16 / 9; height: auto; border: 0; border-radius: 12px; margin: 1rem 0; }
.post-foot { margin-top: 1.6rem; display: flex; flex-wrap: wrap; gap: .8rem; }
.post-foot a {
  text-decoration: none; border: 1px solid var(--line); border-radius: 999px;
  padding: .5rem 1rem; font-size: .85rem; color: var(--text);
}
.post-foot a:hover { border-color: var(--cyan); color: var(--cyan); }
footer.site-foot {
  border-top: 1px solid var(--line); padding: 1.4rem 0 2.2rem;
  font-size: .8rem; color: var(--muted); text-align: center;
}
@media (max-width: 520px) {
  body { font-size: 16px; }
  .post-head .wrap { padding: .65rem 0; }
}
"""

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — VK Tech Learn</title>
<meta name="description" content="{description}">
<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{canonical}">
<link rel="canonical" href="{canonical}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230b0f1a'/%3E%3Ctext x='32' y='44' font-family='Arial,sans-serif' font-size='27' font-weight='bold' fill='%2300e5ff' text-anchor='middle'%3EVK%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700&family=Rajdhani:wght@500;600;700&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../post.css">
</head>
<body>
<header class="post-head">
  <div class="wrap">
    <a class="brand" href="../index.html">VK <span>TECH</span> LEARN</a>
    <a class="back" href="../index.html#latest">&larr; All posts</a>
  </div>
</header>
<main class="post">
  <div class="wrap">
    <div class="meta">
      {label_html}
      <time datetime="{iso}">{date}</time>
    </div>
    <h1 class="post-title">{title}</h1>
    {hero_html}
    <article class="post-body">
{body}
    </article>
    <div class="post-foot">
      <a href="../index.html#latest">&larr; Back to all posts</a>
      <a href="{original}" target="_blank" rel="noopener noreferrer">Original on Blogger</a>
    </div>
  </div>
</main>
<footer class="site-foot">
  <div class="wrap">&copy; {year} VK Tech Learn &middot; All rights reserved &middot; <a href="../index.html">vktechlearn</a></div>
</footer>
</body>
</html>
"""


def fetch_feed(path):
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    with urllib.request.urlopen(FEED_URL, timeout=60) as response:
        return json.load(response)


def clean_content(raw, url_to_slug):
    body = raw or ""
    body = re.sub(r"<!doctype[^>]*>", "", body, flags=re.I)
    head_match = re.search(r"<head\b[^>]*>(.*?)</head\b>", body, flags=re.S | re.I)
    if head_match:
        body = body[head_match.end():]
    body_match = re.search(r"<body\b[^>]*>(.*?)</body\b>", body, flags=re.S | re.I)
    if body_match:
        body = body_match.group(1)
    body = re.sub(r"</?(?:html|body|head)\b[^>]*>", "", body, flags=re.I)
    body = re.sub(r"<meta\b[^>]*>", "", body, flags=re.I)
    body = re.sub(r"<link\b[^>]*>", "", body, flags=re.I)
    body = re.sub(r"<title\b[^>]*>.*?</title>", "", body, flags=re.S | re.I)
    body = re.sub(r"<script\b[^>]*>.*?</script>", "", body, flags=re.S | re.I)
    body = re.sub(r"<style\b[^>]*>.*?</style>", "", body, flags=re.S | re.I)
    body = re.sub(r"\s+on[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*')", "", body, flags=re.I)
    body = re.sub(r"\sstyle\s*=\s*(\"[^\"]*\"|'[^']*')", "", body, flags=re.I)
    body = re.sub(r"\sdata-[a-z0-9-]+\s*=\s*(\"[^\"]*\"|'[^']*')", "", body, flags=re.I)
    body = re.sub(r"\s(?:width|height)\s*=\s*\"\d+\"", "", body, flags=re.I)

    def normalize(value):
        return re.sub(r"^https?://(?:www\.)?", "", value.split("?")[0].split("#")[0], flags=re.I)

    normalized_map = {normalize(key): value for key, value in url_to_slug.items()}

    def local_link(match):
        target = match.group(1)
        return normalized_map.get(normalize(target), target)

    for pattern in (
        r"href=\"(https?://(?:www\.)?vktechlearn\.site/\d{4}/\d{2}/[^\"]+\.html)\"",
        r"href=\"(https?://(?:www\.)?vktechlearn\.site/\d{4}/\d{2}/[^\"]+\.html)\?[^\"]*\"",
    ):
        body = re.sub(pattern, lambda m: 'href="' + local_link(m) + '"', body)
    body = re.sub(r"<p>(?:&nbsp;|\s)*</p>\s*", "", body, count=1, flags=re.I)
    return body.strip()


def summary_for(post, body):
    text = re.sub(r"<[^>]+>", " ", body)
    text = re.sub(r"\s+", " ", html.unescape(text)).strip()
    if len(text) > 150:
        text = text[:150].rstrip() + "\u2026"
    image = post["image"] or ""
    if image.startswith("http://"):
        image = "https://" + image[len("http://"):]
    return {
        "title": post["title"],
        "url": f"posts/{post['slug']}.html",
        "date": post["published"][:10],
        "labels": post["labels"],
        "image": image,
        "excerpt": text,
    }


def update_index(posts):
    index_path = os.path.join(ROOT, "index.html")
    page = open(index_path, encoding="utf-8").read()
    start = page.index("const POSTS = [")
    end = page.index(";\n    const ALL_TOOLS =", start)
    block = "const POSTS = " + json.dumps(posts, ensure_ascii=False, separators=(",", ":"))
    page = page[:start] + block + page[end:]
    with open(index_path, "w", encoding="utf-8") as handle:
        handle.write(page)
    return len(posts)


def main():
    feed_path = None
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:
        feed_path = args[0]
    feed = fetch_feed(feed_path)
    entries = feed["feed"].get("entry", [])
    if not entries:
        raise SystemExit("No entries in feed")

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(CSS_PATH, "w", encoding="utf-8") as handle:
        handle.write(POST_CSS)

    prepared = []
    used = {}
    for entry in entries:
        link = next((l["href"] for l in entry.get("link", []) if l.get("rel") == "alternate"), "")
        raw_slug = link.rstrip("/").split("/")[-1].replace(".html", "") or "post"
        raw_slug = re.sub(r"[^a-z0-9-]+", "-", raw_slug.lower()).strip("-") or "post"
        count = used.get(raw_slug, 0) + 1
        used[raw_slug] = count
        slug = raw_slug if count == 1 else f"{raw_slug}-{count}"
        labels = [c["term"] for c in entry.get("category", []) if c.get("term")]
        content = entry.get("content", {}).get("$t", "")
        image_match = re.search(r'<img[^>]+src="([^"]+)"', content)
        prepared.append({
            "slug": slug,
            "url": link,
            "title": html.unescape(entry.get("title", {}).get("$t", "")).strip(),
            "published": entry.get("published", {}).get("$t", ""),
            "labels": labels,
            "content": content,
            "image": image_match.group(1) if image_match else "",
        })

    url_to_slug = {p["url"]: f"posts/{p['slug']}.html" for p in prepared}

    for post in prepared:
        try:
            dt = datetime.fromisoformat(post["published"].replace("Z", "+00:00"))
        except ValueError:
            dt = datetime.now()
        date_text = f"{dt.day} {dt.strftime('%B %Y')}"
        body = clean_content(post["content"], url_to_slug)
        first_h1 = re.search(r"<h1\b[^>]*>(.*?)</h1\b>", body, flags=re.S | re.I)
        if first_h1 and first_h1.start() < 1200:
            heading_text = re.sub(r"<[^>]+>", "", first_h1.group(1))
            heading_text = re.sub(r"\s+", " ", html.unescape(heading_text)).strip().lower()
            title_text = re.sub(r"\s+", " ", post["title"]).strip().lower()
            if heading_text and (heading_text in title_text or title_text in heading_text):
                body = body[:first_h1.start()] + body[first_h1.end():]
        label_html = "".join(
            f'<span class="tag">{html.escape(label)}</span>' for label in post["labels"][:2]
        )
        excerpt = re.sub(r"<[^>]+>", " ", body)
        excerpt = re.sub(r"\s+", " ", html.unescape(excerpt)).strip()[:160]
        page = PAGE.format(
            title=html.escape(post["title"]),
            description=html.escape(excerpt or post["title"]),
            url=html.escape(post["url"]),
            canonical=html.escape(f"{SITE_URL}/posts/{post['slug']}.html"),
            year=dt.year,
            original=html.escape(post["url"]),
            label_html=label_html,
            iso=dt.isoformat(),
            date=date_text,
            hero_html="",
            body="\n".join(("      " + line) if line.strip() else "" for line in body.splitlines()),
        )
        with open(os.path.join(OUT_DIR, f"{post['slug']}.html"), "w", encoding="utf-8") as handle:
            handle.write(page)

    with open("/tmp/vk-slugmap.json", "w", encoding="utf-8") as handle:
        json.dump(url_to_slug, handle, ensure_ascii=False, indent=1)

    if "--update-index" in sys.argv[1:]:
        cards = []
        for post in prepared:
            body = clean_content(post["content"], url_to_slug)
            cards.append(summary_for(post, body))
        update_index(cards)
        print("homepage POSTS refreshed:", len(cards))

    total = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR))
    print(f"posts written: {len(prepared)} | html bytes: {total} | css: {os.path.getsize(CSS_PATH)}")
    print("slug map: /tmp/vk-slugmap.json")


if __name__ == "__main__":
    main()
