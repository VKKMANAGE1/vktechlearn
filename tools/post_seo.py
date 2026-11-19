#!/usr/bin/env python3
"""Shared SEO head block, JSON-LD and hero-image helpers for post pages.

Used by two callers so the markup never drifts:

  * tools/build_posts.py   - when regenerating posts/ from the Blogger feed
  * tools/apply_post_seo.py - one-off/idempotent pass over already generated files

Everything here is plain string work: no feed access, no network, no secrets.
"""
import html
import json
import os
import re

SITE_URL = os.environ.get("SITE_URL", "https://vktechlearn.site").rstrip("/")
SITE_NAME = "VK Tech Learn"
AUTHOR = "V\u00efn\u00e2\u00fd K\u00fashw\u00e2h\u00e5"
PUBLISHER_LOGO = "/img/posts/publisher-logo.png"

# Slugs whose posts have no usable photo of their own (empty body, or only a
# broken/placeholder image from the old Blogger drafts). The generator and the
# patcher both inject these as a hero figure above the article.
HEROES = {
    "ai-kya-hai-aur-manav-buddhi-se-kaise-bhin-deti-hai": (
        "ai-kya-hai-aur-manav-buddhi-se-kaise-bhin-deti-hai.jpg",
        "AI और मानव बुद्धि — डेटा, पैटर्न और अनुभव का फर्क",
    ),
    "best-screen-recording-software-2025-pc": (
        "best-screen-recording-software-2025-pc.jpg",
        "PC और लैपटॉप के लिए स्क्रीन रिकॉर्डिंग सेटअप",
    ),
    "blog-post": (
        "blog-post.jpg",
        "फाइबर ऑप्टिक और सैटेलाइट — इंटरनेट का महाजाल",
    ),
    "gta-6-pc-requirements-2026-laptop-pc": (
        "gta-6-pc-requirements-2026-laptop-pc.jpg",
        "GTA 6 जैसा भारी गेम चलाने वाला गेमिंग लैपटॉप",
    ),
    "hindi-typing-practice": (
        "hindi-typing-practice.jpg",
        "हिंदी टाइपिंग प्रैक्टिस — कीबोर्ड पर देवनागरी",
    ),
    "tv": (
        "tv.jpg",
        "Windows 11 की आम समस्याएँ और उनका हल",
    ),
    "ms-word-how-to-delete-page-in-word": (
        "ms-word-how-to-delete-page-in-word.jpg",
        "MS Word में अतिरिक्त पेज डिलीट करना",
    ),
    "whatsapp-windows": (
        "whatsapp-windows.jpg",
        "WhatsApp का नया Windows डेस्कटॉप इंटरफेस",
    ),
    "windows-mac": (
        "windows-mac.jpg",
        "Windows और Mac कंप्यूटर को फॉर्मेट करना",
    ),
    # Posts whose only <img> was a placeholder, a dead /mnt/data path or empty src.
    "seo": ("seo.jpg", "SEO की मूल बातें — रैंकिंग और सर्च रिज़ल्ट"),
    "blog-post-5": ("blog-post-5.jpg", "भारत का सेमीकंडक्टर मिशन — चिप और वेफर"),
    "elon-musk-vs-apple-ai": ("elon-musk-vs-apple-ai.jpg", "App Store और AI पर टकराव"),
    "2025-ai-ev": ("2025-ai-ev.jpg", "AI सुपरकंप्यूटर, हाइड्रोजन ड्रोन और EV बैटरी"),
    "gmail": ("gmail.jpg", "Gmail स्टोरेज क्लीनअप"),
    "new-blog-ko-rank-kaise-kare-15": ("new-blog-ko-rank-kaise-kare-15.jpg", "ब्लॉग को Google के पहले पेज पर लाना"),
}

PLACEHOLDER_RE = re.compile(
    r"(?:IMAGE_URL_HERE|/mnt/data/|chat\.openai\.com|placehold\.co|screenshot\d+\.png"
    r"|picsum\.photos|via\.placeholder\.com|^$)",
    re.I,
)

META_START = "<!--seo:start-->"
META_END = "<!--seo:end-->"


def escape(value):
    return html.escape(value or "", quote=True)


def clean_text(value, limit=0):
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = re.sub(r"\s+", " ", html.unescape(text)).strip()
    if limit and len(text) > limit:
        text = text[:limit]
        text = re.sub(r"\s+\S*$", "", text).rstrip(" ,.;:-—") + "…"
    return text


def meta_description(value, limit=158):
    return clean_text(value, limit)


def absolute(path):
    if not path:
        return ""
    if path.startswith("http://"):
        return "https://" + path[len("http://"):]
    if path.startswith("https://"):
        return path
    return SITE_URL + "/" + path.lstrip("/")


def hero_image(slug):
    """Return (site_relative_path, caption) for a slug that needs a hero."""
    entry = HEROES.get(slug)
    if not entry:
        return "", ""
    filename, caption = entry
    if not filename:
        return "", ""
    local = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "img", "posts", filename)
    if not os.path.exists(local):
        return "", ""
    return f"img/posts/{filename}", caption


def hero_html(slug, title, indent="    "):
    path, caption = hero_image(slug)
    if not path:
        return ""
    alt = clean_text(title, 110) or SITE_NAME
    cap = f'\n{indent}  <figcaption>{escape(caption)}</figcaption>' if caption else ""
    return (
        f'{indent}<figure class="post-hero">\n'
        f'{indent}  <img src="../{path}" alt="{escape(alt)}" width="1392" height="752" '
        f'loading="eager" decoding="async" fetchpriority="high">{cap}\n'
        f'{indent}</figure>'
    )


def _ld_json(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def seo_block(title, description, canonical, published="", modified="", labels=None,
              image="", image_alt="", lang="hi"):
    """Return the full SEO head block, wrapped in idempotent markers."""
    labels = [l for l in (labels or []) if l]
    description = meta_description(description or title)
    image = absolute(image)
    image_alt = clean_text(image_alt or title, 120)

    lines = [META_START]
    lines.append('<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">')
    lines.append('<meta name="theme-color" content="#05070d">')
    if labels:
        lines.append(f'<meta name="keywords" content="{escape(", ".join(labels[:8]))}">')
    lines.append(f'<meta property="og:site_name" content="{escape(SITE_NAME)}">')
    lines.append(f'<meta property="og:locale" content="{"hi_IN" if lang == "hi" else "en_IN"}">')
    if image:
        lines.append(f'<meta property="og:image" content="{escape(image)}">')
        lines.append(f'<meta property="og:image:alt" content="{escape(image_alt)}">')
    if published:
        lines.append(f'<meta property="article:published_time" content="{escape(published)}">')
    if modified:
        lines.append(f'<meta property="article:modified_time" content="{escape(modified)}">')
    if published or modified:
        lines.append(f'<meta property="article:author" content="{escape(AUTHOR)}">')
    if labels:
        lines.append(f'<meta property="article:section" content="{escape(labels[0])}">')
        for label in labels[:8]:
            lines.append(f'<meta property="article:tag" content="{escape(label)}">')
    lines.append('<meta name="twitter:card" content="summary_large_image">')
    lines.append(f'<meta name="twitter:title" content="{escape(clean_text(title, 70))}">')
    lines.append(f'<meta name="twitter:description" content="{escape(description)}">')
    if image:
        lines.append(f'<meta name="twitter:image" content="{escape(image)}">')
        lines.append(f'<meta name="twitter:image:alt" content="{escape(image_alt)}">')

    graph = [{
        "@type": "Article",
        "headline": clean_text(title, 110),
        "description": description,
        "inLanguage": lang,
        "mainEntityOfPage": {"@type": "WebPage", "@id": canonical},
        "author": {"@type": "Person", "name": AUTHOR, "url": f"{SITE_URL}/about.html"},
        "publisher": {
            "@type": "Organization",
            "name": SITE_NAME,
            "url": SITE_URL + "/",
            "logo": {"@type": "ImageObject", "url": absolute(PUBLISHER_LOGO)},
        },
        "url": canonical,
    }]
    if image:
        entry = {"@type": "ImageObject", "url": image}
        graph[0]["image"] = [entry]
        graph[0]["thumbnailUrl"] = image
    if published:
        graph[0]["datePublished"] = published
    if modified or published:
        graph[0]["dateModified"] = modified or published
    if labels:
        graph[0]["articleSection"] = labels[0]
        graph[0]["keywords"] = ", ".join(labels[:8])
    graph.append({
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL + "/"},
            {"@type": "ListItem", "position": 2, "name": clean_text(title, 80), "item": canonical},
        ],
    })
    payload = {"@context": "https://schema.org", "@graph": graph}
    lines.append('<script type="application/ld+json">' + _ld_json(payload) + "</script>")
    lines.append(META_END)
    return "\n".join(lines)


def first_usable_image(body):
    """First <img> that is a real http(s) photo, skipping placeholder paths."""
    for match in re.finditer(r'<img\b[^>]*\bsrc="([^"]+)"', body or "", flags=re.I):
        src = html.unescape(match.group(1)).strip()
        if not src.lower().startswith(("http://", "https://")):
            continue
        if PLACEHOLDER_RE.search(src):
            continue
        if src.lower().endswith((".ico", ".svg")):
            continue
        return src
    return ""


def drop_placeholder_images(body):
    """Remove <img> tags whose source is a placeholder or a dead local path."""
    def repl(match):
        tag = match.group(0)
        src = re.search(r'src="([^"]*)"', tag, flags=re.I)
        if src and PLACEHOLDER_RE.search(html.unescape(src.group(1))):
            return ""
        return tag

    cleaned = re.sub(r"<img\b[^>]*>", repl, body or "", flags=re.I)
    # drop now-empty wrappers like <div>\n\n</div> left behind
    cleaned = re.sub(r"<p>\s*</p>", "", cleaned)
    cleaned = re.sub(r"<div>\s*</div>", "", cleaned)
    return cleaned


def read_fields(page):
    """Pull the fields the SEO block needs out of an existing post page."""
    def grab(pattern, default=""):
        match = re.search(pattern, page, flags=re.S | re.I)
        return match.group(1).strip() if match else default

    title = grab(r"<title>(.*?)\s+—\s+VK Tech Learn</title>") or grab(r"<h1[^>]*>(.*?)</h1>")
    title = clean_text(title)
    description = html.unescape(grab(r'<meta name="description" content="([^"]*)"', title))
    canonical = grab(r'<link rel="canonical" href="([^"]+)"')
    published = grab(r'<time[^>]*datetime="([^"]+)"')
    labels = [clean_text(l) for l in re.findall(r'<span class="tag">(.*?)</span>', page, flags=re.S)]
    body = grab(r'<article class="post-body">(.*?)</article>')
    slug = ""
    if canonical:
        slug = canonical.rsplit("/", 1)[-1].replace(".html", "")
    return {
        "title": title,
        "description": description,
        "canonical": canonical,
        "published": published,
        "labels": labels,
        "body": body,
        "slug": slug,
    }


def strip_existing_block(page):
    return re.sub(re.escape(META_START) + r".*?" + re.escape(META_END) + r"\n?", "", page, flags=re.S)


def apply_to_page(page):
    """Return (new_page, changed). Adds the SEO block and a hero when missing."""
    fields = read_fields(page)
    if not fields["canonical"]:
        return page, False

    body = fields["body"]
    slug = fields["slug"]
    image = first_usable_image(body) or (hero_image(slug)[0] and absolute(hero_image(slug)[0]))
    block = seo_block(
        title=fields["title"],
        description=fields["description"],
        canonical=fields["canonical"],
        published=fields["published"],
        modified=fields["published"],
        labels=fields["labels"],
        image=image,
        image_alt=fields["title"],
    )

    new_page = drop_placeholder_images(strip_existing_block(page))
    anchor = re.search(r'<link rel="canonical" href="[^"]*">', new_page, flags=re.I)
    if anchor:
        new_page = new_page[:anchor.end()] + "\n" + block + new_page[anchor.end():]
    else:
        head_end = new_page.lower().find("</head>")
        new_page = new_page[:head_end] + block + "\n" + new_page[head_end:]

    # hero figure for posts with no usable photo
    if not first_usable_image(body) and '<figure class="post-hero">' not in new_page:
        hero = hero_html(slug, fields["title"])
        if hero:
            title_end = re.search(r'<h1 class="post-title">.*?</h1>', new_page, flags=re.S)
            if title_end:
                new_page = new_page[:title_end.end()] + "\n" + hero + new_page[title_end.end():]

    return new_page, new_page != page


def main():
    """Standalone check: print the SEO block for one page path."""
    import sys
    if len(sys.argv) < 2:
        raise SystemExit("usage: python3 tools/post_seo.py posts/<slug>.html")
    with open(sys.argv[1], encoding="utf-8") as handle:
        page = handle.read()
    fields = read_fields(page)
    print(seo_block(
        title=fields["title"], description=fields["description"],
        canonical=fields["canonical"], published=fields["published"],
        labels=fields["labels"],
        image=first_usable_image(fields["body"]) or absolute(hero_image(fields["slug"])[0]),
        image_alt=fields["title"],
    ))


if __name__ == "__main__":
    main()
