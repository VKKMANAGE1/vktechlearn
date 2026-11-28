#!/usr/bin/env python3
"""Build the Courses section: hub, Basic Computer playlist and lesson pages.

Lesson bodies live as HTML fragments in tools/course/lessons/<slug>.html so the
long content is easy to edit. Run this after changing a fragment:

    python3 tools/build_course.py

It writes courses/index.html, courses/basic-computer/index.html and one page per
lesson. tools/build_index_files.py picks the lesson pages up for the sitemap.
"""

import html
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LESSON_DIR = os.path.join(ROOT, "tools", "course", "lessons")
OUT = os.path.join(ROOT, "courses")
SITE = "https://vktechlearn.site"
AUTHOR = "Vïnâý Kúshwâhå"
SOURCE = (
    "https://home.rajasthan.gov.in/content/dam/homeportal/ptsjodhpur/pdf/"
    "StudyMaterial/Basic%20Computer%20Fundamentals%20Merged.pdf"
)
UPDATED = "2026-11-28"

CHAPTERS = [
    (1, "Computer Basics", "कंप्यूटर की बुनियाद — यह क्या है, कैसे विकसित हुआ और अंदर क्या-क्या लगा है।"),
    (2, "Input, Output और Storage Devices", "डेटा अंदर डालने, बाहर निकालने और सेव करने वाले सारे डिवाइस।"),
    (3, "Computer Networking", "LAN से WAN तक नेटवर्क, उसके डिवाइस और IP address की समझ।"),
    (4, "Internet Basics", "इंटरनेट, ईमेल, ब्राउज़र और सर्च इंजन — रोज़मर्रा का इस्तेमाल।"),
    (5, "MS Office का परिचय", "Office suite, MS Word और PowerPoint की पहली जान-पहचान।"),
    (6, "MS Excel के साथ काम", "स्प्रेडशीट, फ़ॉर्मूले, VLOOKUP, चार्ट और Pivot Table।"),
]

LESSONS = [
    ("computer-kya-hai", "Computer क्या है? परिभाषा, विशेषताएँ और कार्य", 1, "कंप्यूटर की सबसे आसान परिभाषा, उसकी विशेषताएँ, चार मुख्य कार्य और रोज़मर्रा के उदाहरण।", 7),
    ("computer-ka-itihas", "Computer का इतिहास और पीढ़ियाँ (Generations)", 1, "Abacus से लेकर AI वाले कंप्यूटर तक का सफ़र और पाँच पीढ़ियों की खासियत।", 7),
    ("computer-ke-prakar", "Computer के प्रकार — Analog, Digital, Hybrid और Size के आधार पर", 1, "कंप्यूटर कितने तरह के होते हैं, Micro से Supercomputer तक का फ़र्क़ और उनका इस्तेमाल।", 6),
    ("computer-hardware", "Computer Hardware — CPU, Motherboard, RAM, ROM और Ports", 1, "कंप्यूटर के अंदर लगे हार्डवेयर हिस्से, उनका काम और खरीदते समय किन बातों पर ध्यान दें।", 8),
    ("computer-software", "Computer Software — System Software और Application Software", 1, "सॉफ्टवेयर के दो बड़े प्रकार, ऑपरेटिंग सिस्टम का काम और आम उदाहरण।", 7),
    ("windows-desktop", "Windows Desktop और File Explorer — पहला Practical", 1, "Start menu, desktop, taskbar, फ़ाइल-फ़ोल्डर, copy-paste और Windows Settings की प्रैक्टिस।", 8),
    ("input-devices", "Input Devices — Keyboard, Mouse, Scanner और बाकी", 2, "डेटा कंप्यूटर में पहुँचाने वाले डिवाइस, उनके बटन और काम का सीधा फ़र्क़।", 6),
    ("output-devices", "Output Devices — Monitor, Printer, Speaker और Projector", 2, "Soft copy और hard copy का फ़र्क़, प्रिंटर के प्रकार और आउटपुट डिवाइस की पहचान।", 6),
    ("storage-devices", "Storage Devices — RAM, ROM, HDD, SSD और Pen Drive", 2, "Primary और secondary memory, volatile vs non-volatile और कौन सा स्टोरेज कब चुनें।", 7),
    ("computer-network-kya-hai", "Computer Network क्या है? LAN, MAN, WAN और Topology", 3, "नेटवर्क की परिभाषा, उसके फ़ायदे, types और star, ring, bus, mesh topology की समझ।", 7),
    ("network-devices", "Network Devices — Hub, Switch, Router, Modem और NIC", 3, "हर नेटवर्क डिवाइस का काम, hub और switch का फ़र्क़ और router घर में क्यों ज़रूरी है।", 7),
    ("ip-address-kya-hai", "IP Address क्या है? IPv4, IPv6, Public और Private IP", 3, "IP address की बनावट, public-private का फ़र्क़, DNS और अपना IP कैसे देखें।", 7),
    ("internet-kya-hai", "Internet क्या है? WWW, ISP और Protocols", 4, "इंटरनेट कैसे चलता है, ISP की भूमिका, WWW का मतलब और HTTP, FTP, SMTP जैसे protocols।", 7),
    ("email-kya-hai", "Email क्या है? ID, Inbox, CC-BCC और सुरक्षा", 4, "ईमेल पता कैसे बनता है, मेल भेजने-पढ़ने का तरीका, attachment और phishing से बचाव।", 6),
    ("browser-search-engine", "Browser और Search Engine — URL से सुरक्षित ब्राउज़िंग तक", 4, "ब्राउज़र के हिस्से, URL की बनावट, सर्च टिप्स, cache-cookies और सुरक्षित ब्राउज़िंग।", 7),
    ("ms-office-kya-hai", "MS Office क्या है? Word, Excel, PowerPoint का परिचय", 5, "Office suite के हिस्से, file formats और किस काम के लिए कौन सा ऐप सही है।", 6),
    ("ms-word-basics", "MS Word Basics — Interface, Ribbon और Formatting", 5, "Word की स्क्रीन, टाइपिंग, फ़ॉर्मेटिंग, page setup, save और print की पूरी शुरुआत।", 8),
    ("ms-powerpoint-basics", "MS PowerPoint Basics — Slides, Views और Presentation", 5, "नई presentation बनाना, slide design, transition, slideshow और क्या न करें।", 7),
    ("ms-excel-basics", "MS Excel Basics — Workbook, Sheet और डेटा एंट्री", 6, "Excel की स्क्रीन, cell, row-column, डेटा टाइप, ऑटोफ़िल और सेव करने का तरीका।", 8),
    ("excel-formulas-functions", "Excel Formulas और Functions — SUM, AVERAGE, IF, COUNT", 6, "फ़ॉर्मूला लिखने का नियम, cell reference, absolute reference और रोज़ काम आने वाले functions।", 8),
    ("excel-vlookup-pivot-table", "Excel VLOOKUP, Sort-Filter, Chart और Pivot Table", 6, "डेटा में से जानकारी निकालना, सॉर्ट-फ़िल्टर, चार्ट बनाना और Pivot Table से रिपोर्ट।", 9),
]

CHAPTER_TITLES = {num: title for num, title, _ in CHAPTERS}
CHAPTER_INTROS = {num: intro for num, _, intro in CHAPTERS}


def esc(text):
    return html.escape(text, quote=True)


def head(title, description, canonical, extra=""):
    return f"""<!doctype html>
<html lang="hi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} — VK Tech Learn</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="VK Tech Learn">
<meta property="og:locale" content="hi_IN">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITE}/img/og-home.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{SITE}/img/og-home.jpg">
<link rel="icon" type="image/png" href="/img/favicon.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Mukta:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/course.css">{extra}
</head>
<body>
<header class="c-head">
  <div class="wrap">
    <a class="brand" href="/">VK <span>TECH</span> LEARN</a>
    <nav aria-label="मुख्य लिंक">
      <a href="/">Home</a>
      <a href="/courses/" aria-current="page">Courses</a>
      <a href="/courses/basic-computer/">Basic Computer</a>
      <a href="/courses/#word">MS Word</a>
      <a href="/courses/#excel">MS Excel</a>
      <a href="/courses/#hacking">Hacking</a>
    </nav>
  </div>
</header>
"""


def foot():
    return f"""
<footer class="c-foot">
  <div class="wrap">
    <span>&copy; 2026 VK Tech Learn &middot; by {AUTHOR}</span>
    <span><a href="/courses/">Courses</a> &middot; <a href="/about.html">About</a> &middot; <a href="/privacy-policy.html">Privacy</a></span>
  </div>
</footer>
</body>
</html>
"""


def course_jsonld(lessons):
    items = []
    for index, (slug, title, chapter, summary, minutes) in enumerate(lessons, 1):
        items.append(
            '{' + f'"@type":"ListItem","position":{index},"name":"{title}",'
            f'"url":"{SITE}/courses/basic-computer/{slug}.html"' + '}'
        )
    return (
        '<script type="application/ld+json">{"@context":"https://schema.org","@graph":['
        '{"@type":"Course","name":"Basic Computer Course in Hindi",'
        f'"description":"Basic Computer Fundamentals का पूरा मुफ़्त कोर्स — कंप्यूटर, हार्डवेयर, नेटवर्किंग, इंटरनेट, MS Word, PowerPoint और Excel।",'
        f'"inLanguage":"hi","url":"{SITE}/courses/basic-computer/",'
        f'"provider":{{"@type":"Organization","name":"VK Tech Learn","url":"{SITE}/"}},'
        f'"hasCourseInstance":{{"@type":"CourseInstance","courseMode":"online","courseWorkload":"PT3H"}}}},'
        '{"@type":"BreadcrumbList","itemListElement":['
        '{"@type":"ListItem","position":1,"name":"Home","item":"' + SITE + '/"},'
        '{"@type":"ListItem","position":2,"name":"Courses","item":"' + SITE + '/courses/"},'
        '{"@type":"ListItem","position":3,"name":"Basic Computer","item":"' + SITE + '/courses/basic-computer/"}]},'
        '{"@type":"ItemList","name":"Basic Computer Course lessons","itemListElement":['
        + ",".join(items) + "]}]}</script>"
    )


def build_hub():
    cards = []
    cards.append(
        """<a class="lesson-row" href="/courses/basic-computer/" style="border-radius:14px;border:1px solid var(--line);background:var(--panel)">
<span class="idx">1</span>
<span><b>Basic Computer Course</b><small>21 लेसन · 6 चैप्टर · Computer Basics से Excel तक</small></span>
<span class="mins">शुरू करें</span></a>"""
    )
    for index, (anchor, name, desc) in enumerate(
        [
            ("word", "MS Word Course", "डॉक्यूमेंट, रिज़्यूमे, लेटर और रिपोर्ट बनाना — स्टेप-बाय-स्टेप।"),
            ("excel", "MS Excel Course", "स्प्रेडशीट, फ़ॉर्मूले, चार्ट और डेटा रिपोर्टिंग।"),
            ("hacking", "Ethical Hacking Course", "सुरक्षा की बुनियाद, phishing, password और safe testing।"),
        ],
        start=2,
    ):
        cards.append(
            f"""<div class="lesson-row soon" id="{anchor}" style="border-radius:14px;border:1px solid var(--line);background:var(--panel)">
<span class="idx">{index}</span>
<span><b>{name}</b><small>{desc}</small></span>
<span class="mins"><span class="badge">जल्द आ रहा है</span></span></div>"""
        )

    body = f"""<main class="wrap">
<div class="crumbs"><a href="/">Home</a><span>/</span>Courses</div>
<section class="c-hero">
  <span class="eyebrow">Free Courses</span>
  <h1>Courses — शुरुआत से सीखें, अपनी भाषा में</h1>
  <p class="lead">हर कोर्स छोटे-छोटे लेसन में बँटा है, जिसे आप क्रम से पढ़ सकते हैं — बिल्कुल playlist की तरह। पहला कोर्स <b>Basic Computer</b> पूरी तरह तैयार है, बाकी कोर्स पर काम चल रहा है।</p>
</section>

<div class="panel">
  <h2>सारे कोर्स</h2>
  <div style="display:grid;gap:.7rem">{''.join(cards)}</div>
</div>

<div class="panel">
  <h2>कैसे पढ़ें?</h2>
  <ol>
    <li>किसी भी कोर्स के पहले लेसन से शुरू करें और एक-एक करके आगे बढ़ें।</li>
    <li>हर लेसन में practical टास्क दिया है — उसे कंप्यूटर पर ज़रूर करके देखें।</li>
    <li>लेसन के नीचे "अगला लेसन" बटन से सीधे आगे जाएँ; बीच में कहीं से भी पढ़ना हो तो कोर्स पेज पर playlist से चुनें।</li>
  </ol>
</div>

<div class="panel">
  <h2>Basic Computer कोर्स के बारे में</h2>
  <p>यह कोर्स <a href="{SOURCE}" rel="nofollow noopener" target="_blank">PTS Jodhpur (Rajasthan सरकार) की Basic Computer Fundamentals study material</a> के syllabus पर आधारित है — उसी क्रम में, पर आसान Hinglish में फिर से लिखा गया है, ताकि नए शुरुआती लोगों को भी समझ आए। पूरा syllabus 6 चैप्टर और 21 लेसन में बाँटा गया है।</p>
  <p><a class="cta" href="/courses/basic-computer/">Basic Computer कोर्स खोलें</a></p>
</div>
</main>
{foot()}"""
    page = head(
        "Courses — Free Computer Courses in Hindi",
        "VK Tech Learn के मुफ़्त कोर्स — Basic Computer (पूरा), MS Word, MS Excel और Ethical Hacking। छोटे लेसन में, आसान Hinglish में।",
        f"{SITE}/courses/",
    ) + body
    write("index.html", page)


def build_course(lessons):
    sections = []
    for num, title, intro in CHAPTERS:
        rows = []
        for index, (slug, name, chapter, summary, minutes) in enumerate(lessons, 1):
            if chapter != num:
                continue
            rows.append(
                f"""<li><a class="lesson-row" href="/courses/basic-computer/{slug}.html">
<span class="idx">{index:02d}</span>
<span><b>{name}</b><small>{summary}</small></span>
<span class="mins">{minutes} मिनट</span></a></li>"""
            )
        count = len(rows)
        sections.append(
            f"""<section class="chapter" id="chapter-{num}">
<div class="chapter-head"><span class="num">CHAPTER {num}</span><h2>{title}</h2><span class="count">{count} लेसन</span></div>
<p style="color:var(--muted);margin-top:-.3rem">{intro}</p>
<ul class="lesson-list">{''.join(rows)}</ul>
</section>"""
        )

    body = f"""<main class="wrap">
<div class="crumbs"><a href="/">Home</a><span>/</span><a href="/courses/">Courses</a><span>/</span>Basic Computer</div>
<section class="c-hero">
  <span class="eyebrow">Course 1 · Beginner</span>
  <h1>Basic Computer Course in Hindi — शुरू से Excel तक</h1>
  <p class="lead">कंप्यूटर क्या है, उसके अंदर क्या लगा है, इंटरनेट और ईमेल कैसे चलते हैं, और MS Word, PowerPoint व Excel में काम कैसे करें — सब कुछ 21 छोटे लेसन में। हर लेसन के बाद एक practical टास्क है, इसलिए सिर्फ़ पढ़ना नहीं, करके सीखना होगा।</p>
  <ul class="chips"><li>21 लेसन</li><li>6 चैप्टर</li><li>~2.5 घंटे</li><li>बिल्कुल मुफ़्त</li><li>Hindi + Hinglish</li></ul>
  <a class="cta" href="/courses/basic-computer/{lessons[0][0]}.html">पहला लेसन शुरू करें</a>
</section>

<div class="panel">
  <h2>इस कोर्स में क्या सीखेंगे</h2>
  <ul class="grid2">
    <li><b>Computer की बुनियाद</b>परिभाषा, इतिहास, प्रकार, हार्डवेयर और सॉफ्टवेयर की पहचान।</li>
    <li><b>Windows चलाना</b>Desktop, फ़ाइल-फ़ोल्डर, copy-paste, settings और शॉर्टकट।</li>
    <li><b>Devices की समझ</b>Input, output और storage डिवाइस — कौन क्या करता है।</li>
    <li><b>Networking</b>LAN/WAN, router-switch, IP address और घर का Wi-Fi नेटवर्क।</li>
    <li><b>Internet और Email</b>ब्राउज़र, सर्च इंजन, ईमेल भेजना और सुरक्षित रहना।</li>
    <li><b>MS Office</b>Word में डॉक्यूमेंट, PowerPoint में presentation, Excel में हिसाब।</li>
  </ul>
</div>

<div class="panel">
  <h2>Playlist — सारे लेसन क्रम से</h2>
  <p style="color:var(--muted)">जहाँ से पढ़ना हो वहाँ क्लिक करें। हर लेसन के अंत में अगले लेसन का बटन भी मिलेगा।</p>
</div>

{''.join(sections)}

<div class="panel">
  <h2>पढ़ने का सही तरीका</h2>
  <ul>
    <li><b>रोज़ एक लेसन:</b> 21 दिन में पूरा कोर्स। जल्दबाज़ी में सब एक दिन में पढ़ने से practical याद नहीं रहता।</li>
    <li><b>साथ में कंप्यूटर:</b> जो लेसन पढ़ें, उसी वक़्त खुद करके देखें — खासकर Windows, Word और Excel वाले लेसन।</li>
    <li><b>नोट्स:</b> हर चैप्टर के बाद 5 लाइन का सारांश अपनी भाषा में लिखें।</li>
    <li><b>शॉर्टकट याद करें:</b> Ctrl+C, Ctrl+V, Ctrl+S, Ctrl+Z जैसे 10 शॉर्टकट गति दोगुनी कर देते हैं।</li>
  </ul>
</div>

<div class="panel">
  <h2>स्रोत और भाषा</h2>
  <p>इस कोर्स का syllabus <a href="{SOURCE}" rel="nofollow noopener" target="_blank">PTS Jodhpur, Rajasthan सरकार — Basic Computer Fundamentals (Merged)</a> study material के 6 चैप्टर पर आधारित है। उस PDF का Hindi text legacy font में है और सीधे कॉपी करने पर अक्षर टूट जाते हैं, इसलिए हर टॉपिक को आसान Hinglish में नए सिरे से लिखा गया है — पढ़ने लायक, बिना रोबोटिक अनुवाद के।</p>
  <p style="color:var(--muted);font-size:.9rem">अगर किसी लेसन में कोई ग़लती दिखे या सवाल हो, <a href="/contact.html">Contact</a> से बताइए — सुधार कर दिया जाएगा।</p>
</div>
</main>
{foot()}"""
    page = head(
        "Basic Computer Course in Hindi — 21 Free Lessons",
        "Basic Computer का पूरा मुफ़्त कोर्स — कंप्यूटर बेसिक्स, हार्डवेयर, नेटवर्किंग, इंटरनेट, MS Word, PowerPoint और Excel, 21 आसान Hinglish लेसन में।",
        f"{SITE}/courses/basic-computer/",
        course_jsonld(lessons),
    ) + body
    write("basic-computer/index.html", page)


def build_lesson(index, lessons):
    slug, title, chapter, summary, minutes = lessons[index - 1]
    body_path = os.path.join(LESSON_DIR, slug + ".html")
    with open(body_path, encoding="utf-8") as handle:
        article = handle.read().strip()

    prev_link = '<span class="empty"></span>'
    next_link = '<span class="empty"></span>'
    if index > 1:
        pslug, ptitle = lessons[index - 2][0], lessons[index - 2][1]
        prev_link = f'<a class="prev" href="/courses/basic-computer/{pslug}.html"><small>← पिछला लेसन</small><b>{ptitle}</b></a>'
    if index < len(lessons):
        nslug, ntitle = lessons[index][0], lessons[index][1]
        next_link = f'<a class="next" href="/courses/basic-computer/{nslug}.html"><small>अगला लेसन →</small><b>{ntitle}</b></a>'

    percent = round(index * 100 / len(lessons))
    jsonld = (
        '<script type="application/ld+json">{"@context":"https://schema.org","@graph":['
        '{"@type":"Article","headline":"' + title.replace('"', '\\"') + '",'
        f'"description":"{summary}","inLanguage":"hi","url":"{SITE}/courses/basic-computer/{slug}.html",'
        f'"author":{{"@type":"Person","name":"{AUTHOR}","url":"{SITE}/about.html"}},'
        f'"publisher":{{"@type":"Organization","name":"VK Tech Learn","url":"{SITE}/"}},'
        f'"isPartOf":{{"@type":"Course","name":"Basic Computer Course in Hindi","url":"{SITE}/courses/basic-computer/"}}}},'
        '{"@type":"BreadcrumbList","itemListElement":['
        '{"@type":"ListItem","position":1,"name":"Home","item":"' + SITE + '/"},'
        '{"@type":"ListItem","position":2,"name":"Courses","item":"' + SITE + '/courses/"},'
        '{"@type":"ListItem","position":3,"name":"Basic Computer","item":"' + SITE + '/courses/basic-computer/"},'
        '{"@type":"ListItem","position":4,"name":"' + title.replace('"', '\\"') + '","item":"' + SITE + f'/courses/basic-computer/{slug}.html"}}]}}]}}</script>'
    )

    page = head(title, summary, f"{SITE}/courses/basic-computer/{slug}.html", jsonld) + f"""
<main class="wrap">
<div class="crumbs"><a href="/">Home</a><span>/</span><a href="/courses/">Courses</a><span>/</span><a href="/courses/basic-computer/">Basic Computer</a><span>/</span>लेसन {index}</div>
<header class="lesson-head">
  <span class="badge">Chapter {chapter} · {CHAPTER_TITLES[chapter]}</span>
  <h1>{title}</h1>
  <div class="lesson-meta"><span>लेसन {index} / {len(lessons)}</span><span>·</span><span>~{minutes} मिनट</span><span>·</span><span>by {AUTHOR}</span></div>
  <div class="progress" aria-hidden="true"><i style="width:{percent}%"></i></div>
</header>
<article class="lesson-body">
{article}
<div class="source-note">इस लेसन का विषय <a href="{SOURCE}" rel="nofollow noopener" target="_blank">PTS Jodhpur — Basic Computer Fundamentals, Chapter {chapter}</a> से लिया गया है। भाषा और उदाहरण आसान Hinglish में नए सिरे से लिखे गए हैं।</div>
</article>
<nav class="pager" aria-label="लेसन नेविगेशन">{prev_link}{next_link}</nav>
</main>
{foot()}"""
    write(f"basic-computer/{slug}.html", page)


def write(relative, content):
    path = os.path.join(OUT, relative)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)


def main():
    missing = [items[0] for items in LESSONS if not os.path.exists(os.path.join(LESSON_DIR, items[0] + ".html"))]
    if missing:
        raise SystemExit("missing lesson fragments: " + ", ".join(missing))
    build_hub()
    build_course(LESSONS)
    for index in range(1, len(LESSONS) + 1):
        build_lesson(index, LESSONS)
    print(f"courses built: hub + course page + {len(LESSONS)} lessons")


if __name__ == "__main__":
    main()
