#!/usr/bin/env python3
"""Build tools/post_sources.json: official sources + related posts for older posts.

Each post gets 1-2 official pages for the brand/topic in its title and 3 related
posts picked by shared topic tags, so tools/build_posts.py can append a sources
block and an "Aage padhein" line without touching the article itself.

    python3 tools/build_post_links.py        # write tools/post_sources.json
    python3 tools/build_post_links.py --check  # verify every source URL (HTTP 200)
"""
import glob
import html
import json
import math
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS = os.path.join(ROOT, "posts")
OUT = os.path.join(ROOT, "tools", "post_sources.json")
FLAGS = os.path.join(ROOT, "tools", "content_flags.json")

# (title regex, source label, official deep page) -- brands first, then topics.
BRANDS = [
    (r"iphone|ios\b|ipad|macbook|आईफोन|आईपैड|मैकबुक", "iPhone और iOS support", "https://support.apple.com/iphone"),
    (r"apple|एप्पल", "Apple Newsroom", "https://www.apple.com/newsroom/"),
    (r"samsung|galaxy|सैमसंग|गैलेक्सी", "Samsung support (India)", "https://www.samsung.com/in/support/"),
    (r"pixel|पिक्सल", "Google Pixel help", "https://support.google.com/pixelphone/"),
    (r"\boneplus\b|वनप्लस", "OnePlus support", "https://www.oneplus.in/support"),
    (r"\brealme\b|रियलमी", "Realme support", "https://www.realme.com/in/support"),
    (r"infinix|इनफिनिक्स", "Infinix support", "https://www.infinixmobiles.in/"),
    (r"xiaomi|redmi|poco|शाओमी|रेडमी|पोको", "Xiaomi support (India)", "https://www.mi.com/in/support/"),
    (r"\bvivo\b|विवो", "Vivo support", "https://www.vivo.com/in/support"),
    (r"\boppo\b|ओप्पो", "Oppo support", "https://www.oppo.com/in/support/"),
    (r"nothing phone|nothing\b", "Nothing support", "https://nothing.tech/pages/support"),
    (r"motorola|moto\b", "Motorola support", "https://www.motorola.in/support"),
    (r"\blenovo\b|लेनोवो", "Lenovo support", "https://support.lenovo.com/in/en/"),
    (r"\bhp\b|hp laptop|एचपी |हेवलेट", "HP support", "https://support.hp.com/in-en"),
    (r"\bdell\b|डेल", "Dell support", "https://www.dell.com/support/home/en-in"),
    (r"\basus\b|एसुस", "Asus support", "https://www.asus.com/in/support/"),
    (r"\bacer\b|एसर", "Acer support", "https://www.acer.com/in-en/support"),
    (r"honor", "Honor support (India)", "https://www.honor.com/in/support/"),
    (r"nvidia|geforce|\brtx\b|एनवीडिया|जीफोर्स", "NVIDIA GeForce", "https://www.nvidia.com/en-in/geforce/"),
    (r"\bamd\b|radeon|एएमडी|रेडियॉन", "AMD Radeon", "https://www.amd.com/en/products/graphics/desktops/radeon.html"),
    (r"\bintel\b|इंटेल", "Intel support", "https://www.intel.in/content/www/in/en/support.html"),
    (r"qualcomm|snapdragon|क्वालकॉम|स्नैपड्रैगन", "Qualcomm Snapdragon", "https://www.qualcomm.com/products/mobile/snapdragon"),
    (r"mediatek|dimensity", "MediaTek smartphones", "https://www.mediatek.com/products/smartphones"),
    (r"whatsapp|व्हाट्सएप|वाट्सएप", "WhatsApp Help Center", "https://faq.whatsapp.com/"),
    (r"gmail|जीमेल|ईमेल|email", "Gmail Help", "https://support.google.com/mail/"),
    (r"google maps|maps|गूगल मैप्स", "Google Maps Help", "https://support.google.com/maps/"),
    (r"chrome|क्रोम", "Chrome Help", "https://support.google.com/chrome/"),
    (r"android|एंड्रॉइड", "Android Developers", "https://developer.android.com/"),
    (r"windows|विंडोज़|विंडोज|bsod|ब्लू स्क्रीन", "Windows help & learning", "https://support.microsoft.com/windows"),
    (r"ms word|microsoft word|\bword\b|एमएस वर्ड", "Microsoft Word help", "https://support.microsoft.com/word"),
    (r"excel|एक्सेल", "Microsoft Excel help", "https://support.microsoft.com/excel"),
    (r"powerpoint", "PowerPoint help", "https://support.microsoft.com/powerpoint"),
    (r"blogger|blogspot|ब्लॉगर", "Blogger Help", "https://support.google.com/blogger/"),
    (r"youtube|यूट्यूब", "YouTube Help", "https://support.google.com/youtube/"),
    (r"instagram|इंस्टाग्राम", "Instagram Help Center", "https://help.instagram.com/"),
    (r"facebook|meta\b|फेसबुक|मेटा", "Meta Newsroom", "https://about.fb.com/news/"),
    (r"telegram|टेलीग्राम", "Telegram FAQ", "https://telegram.org/faq"),
    (r"netflix|नेटफ्लिक्स", "Netflix Help Center", "https://help.netflix.com/"),
    (r"chatgpt|openai|चैटजीपीटी|ओपनएआई", "OpenAI news", "https://openai.com/news/"),
    (r"gemini|deepmind|जेमिनी", "Google DeepMind blog", "https://deepmind.google/discover/blog/"),
    (r"claude|anthropic|क्लॉड", "Anthropic news", "https://www.anthropic.com/news"),
    (r"perplexity|परप्लेक्सिटी", "Perplexity blog", "https://www.perplexity.ai/hub/blog"),
    (r"airtel|एयरटेल", "Airtel help & support", "https://www.airtel.in/help-support"),
    (r"\bjio\b|reliance jio|जियो", "Jio help", "https://www.jio.com/help"),
    (r"vodafone|वोडाफोन|\bvi\b|बीएसएनएल", "Vi help & support", "https://www.myvi.in/help-support"),
    (r"amazon|अमेज़न|अमेजन", "Amazon India customer service", "https://www.amazon.in/gp/help/customer/display.html"),
    (r"flipkart|फ्लिपकार्ट", "Flipkart Help Centre", "https://www.flipkart.com/helpcentre"),
    (r"meesho|मीशो", "Meesho help", "https://www.meesho.com/help"),
    (r"zepto|ज़ेप्टो|जेप्टो", "Zepto help", "https://www.zeptonow.com/help"),
    (r"swiggy|स्विगी", "Swiggy support", "https://www.swiggy.com/support"),
    (r"zomato|ज़ोमैटो|जोमैटो", "Zomato support", "https://www.zomato.com/support"),
    (r"paytm|पेटीएम", "Paytm help", "https://paytm.com/help"),
    (r"phonepe|फोनपे", "PhonePe support", "https://www.phonepe.com/"),
    (r"gpay|google pay|जीपे|गूगल पे", "Google Pay (India)", "https://pay.google.com/intl/en_in/about/"),
    (r"upi|npci|यूपीआई|एनपीसीआई", "NPCI — UPI product page", "https://www.npci.org.in/what-we-do/upi/product-overview"),
    (r"fastag|फास्टैग", "NPCI — NETC FASTag", "https://www.npci.org.in/what-we-do/netc-fastag/product-overview"),
    (r"aadhaar|uidai|आधार", "UIDAI", "https://uidai.gov.in/en/"),
    (r"\bpan\b|income tax|पैन कार्ड", "Income Tax e-filing portal", "https://www.incometax.gov.in/iec/foportal/"),
    (r"gst|जीएसटी", "GST portal help", "https://www.gst.gov.in/help"),
    (r"\brbi\b|आरबीआई|loan|लोन|credit card|क्रेडिट कार्ड", "RBI FAQs", "https://www.rbi.org.in/Scripts/FAQDisplay.aspx"),
    (r"hack|cyber|phishing|password|हैकिंग|साइबर|पासवर्ड", "CERT-In advisories", "https://www.cert-in.org.in/"),
    (r"seo|google search|ranking|backlink|एसईओ", "Google Search Central docs", "https://developers.google.com/search/docs"),
    (r"blogging|ब्लॉगिंग", "Google — helpful content guidance", "https://developers.google.com/search/docs/fundamentals/creating-helpful-content"),
]

TOPICS = [
    (r"\bcopilot\b|कोपायलट", "Microsoft 365 Copilot", "https://support.microsoft.com/copilot"),
    (r"\bsoftware\b|सॉफ्टवेयर|application software|system software", "Microsoft Learn", "https://learn.microsoft.com/"),
    (r"screen recording|स्क्रीन रिकॉर्डिंग", "OBS Studio", "https://obsproject.com/"),
    (r"made-in-india|मेड-इन-इंडिया|made in india", "Digital India", "https://www.digitalindia.gov.in/"),
    (r"\barchitecture\b|event-driven", "AWS Architecture Center", "https://docs.aws.amazon.com/architecture/"),
    (r"\brank\b|रैंक", "Google Search Central docs", "https://developers.google.com/search/docs"),
    (r"कम्प्यूटर", "Microsoft Learn — Windows", "https://learn.microsoft.com/windows/"),
    (r"smart tv|टीवी|remote|रिमोट", "Samsung TV support", "https://www.samsung.com/in/support/"),
    (r"wifi|wi-fi|router", "Windows Wi-Fi troubleshooting", "https://support.microsoft.com/windows"),
    (r"printer|print|प्रिंटर", "Windows printing help", "https://support.microsoft.com/windows"),
    (r"typing|keyboard|टाइपिंग", "Unicode Devanagari chart", "https://www.unicode.org/charts/PDF/U0900.pdf"),
    (r"\bai\b|एआई|आर्टिफिशियल इंटेलिजेंस", "Google AI blog", "https://blog.google/technology/ai/"),
    (r"कंप्यूटर|computer", "Microsoft Learn — Windows", "https://learn.microsoft.com/windows/"),
    (r"flight|फ्लाइट", "DGCA — aviation regulator", "https://www.dgca.gov.in/"),
    (r"salary|वेतन|pay commission|पे कमीशन", "India.gov.in — pay & pension", "https://www.india.gov.in/"),
    (r"scheme|योजना|सब्सिडी|सरकारी|सरकार", "myScheme — government schemes", "https://www.myscheme.gov.in/"),
    (r"semiconductor|सेमीकंडक्टर|iot|इंटरनेट ऑफ थिंग्स|sovereign|data residency", "MeitY schemes & projects", "https://www.meity.gov.in/content/schemes-projects"),
    (r"satellite|सैटेलाइट|5g|5जी", "DoT telecom policies", "https://dot.gov.in/telecom-policies"),
    (r"aws|cloud|क्लाउड|cluster|server", "AWS overview (docs)", "https://docs.aws.amazon.com/whitepapers/latest/aws-overview/introduction.html"),
    (r"agile|scrum|एजाइल", "The Scrum Guide", "https://scrumguides.org/scrum-guide.html"),
    (r"python|पायथन", "Python tutorial", "https://docs.python.org/3/tutorial/"),
    (r"sql|database|डेटाबेस", "PostgreSQL documentation", "https://www.postgresql.org/docs/current/"),
    (r"git|github", "GitHub Docs — get started", "https://docs.github.com/en/get-started"),
    (r"docker|container|kubernetes", "Kubernetes concepts", "https://kubernetes.io/docs/concepts/"),
    (r"linux|लिनक्स", "Linux kernel documentation", "https://www.kernel.org/doc/html/latest/"),
    (r"testing|टेस्टिंग|unit test", "pytest documentation", "https://docs.pytest.org/en/stable/"),
    (r"data science|डेटा साइंस|analytics|एनालिटिक्स", "Google Analytics Help", "https://support.google.com/analytics/"),
    (r"startup|स्टार्टअप|saas|outsourcing|self-service", "Startup India hub", "https://www.startupindia.gov.in/"),
    (r"hiring|recruitment|नौकरी|भर्ती", "Ministry of Labour — policies", "https://labour.gov.in/labour-policies"),
    (r"ddos", "CERT-In advisories", "https://www.cert-in.org.in/"),
    (r"browser cache|dns|कैश", "Google Public DNS — using", "https://developers.google.com/speed/public-dns/docs/using"),
    (r"gpu|graphics card|ग्राफिक्स|\bram\b|ssd|मेमोरी", "Micron memory products", "https://www.micron.com/products/memory"),
    (r"gta|rockstar", "Rockstar Games Newswire", "https://www.rockstargames.com/newswire"),
    (r"legacy|modernization", "AWS Prescriptive Guidance", "https://docs.aws.amazon.com/prescriptive-guidance/"),
    (r"domain|डोमेन|namecheap", "ICANN — about domain names", "https://www.icann.org/en/contracted-parties"),
    (r"network device|नेटवर्क", "Cisco support", "https://www.cisco.com/c/en/us/support/index.html"),
    (r"\bpf\b|epfo|पीएफ", "EPFO — for employees", "https://www.epfindia.gov.in/site_en/For_Employees.php"),
    (r"project management|प्रोजेक्ट", "Atlassian Jira guides", "https://www.atlassian.com/software/jira/guides"),
    (r"charging|चार्जिंग", "USB-IF — USB charging", "https://www.usb.org/usb-charger-pd"),
    (r"games|गेम", "Steam — free to play", "https://store.steampowered.com/genre/Free%20to%20Play/"),
    (r"productivity|प्रोडक्टिविटी", "Google Workspace products", "https://workspace.google.com/products/"),
    (r"token|context window|कॉन्टेक्स्ट", "OpenAI Cookbook — count tokens", "https://cookbook.openai.com/examples/how_to_count_tokens_with_tiktoken"),
    (r"proof of concept|\bpoc\b|\bmvp\b|product", "Microsoft Cloud Adoption Framework", "https://learn.microsoft.com/azure/cloud-adoption-framework/"),
]


# Curated fallback: when no post is a close match, link a themed evergreen guide.
PILLARS = {
    "ai": [
        "ai-kya-hai-aur-manav-buddhi-se-kaise-bhin-deti-hai",
        "prompt-engineering-hindi-guide",
        "ai-tools-ki-wave-2025-top-free-ai-tools",
    ],
    "windows": [
        "tv",
        "basic-computer-fundamentals-in-hindi",
        "application-software-kya-hai-guide",
    ],
    "phone": [
        "windows-11-me-android-kaise-use-kare",
        "whatsapp",
        "smartphone-slow-charging",
    ],
    "internet": [
        "internet-kaise-kaam-karta-hai-hindi",
        "browser-cache-dns",
        "wi-fi-speed",
    ],
    "money": [
        "upi-autopay-paytm-phonepe-google-pay",
        "pf-balance-pf",
        "gst-kya-hai-hindi-guide",
    ],
    "dev": ["git-github-kya-hai-hindi-guide", "api-kya-hai-hindi", "sql-kya-hai-hindi"],
    "seo": ["core-web-vitals-hindi", "domain-dns-records-hindi", "web-hosting-kya-hai-hindi"],
    "default": [
        "ai-kya-hai-aur-manav-buddhi-se-kaise-bhin-deti-hai",
        "internet-kaise-kaam-karta-hai-hindi",
        "windows-11-me-android-kaise-use-kare",
    ],
}

THEMES = [
    (r"\bai\b|एआई|chatgpt|gemini|llm|prompt|claude|machine learning", "ai"),
    (r"windows|विंडोज़|कंप्यूटर|computer|laptop|लैपटॉप|bsod", "windows"),
    (r"whatsapp|android|iphone|स्मार्टफोन|smartphone|charging|चार्जिंग", "phone"),
    (r"internet|इंटरनेट|wifi|wi-fi|dns|router|network|नेटवर्क|5g", "internet"),
    (r"upi|paytm|phonepe|bank|बैंक|pf\b|बैलेंस|gst|tax|loan|₹", "money"),
    (r"python|sql|git|docker|api\b|code|developer|kubernetes", "dev"),
    (r"seo|blog|adsense|ranking|hosting|domain", "seo"),
]


# Hand-picked related posts where the automatic match has nothing close to offer.
# Regeneration keeps these: tools/post_sources.json is output, this map is the input.
OVERRIDES = {
    "10": ["whatsapp-pnr", "how-to-transfer-your-fastag-from-one"],
    "5000": ["ai-video-editing-shorts-hindi", "openai-sora-2-tiktok-youtube-shorts"],
    "7": ["basic-computer-fundamentals-in-hindi", "excel-formulas-hindi-guide", "ms-word-how-to-delete-page-in-word"],
    "8-34": ["pf-balance-pf", "link-voter-id-card-with-aadhaar-card-in"],
    "ai-80": ["ai-ethics-bias-hindi", "ai-readiness-assessment-checklist-25-points", "machine-learning-vs-deep-learning-hindi"],
    "ai-vs-gut-feeling-body-font-family": ["ai-ethics-bias-hindi", "ai-model-evaluation-hindi"],
    "amazon-black-friday-sale-2025": [
        "google-pixel-9-pro-flipkart-goat",
        "iphone-iphone-16e-6300-ai",
        "black-friday-2026-gpu-deals-india",
    ],
    "ayaneo-pocket-ds-android-nintendo-ds": [
        "infinix-gt-30-5g",
        "android-16-7",
        "top-10-free-games-websites-for-online",
    ],
    "blog-post-2": ["gmail-gmail", "cybersecurity-basics-hindi"],
    "blog-post-3": [
        "basic-computer-fundamentals-in-hindi",
        "application-software-kya-hai-guide",
        "system-software-kya-hai-guide",
    ],
    "blog-post-6": [
        "whatsapp-aadhaar-whatsapp",
        "link-voter-id-card-with-aadhaar-card-in",
        "pan-20",
    ],
    "bsod": ["tv", "windows-10", "win-11"],
    "cybersecurity-basics-hindi": ["blog-post-4", "pan-20", "google-ai-risk-ai"],
    "elon-musk-vs-apple-ai": ["apple-apple-1-whatsapp", "google-ai-risk-ai", "ai-ethics-bias-hindi"],
    "event-driven-architecture-real-time-decisions-hindi": [
        "system-design-basics-hindi",
        "serverless-kya-hai-hindi",
        "api-kya-hai-hindi",
    ],
    "gmail": ["gmail-gmail", "windows-10"],
    "google-maps": ["whatsapp-pnr", "how-to-transfer-your-fastag-from-one", "internet-kaise-kaam-karta-hai-hindi"],
    "gpay-phonepe-15-upi": [
        "upi-autopay-paytm-phonepe-google-pay",
        "computer-ki-puri-knowledge-kya-hai",
        "pf-balance-pf",
    ],
    "hindi-typing-practice": ["7", "basic-computer-fundamentals-in-hindi"],
    "how-to-transfer-your-fastag-from-one": [
        "upi-autopay-paytm-phonepe-google-pay",
        "gpay-phonepe-15-upi",
        "whatsapp-pnr",
    ],
    "infinix-gt-30-5g": ["ayaneo-pocket-ds-android-nintendo-ds", "android-16-7"],
    "made-in-india-apps": ["apple-apple-1-whatsapp", "whatsapp-real-time-message-translation"],
    "namecheap-74-com": ["domain-dns-records-hindi", "web-hosting-kya-hai-hindi", "seo"],
    "network-device-network-device-in-hindi": [
        "computer-network-what-is-computer",
        "internet-kaise-kaam-karta-hai-hindi",
        "domain-dns-records-hindi",
    ],
    "openai-sora-2-tiktok-youtube-shorts": [
        "ai-video-editing-shorts-hindi",
        "chatgpt-ai-image-step-by-step",
        "ai-image-generation-hindi-guide",
    ],
    "pf-balance-pf": ["upi-autopay-paytm-phonepe-google-pay", "gpay-phonepe-15-upi", "pan-20"],
    "pixel-10-10": ["google-pixel-10-whatsapp", "google-pixel-9-pro-flipkart-goat", "android-16-7"],
    "samsung-galaxy-z-fold-7-discount": [
        "google-pixel-9-pro-flipkart-goat",
        "iphone-iphone-16e-6300-ai",
        "amazon-black-friday-sale-2025",
    ],
    "seo": ["new-blog-ko-rank-kaise-kare-15", "core-web-vitals-hindi", "blogging-step-by-step"],
    "smart-tv": ["tv-remote-broken", "android-16-7", "win-11"],
    "sovereign-cloud-kya-hai-india-guide": [
        "cloud-computing-kya-hai-hindi",
        "aws-cloud-kya-hai-guide",
        "private-llm-enterprise-self-host-guide",
    ],
    "talent-acquisition-kya-hai-guide": ["project-management-tools-guide", "data-science-roadmap-india-hindi"],
    "top-free-ai-websites-in-hindi-2026": [
        "ai-tools-ki-wave-2025-top-free-ai-tools",
        "chatgpt-ai-image-step-by-step",
    ],
    "unit-testing-kya-hai-guide": [
        "ci-cd-pipeline-kya-hai-hindi",
        "git-github-kya-hai-hindi-guide",
        "python-seekhne-ka-roadmap-hindi",
    ],
    "vk-tech-learn-ai-assistant-ai-chatbot": [
        "ai-chatbot-kaise-banayein-hindi",
        "ai-agents-kya-hain-hindi-guide",
    ],
}

STOPWORDS = {
    "क्या", "कैसे", "करें", "करे", "और", "के", "का", "की", "को", "में", "से", "है", "हैं", "नहीं",
    "पूरी", "जानकारी", "अच्छा", "बेहतर", "सही", "नया", "नई", "आप", "करेगा", "करता", "करते", "हिंदी",
    "the", "and", "for", "with", "how", "what", "why", "new", "best", "top", "guide", "tips",
    "your", "you", "this", "that", "hindi", "kya", "kaise", "karein", "kare", "aur", "ke", "ka", "ki",
    "poori", "aasan", "complete", "full", "free", "india", "indian",
    "करने", "करना", "सकते", "सकता", "लिए", "होता", "होती", "होगा", "गया", "गई", "रहा", "रही",
    "बहुत", "साथ", "भी", "पर", "अब", "यह", "वह", "जो", "कि", "ने", "दिया", "किया", "जाता",
    "जाती", "जैसे", "वाले", "बाद", "पहले", "सभी", "कुछ", "इस", "उस", "करता", "करते", "हुई",
    "हुए", "जानें", "जानिए", "बारे", "तरीका", "तरीके", "काम", "करें", "सबसे", "अपने", "अपनी",
}

GENERATED = (
    re.compile(r'[ \t]*<h2 id="post-sources">.*?</ul>\n', re.S),
    re.compile(r'[ \t]*<p class="post-related">.*?</p>\n', re.S),
)


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def title_of(page):
    match = re.search(r"<title>(.*?)</title>", page, re.S)
    return html.unescape(match.group(1)).replace(" — VK Tech Learn", "").strip() if match else ""


def without_generated(page):
    for pattern in GENERATED:
        page = pattern.sub("", page)
    return page


def has_sources(page):
    page = without_generated(page)
    return bool(re.search(r'<h2[^>]*>\s*(स्रोत|Sources)\s*</h2>', page, re.I))


def has_internal(page):
    body = without_generated(page).split('<article class="post-body">')[-1]
    return bool(re.search(r'href="/posts/', body))


def short_title(text, limit=68):
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip(" ,-–—") + "…"


def tokens(text):
    words = re.findall(r"[a-z0-9\u0900-\u097f]{3,}", re.sub(r"#\S+", " ", text.lower()))
    return {word for word in words if word not in STOPWORDS}


def pick_sources(title):
    """Brand pages first (up to two), else the best matching topic page."""
    low = title.lower()
    picked, domains = [], set()
    for pattern, label, url in BRANDS:
        domain = url.split("/")[2]
        if domain in domains or not re.search(pattern, low):
            continue
        picked.append({"label": label, "url": url})
        domains.add(domain)
        if len(picked) == 2:
            break
    if picked:
        return picked
    for pattern, label, url in TOPICS:
        if re.search(pattern, low):
            return [{"label": label, "url": url}]
    return []


def body_text(page):
    """Article text only: no generated block, captions, hashtags or markup."""
    body = without_generated(page).split('<article class="post-body">')[-1].split("</article>")[0]
    body = re.sub(r"<figcaption>.*?</figcaption>", " ", body, flags=re.S)
    return re.sub(r"<[^>]+>", " ", body)


def similarity(a, b, idf):
    shared = a & b
    if not shared:
        return 0.0
    numerator = sum(idf[word] for word in shared)
    denominator = (sum(idf[word] for word in a) * sum(idf[word] for word in b)) ** 0.5
    return numerator / denominator if denominator else 0.0


def related_for(slug, vectors, posts, candidates, idf, title_df):
    """Require a shared specific title word, or a high body similarity."""
    def specific(words):
        return {word for word in words if title_df.get(word, 0) <= 12}

    title_words = specific(tokens(posts[slug]["title"]))
    scored = []
    for other in candidates:
        if other == slug:
            continue
        shared = title_words & specific(tokens(posts[other]["title"]))
        sim = similarity(vectors[slug], vectors[other], idf)
        if not shared and sim < 0.3:
            continue
        scored.append((3 * len(shared) + 4 * sim, other))
    scored.sort(key=lambda item: (-item[0], item[1]))
    picked = [other for _, other in scored[:3]]
    if len(picked) < 3:
        rest = sorted(
            ((similarity(vectors[slug], vectors[other], idf), other) for other in candidates if other != slug),
            key=lambda item: (-item[0], item[1]),
        )
        for sim, other in rest:
            if len(picked) == 3 or sim < 0.24:
                break
            if other not in picked:
                picked.append(other)
    if len(picked) < 2:
        text = (posts[slug]["title"] + " " + posts[slug]["text"][:600]).lower()
        theme = next((key for pattern, key in THEMES if re.search(pattern, text)), "default")
        for other in PILLARS[theme]:
            if len(picked) >= 2:
                break
            if other != slug and other in posts and other not in picked:
                picked.append(other)
    return [{"slug": other, "title": short_title(posts[other]["title"])} for other in picked]


def check_urls(mapping):
    urls = sorted({item["url"] for entry in mapping.values() for item in entry.get("sources", [])})
    bad = []
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    for url in urls:
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                status = response.status
        except Exception as error:  # noqa: BLE001 - report every failure the same way
            status = getattr(error, "code", error)
        # 403/405/429 means the site blocks bots, not that the page is gone.
        print(f"{status} {url}")
        if status not in (200, 403, 405, 429):
            bad.append((url, status))
    print(f"\nchecked {len(urls)} source URLs | not OK: {len(bad)}")
    return bad


def main():
    noindex = set(json.loads(read(FLAGS)).get("noindex", [])) if os.path.exists(FLAGS) else set()
    posts = {}
    for path in sorted(glob.glob(os.path.join(POSTS, "*.html"))):
        slug = os.path.basename(path)[:-5]
        page = read(path)
        title = title_of(page)
        posts[slug] = {
            "title": title,
            "tokens": tokens(title),
            "sources": has_sources(page),
            "internal": has_internal(page),
            "text": body_text(page),
        }

    candidates = [slug for slug in posts if slug not in noindex]
    vectors = {slug: tokens(info["text"] + " " + info["title"]) for slug, info in posts.items()}
    document_frequency = {}
    for vector in vectors.values():
        for word in vector:
            document_frequency[word] = document_frequency.get(word, 0) + 1
    total = len(vectors) or 1
    idf = {word: math.log((1 + total) / (1 + count)) + 1 for word, count in document_frequency.items()}
    title_df = {}
    for info in posts.values():
        for word in tokens(info["title"]):
            title_df[word] = title_df.get(word, 0) + 1
    mapping = {}
    for slug, info in posts.items():
        entry = {}
        if not info["sources"]:
            sources = pick_sources(info["title"])
            if sources:
                entry["sources"] = sources
        if not info["internal"]:
            related = related_for(slug, vectors, posts, candidates, idf, title_df)
            if related:
                entry["related"] = related
        if entry:
            mapping[slug] = entry

    for slug, related in OVERRIDES.items():
        if slug not in posts:
            raise SystemExit(f"OVERRIDES has unknown slug: {slug}")
        unknown = [other for other in related if other not in posts]
        if unknown:
            raise SystemExit(f"OVERRIDES[{slug}] has unknown slugs: {unknown}")
        mapping.setdefault(slug, {})["related"] = [
            {"slug": other, "title": short_title(posts[other]["title"])}
            for other in related
            if other != slug
        ]

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(mapping, handle, ensure_ascii=False, indent=2)

    sources = sum(1 for entry in mapping.values() if entry.get("sources"))
    related = sum(1 for entry in mapping.values() if entry.get("related"))
    print(f"posts touched: {len(mapping)} | with sources: {sources} | with related: {related}")
    if "--check" in sys.argv[1:]:
        check_urls(mapping)


if __name__ == "__main__":
    main()
