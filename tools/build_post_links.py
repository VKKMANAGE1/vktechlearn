#!/usr/bin/env python3
"""Build tools/post_sources.json: official sources + related posts for older posts.

Blogger-synced posts often ship without outbound sources or internal links. This
script maps each post to (a) 1-2 official pages for the brand/topic in its title
and (b) 3 related posts on this site, so tools/build_posts.py can append a
sources block and an "Aage padhein" line without touching the article itself.

    python3 tools/build_post_links.py            # write tools/post_sources.json
    python3 tools/build_post_links.py --report   # only print coverage
"""
import glob
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS = os.path.join(ROOT, "posts")
OUT = os.path.join(ROOT, "tools", "post_sources.json")
FLAGS = os.path.join(ROOT, "tools", "content_flags.json")

# brand/keyword -> (label, official url)
BRANDS = [
    (r"iphone|apple|ios\b|ipad|macbook", "Apple Newsroom", "https://www.apple.com/newsroom/"),
    (r"samsung|galaxy", "Samsung Newsroom India", "https://news.samsung.com/in/"),
    (r"pixel|google pixel", "Google Pixel blog", "https://blog.google/products/pixel/"),
    (r"oneplus", "OnePlus India", "https://www.oneplus.in/"),
    (r"realme", "Realme India", "https://www.realme.com/in/"),
    (r"infinix", "Infinix India", "https://www.infinixmobiles.in/"),
    (r"xiaomi|redmi|poco|\bmi\b", "Xiaomi India", "https://www.mi.com/in/"),
    (r"vivo", "Vivo India", "https://www.vivo.com/in/"),
    (r"oppo", "Oppo India", "https://www.oppo.com/in/"),
    (r"nothing phone|nothing\b", "Nothing", "https://nothing.tech/"),
    (r"motorola|moto\b", "Motorola India", "https://www.motorola.in/"),
    (r"lenovo", "Lenovo India", "https://www.lenovo.com/in/en/"),
    (r"\bhp\b|hp laptop|hp printer", "HP Support", "https://support.hp.com/in-en"),
    (r"dell", "Dell India", "https://www.dell.com/en-in"),
    (r"asus", "Asus India", "https://www.asus.com/in/"),
    (r"acer", "Acer India", "https://www.acer.com/in-en"),
    (r"nvidia|geforce|\brtx\b", "NVIDIA GeForce", "https://www.nvidia.com/en-in/geforce/"),
    (r"amd|radeon", "AMD Radeon", "https://www.amd.com/en/products/graphics/radeon.html"),
    (r"intel", "Intel", "https://www.intel.in/"),
    (r"qualcomm|snapdragon", "Qualcomm Snapdragon", "https://www.qualcomm.com/products/mobile/snapdragon"),
    (r"mediatek|dimensity", "MediaTek", "https://www.mediatek.com/"),
    (r"whatsapp", "WhatsApp Help Center", "https://faq.whatsapp.com/"),
    (r"gmail", "Gmail Help", "https://support.google.com/mail/"),
    (r"google maps|maps", "Google Maps Help", "https://support.google.com/maps/"),
    (r"chrome", "Chrome Help", "https://support.google.com/chrome/"),
    (r"android", "Android Developers", "https://developer.android.com/"),
    (r"windows", "Microsoft Windows Support", "https://support.microsoft.com/windows"),
    (r"ms word|microsoft word|\bword\b", "Microsoft Word Support", "https://support.microsoft.com/word"),
    (r"excel", "Microsoft Excel Support", "https://support.microsoft.com/excel"),
    (r"powerpoint", "Microsoft PowerPoint Support", "https://support.microsoft.com/powerpoint"),
    (r"blogger|blogspot", "Blogger Help", "https://support.google.com/blogger/"),
    (r"youtube", "YouTube Help", "https://support.google.com/youtube/"),
    (r"instagram", "Instagram Help Center", "https://help.instagram.com/"),
    (r"facebook|meta\b", "Meta Newsroom", "https://about.fb.com/news/"),
    (r"telegram", "Telegram FAQ", "https://telegram.org/faq"),
    (r"netflix", "Netflix Help Center", "https://help.netflix.com/"),
    (r"openai|chatgpt|sora", "OpenAI", "https://openai.com/news/"),
    (r"gemini|deepmind", "Google DeepMind", "https://deepmind.google/discover/blog/"),
    (r"claude|anthropic", "Anthropic", "https://www.anthropic.com/news"),
    (r"perplexity", "Perplexity", "https://www.perplexity.ai/"),
    (r"airtel", "Airtel", "https://www.airtel.in/"),
    (r"\bjio\b|reliance jio", "Jio", "https://www.jio.com/"),
    (r"\bvi\b|vodafone|idea", "Vi", "https://www.myvi.in/"),
    (r"bsnl", "BSNL", "https://www.bsnl.co.in/"),
    (r"amazon", "Amazon India", "https://www.amazon.in/"),
    (r"flipkart", "Flipkart", "https://www.flipkart.com/"),
    (r"meesho", "Meesho", "https://www.meesho.com/"),
    (r"zepto", "Zepto", "https://www.zeptonow.com/"),
    (r"swiggy", "Swiggy", "https://www.swiggy.com/"),
    (r"zomato", "Zomato", "https://www.zomato.com/"),
    (r"paytm", "Paytm", "https://paytm.com/"),
    (r"phonepe", "PhonePe", "https://www.phonepe.com/"),
    (r"gpay|google pay", "Google Pay", "https://pay.google.com/intl/en_in/about/"),
    (r"upi|npci", "NPCI UPI", "https://www.npci.org.in/what-we-do/upi/product-overview"),
    (r"fastag", "NPCI FASTag", "https://www.npci.org.in/what-we-do/netc-fastag/product-overview"),
    (r"aadhaar|uidai", "UIDAI", "https://uidai.gov.in/"),
    (r"\bpan\b|income tax", "Income Tax India", "https://www.incometax.gov.in/"),
    (r"gst", "GST Portal", "https://www.gst.gov.in/"),
    (r"\brbi\b|loan|credit card|bank", "RBI", "https://www.rbi.org.in/"),
    (r"hack|cyber|phishing|password|security", "CERT-In", "https://www.cert-in.org.in/"),
    (r"seo|google search|ranking|backlink", "Google Search Central", "https://developers.google.com/search/docs"),
    (r"blogging|blog\b", "Google Search Central", "https://developers.google.com/search/docs/fundamentals/creating-helpful-content"),
]

# Devanagari titles need their own keywords: the same brands written in Hindi.
BRANDS.extend([
    (r"आईफोन|एप्पल|आईपैड|मैकबुक", "Apple Newsroom", "https://www.apple.com/newsroom/"),
    (r"सैमसंग|गैलेक्सी", "Samsung Newsroom India", "https://news.samsung.com/in/"),
    (r"गूगल पिक्सल|पिक्सल", "Google Pixel blog", "https://blog.google/products/pixel/"),
    (r"वनप्लस", "OnePlus India", "https://www.oneplus.in/"),
    (r"रियलमी", "Realme India", "https://www.realme.com/in/"),
    (r"इनफिनिक्स", "Infinix India", "https://www.infinixmobiles.in/"),
    (r"शाओमी|रेडमी|पोको", "Xiaomi India", "https://www.mi.com/in/"),
    (r"विवो", "Vivo India", "https://www.vivo.com/in/"),
    (r"ओप्पो", "Oppo India", "https://www.oppo.com/in/"),
    (r"लेनोवो", "Lenovo India", "https://www.lenovo.com/in/en/"),
    (r"एचपी |हेवलेट", "HP Support", "https://support.hp.com/in-en"),
    (r"डेल", "Dell India", "https://www.dell.com/en-in"),
    (r"एसुस", "Asus India", "https://www.asus.com/in/"),
    (r"एसर", "Acer India", "https://www.acer.com/in-en"),
    (r"एनवीडिया|जीफोर्स", "NVIDIA GeForce", "https://www.nvidia.com/en-in/geforce/"),
    (r"एएमडी|रेडियॉन", "AMD Radeon", "https://www.amd.com/en/products/graphics/radeon.html"),
    (r"इंटेल", "Intel", "https://www.intel.in/"),
    (r"क्वालकॉम|स्नैपड्रैगन", "Qualcomm Snapdragon", "https://www.qualcomm.com/products/mobile/snapdragon"),
    (r"व्हाट्सएप|वाट्सएप", "WhatsApp Help Center", "https://faq.whatsapp.com/"),
    (r"जीमेल", "Gmail Help", "https://support.google.com/mail/"),
    (r"गूगल मैप्स|मैप्स", "Google Maps Help", "https://support.google.com/maps/"),
    (r"क्रोम", "Chrome Help", "https://support.google.com/chrome/"),
    (r"एंड्रॉइड", "Android Developers", "https://developer.android.com/"),
    (r"विंडोज़|विंडोज", "Microsoft Windows Support", "https://support.microsoft.com/windows"),
    (r"माइक्रोसॉफ्ट|कोपायलट", "Microsoft Support", "https://support.microsoft.com/"),
    (r"एमएस वर्ड|वर्ड", "Microsoft Word Support", "https://support.microsoft.com/word"),
    (r"एक्सेल", "Microsoft Excel Support", "https://support.microsoft.com/excel"),
    (r"ब्लॉगर", "Blogger Help", "https://support.google.com/blogger/"),
    (r"यूट्यूब", "YouTube Help", "https://support.google.com/youtube/"),
    (r"इंस्टाग्राम", "Instagram Help Center", "https://help.instagram.com/"),
    (r"फेसबुक|मेटा", "Meta Newsroom", "https://about.fb.com/news/"),
    (r"टेलीग्राम", "Telegram FAQ", "https://telegram.org/faq"),
    (r"नेटफ्लिक्स", "Netflix Help Center", "https://help.netflix.com/"),
    (r"चैटजीपीटी|ओपनएआई", "OpenAI", "https://openai.com/news/"),
    (r"जेमिनी", "Google DeepMind", "https://deepmind.google/discover/blog/"),
    (r"क्लॉड", "Anthropic", "https://www.anthropic.com/news"),
    (r"परप्लेक्सिटी", "Perplexity", "https://www.perplexity.ai/"),
    (r"एयरटेल", "Airtel", "https://www.airtel.in/"),
    (r"जियो", "Jio", "https://www.jio.com/"),
    (r"वोडाफोन|वीआई|बीएसएनएल", "Vi", "https://www.myvi.in/"),
    (r"अमेज़न|अमेजन", "Amazon India", "https://www.amazon.in/"),
    (r"फ्लिपकार्ट", "Flipkart", "https://www.flipkart.com/"),
    (r"मीशो", "Meesho", "https://www.meesho.com/"),
    (r"ज़ेप्टो|जेप्टो", "Zepto", "https://www.zeptonow.com/"),
    (r"स्विगी", "Swiggy", "https://www.swiggy.com/"),
    (r"ज़ोमैटो|जोमैटो", "Zomato", "https://www.zomato.com/"),
    (r"पेटीएम", "Paytm", "https://paytm.com/"),
    (r"फोनपे", "PhonePe", "https://www.phonepe.com/"),
    (r"जीपे|गूगल पे", "Google Pay", "https://pay.google.com/intl/en_in/about/"),
    (r"यूपीआई|एनपीसीआई", "NPCI UPI", "https://www.npci.org.in/what-we-do/upi/product-overview"),
    (r"फास्टैग", "NPCI FASTag", "https://www.npci.org.in/what-we-do/netc-fastag/product-overview"),
    (r"आधार", "UIDAI", "https://uidai.gov.in/"),
    (r"पैन कार्ड|पैन", "Income Tax India", "https://www.incometax.gov.in/"),
    (r"जीएसटी|जीएसटी", "GST Portal", "https://www.gst.gov.in/"),
    (r"आरबीआई|लोन|क्रेडिट कार्ड|बैंक", "RBI", "https://www.rbi.org.in/"),
    (r"हैकिंग|साइबर|पासवर्ड|सुरक्षा", "CERT-In", "https://www.cert-in.org.in/"),
    (r"एसईओ|सर्च", "Google Search Central", "https://developers.google.com/search/docs"),
    (r"ब्लॉगिंग", "Google Search Central", "https://developers.google.com/search/docs/fundamentals/creating-helpful-content"),
])

# topic keywords for posts without a clear brand
TOPICS = [
    (r"wifi|wi-fi|router", "Microsoft Wi-Fi troubleshooting", "https://support.microsoft.com/windows/fix-wi-fi-connection-issues-in-windows-9424a1f7-6a3b-65a6-4d78-7f07eee84d2c"),
    (r"typing|keyboard", "TypingClub lessons", "https://www.typingclub.com/"),
    (r"printer|print|प्रिंटर", "Microsoft print help", "https://support.microsoft.com/windows/fix-printing-problems-in-windows-f5d5b5d7-7f0f-4d0e-3d8a-0f1b4b7c9a11"),
    (r"\bai\b|एआई|आर्टिफिशियल इंटेलिजेंस", "Google AI blog", "https://blog.google/technology/ai/"),
    (r"कंप्यूटर|computer", "Microsoft Learn — Windows", "https://learn.microsoft.com/windows/"),
    (r"flight|ticket|फ्लाइट|टिकट", "DGCA", "https://www.dgca.gov.in/"),
    (r"salary|वेतन|पे कमीशन|pay commission", "7th CPC", "https://7cpc.india.gov.in/"),
    (r"scheme|योजना|सब्सिडी|सरकारी", "India.gov.in", "https://www.india.gov.in/"),
    (r"semiconductor|सेमीकंडक्टर", "MeitY", "https://www.meity.gov.in/"),
    (r"satellite|सैटेलाइट|5g|5जी", "Department of Telecom", "https://dot.gov.in/"),
    (r"aws|cloud computing|क्लाउड", "AWS Documentation", "https://docs.aws.amazon.com/"),
    (r"agile|scrum|एजाइल", "Scrum Guide", "https://scrumguides.org/"),
    (r"python|पायथन", "Python Documentation", "https://docs.python.org/3/"),
    (r"sql|database|डेटाबेस", "PostgreSQL Documentation", "https://www.postgresql.org/docs/"),
    (r"git|github", "GitHub Docs", "https://docs.github.com/"),
    (r"docker|container|kubernetes", "Kubernetes Documentation", "https://kubernetes.io/docs/"),
    (r"linux|लिनक्स", "Linux Kernel Documentation", "https://www.kernel.org/doc/html/latest/"),
    (r"testing|टेस्टिंग|unit test", "pytest Documentation", "https://docs.pytest.org/"),
    (r"data science|डेटा साइंस|analytics|एनालिटिक्स", "Google Analytics Help", "https://support.google.com/analytics/"),
    (r"startup|स्टार्टअप", "Startup India", "https://www.startupindia.gov.in/"),
    (r"hiring|recruitment|नौकरी|भर्ती", "Ministry of Labour", "https://labour.gov.in/"),
    (r"software|सॉफ्टवेयर|application", "Microsoft Learn", "https://learn.microsoft.com/"),
    (r"ईमेल|email", "Gmail Help", "https://support.google.com/mail/"),
    (r"कम्प्यूटर", "Microsoft Learn — Windows", "https://learn.microsoft.com/windows/"),
    (r"browser cache|dns|कैश", "Google Public DNS", "https://developers.google.com/speed/public-dns/docs/using"),
    (r"bsod|ब्लू स्क्रीन", "Microsoft Windows Support", "https://support.microsoft.com/windows"),
    (r"gpu|graphics card|ग्राफिक्स", "NVIDIA GeForce", "https://www.nvidia.com/en-in/geforce/"),
    (r"gta|rockstar", "Rockstar Games Newswire", "https://www.rockstargames.com/newswire"),
    (r"honor", "Honor India", "https://www.honor.com/in/"),
    (r"iot|इंटरनेट ऑफ थिंग्स", "MeitY", "https://www.meity.gov.in/"),
    (r"legacy|modernization", "AWS Prescriptive Guidance", "https://docs.aws.amazon.com/prescriptive-guidance/"),
    (r"domain|डोमेन|namecheap", "ICANN", "https://www.icann.org/"),
    (r"network device|नेटवर्क", "Cisco Support", "https://www.cisco.com/c/en/us/support/index.html"),
    (r"\bpf\b|epfo|पीएफ", "EPFO", "https://www.epfindia.gov.in/"),
    (r"project management|प्रोजेक्ट", "Atlassian Jira guides", "https://www.atlassian.com/software/jira/guides"),
    (r"ram\b|ssd|मेमोरी", "Micron", "https://www.micron.com/"),
    (r"cluster|server", "AWS Architecture Center", "https://docs.aws.amazon.com/architecture/"),
    (r"smart tv|टीवी|remote|रिमोट", "Samsung TV Support", "https://www.samsung.com/in/support/"),
    (r"charging|चार्जिंग", "USB-IF", "https://www.usb.org/"),
    (r"sovereign|data residency", "MeitY", "https://www.meity.gov.in/"),
    (r"games|गेम", "Steam", "https://store.steampowered.com/"),
    (r"सरकार", "India.gov.in", "https://www.india.gov.in/"),
    (r"architecture", "AWS Architecture Center", "https://docs.aws.amazon.com/architecture/"),
    (r"productivity|प्रोडक्टिविटी", "Google Workspace", "https://workspace.google.com/"),
    (r"product|saas|self-service|outsourcing", "Startup India", "https://www.startupindia.gov.in/"),
    (r"token|context window|कॉन्टेक्स्ट", "OpenAI Cookbook — tokens", "https://cookbook.openai.com/examples/how_to_count_tokens_with_tiktoken"),
    (r"proof of concept|\bpoc\b|\bmvp\b", "Microsoft Cloud Adoption Framework", "https://learn.microsoft.com/azure/cloud-adoption-framework/"),
    (r"सी ड्राइव|स्टोरेज|storage|disk", "Microsoft storage help", "https://support.microsoft.com/windows/free-up-drive-space-in-windows-10-and-11-85529ccb-7c9b-4f27-a2a1-2b0f9d1c9c5f"),
]


def page_text(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def title_of(page):
    match = re.search(r"<title>(.*?)</title>", page, re.S)
    return html.unescape(match.group(1)).replace(" — VK Tech Learn", "").strip() if match else ""


def label_of(page):
    match = re.search(r'<span class="label"[^>]*>(.*?)</span>', page, re.S)
    if not match:
        match = re.search(r'<span class="tag"[^>]*>(.*?)</span>', page, re.S)
    return html.unescape(re.sub(r"<[^>]+>", "", match.group(1))).strip() if match else "Tech"


GENERATED = (
    re.compile(r'[ \t]*<h2 id="post-sources">.*?</ul>\n', re.S),
    re.compile(r'[ \t]*<p class="post-related">.*?</p>\n', re.S),
)


def without_generated(page):
    """Drop the block this tool inserts, so re-runs see the original page."""
    for pattern in GENERATED:
        page = pattern.sub("", page)
    return page


def has_sources(page):
    page = without_generated(page)
    return bool(re.search(r'<h2[^>]*>\s*(स्रोत|Sources)\s*</h2>', page, re.I))


def has_internal(page):
    body = without_generated(page).split('<article class="post-body">')[-1]
    return bool(re.search(r'href="/posts/', body))


STOPWORDS = {
    "क्या", "कैसे", "करें", "करे", "और", "के", "का", "की", "को", "में", "से", "है", "हैं", "नहीं",
    "पूरी", "जानकारी", "अच्छा", "बेहतर", "सही", "नया", "नई", "आप", "करेगा", "करता", "करते", "हिंदी",
    "the", "and", "for", "with", "how", "what", "why", "new", "best", "top", "guide", "tips",
    "your", "you", "this", "that", "hindi", "kya", "kaise", "karein", "kare", "aur", "ke", "ka", "ki",
}


def tokens(text):
    words = re.findall(r"[a-z0-9\u0900-\u097f]{3,}", text.lower())
    return {w for w in words if w not in STOPWORDS}


def main():
    noindex = set()
    try:
        with open(FLAGS, encoding="utf-8") as handle:
            noindex = set(json.load(handle).get("noindex", []))
    except (OSError, ValueError):
        pass

    posts = {}
    for path in sorted(glob.glob(os.path.join(POSTS, "*.html"))):
        slug = os.path.basename(path)[:-5]
        page = page_text(path)
        posts[slug] = {
            "title": title_of(page),
            "label": label_of(page),
            "tokens": tokens(title_of(page) + " " + label_of(page)),
            "sources": has_sources(page),
            "internal": has_internal(page),
        }

    candidates = [s for s in posts if s not in noindex]
    mapping, unmatched, no_source, no_internal = {}, [], 0, 0
    for slug, info in posts.items():
        if info["sources"] and info["internal"]:
            continue
        if info["sources"]:
            no_source += 0
        else:
            no_source += 1
        if not info["internal"]:
            no_internal += 1

        title_low = info["title"].lower()
        picked, seen = [], set()
        for pattern, label, url in BRANDS:
            if len(picked) >= 2:
                break
            if re.search(pattern, title_low) and url not in seen:
                picked.append({"label": f"{label} — official page", "url": url})
                seen.add(url)
        if not picked:
            for pattern, label, url in TOPICS:
                if re.search(pattern, title_low):
                    picked.append({"label": f"{label} — official page", "url": url})
                    break
        if not picked:
            unmatched.append(slug)
        if info["sources"]:
            picked = []

        scored = []
        for other in candidates:
            if other == slug:
                continue
            overlap = len(info["tokens"] & posts[other]["tokens"])
            same_label = 2 if posts[other]["label"] == info["label"] else 0
            score = overlap * 2 + same_label + (1 if posts[other]["sources"] else 0)
            if score >= 4:
                scored.append((score, other))
        scored.sort(key=lambda item: (-item[0], item[1]))
        related = [
            {"slug": other, "title": posts[other]["title"]}
            for _, other in scored[:3]
        ]
        if len(related) < 3:
            chosen = {item["slug"] for item in related}
            for other in candidates:
                if other == slug or other in chosen:
                    continue
                related.append({"slug": other, "title": posts[other]["title"]})
                if len(related) == 3:
                    break

        entry = {}
        if picked:
            entry["sources"] = picked
        if related and not info["internal"]:
            entry["related"] = related
        if entry:
            mapping[slug] = entry

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(mapping, handle, ensure_ascii=False, indent=2)

    with_sources = sum(1 for e in mapping.values() if e.get("sources"))
    with_related = sum(1 for e in mapping.values() if e.get("related"))
    print(f"posts needing work: {len(mapping)} | sources: {with_sources} | related: {with_related}")
    print(f"missing sources before: {no_source} | missing internal links before: {no_internal}")
    print(f"unmatched (no official page): {len(unmatched)} -> {unmatched[:8]}")


if __name__ == "__main__":
    main()
