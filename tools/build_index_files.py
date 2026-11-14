"""Build sitemap.xml, feed.xml and robots.txt for the static site.

The Blogger feed the site used to link to is not public any more, so the site
serves its own RSS feed plus a sitemap. Run this after the post pages change:

    python3 tools/build_index_files.py

The sync workflow runs it right after tools/build_posts.py --update-index.
"""

import os
import re
import html
import email.utils
from datetime import datetime, timezone
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://vktechlearn.site"
POSTS = os.path.join(ROOT, "posts")

STATIC_PAGES = [
    ("/", 1.0, "weekly"),
    ("/pdf/", 0.9, "monthly"),
    ("/img/", 0.9, "monthly"),
    ("/shavi-ai/", 0.8, "monthly"),
    ("/about.html", 0.6, "yearly"),
    ("/profile.html", 0.6, "yearly"),
    ("/contact.html", 0.6, "yearly"),
    ("/privacy-policy.html", 0.3, "yearly"),
    ("/terms-conditions.html", 0.3, "yearly"),
    ("/dmca-disclaimer.html", 0.3, "yearly"),
]


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def first(pattern, text, default=""):
    match = re.search(pattern, text, re.S)
    return html.unescape(match.group(1)).strip() if match else default


def collect_posts():
    posts = []
    for name in sorted(os.listdir(POSTS)):
        if not name.endswith(".html"):
            continue
        path = os.path.join(POSTS, name)
        page = read(path)
        title = first(r"<title>(.*?)</title>", page).replace(" — VK Tech Learn", "")
        description = first(r'<meta name="description" content="(.*?)"', page)
        stamp = first(r'<time datetime="([^"]+)"', page)
        try:
            when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        except ValueError:
            when = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
        posts.append(
            {
                "slug": name,
                "url": f"{SITE}/posts/{name}",
                "title": title or name[:-5].replace("-", " ").title(),
                "description": description,
                "when": when if when.tzinfo else when.replace(tzinfo=timezone.utc),
            }
        )
    posts.sort(key=lambda item: item["when"], reverse=True)
    return posts


def write_sitemap(posts):
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for path, priority, freq in STATIC_PAGES:
        lines.append(
            "  <url><loc>{}</loc><changefreq>{}</changefreq><priority>{}</priority></url>".format(
                escape(SITE + path), freq, priority
            )
        )
    for post in posts:
        lines.append(
            "  <url><loc>{}</loc><lastmod>{}</lastmod><changefreq>monthly</changefreq>"
            "<priority>0.7</priority></url>".format(escape(post["url"]), post["when"].date().isoformat())
        )
    lines.append("</urlset>")
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def write_feed(posts):
    now = datetime.now(timezone.utc)
    items = []
    for post in posts[:25]:
        items.append(
            "    <item>\n"
            f"      <title>{escape(post['title'])}</title>\n"
            f"      <link>{escape(post['url'])}</link>\n"
            f"      <guid isPermaLink=\"true\">{escape(post['url'])}</guid>\n"
            f"      <pubDate>{email.utils.format_datetime(post['when'])}</pubDate>\n"
            f"      <description>{escape(post['description'])}</description>\n"
            "    </item>"
        )
    feed = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "  <channel>\n"
        "    <title>VK Tech Learn</title>\n"
        f"    <link>{SITE}/</link>\n"
        "    <description>Tech News, Computer सीखें और Free Tools — आसान हिंदी में।</description>\n"
        "    <language>hi</language>\n"
        f"    <lastBuildDate>{email.utils.format_datetime(now)}</lastBuildDate>\n"
        f'    <atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml"/>\n'
        + "\n".join(items)
        + "\n  </channel>\n</rss>\n"
    )
    with open(os.path.join(ROOT, "feed.xml"), "w", encoding="utf-8") as handle:
        handle.write(feed)


def write_robots():
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "\n"
        f"Sitemap: {SITE}/sitemap.xml\n"
    )
    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8") as handle:
        handle.write(body)


def main():
    posts = collect_posts()
    write_sitemap(posts)
    write_feed(posts)
    write_robots()
    print(f"sitemap.xml, feed.xml and robots.txt written ({len(posts)} posts)")


if __name__ == "__main__":
    main()
