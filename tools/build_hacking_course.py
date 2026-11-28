#!/usr/bin/env python3
"""Build the Ethical Hacking with Python course (playlist + lessons + chapter tests).

Lesson bodies live in tools/course/hacking_lessons/<slug>.html and the chapter
tests in tools/course/hacking_quizzes/chapter-N.json. Run:

    python3 tools/build_hacking_course.py
"""

import html
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LESSON_DIR = os.path.join(ROOT, "tools", "course", "hacking_lessons")
QUIZ_DIR = os.path.join(ROOT, "tools", "course", "hacking_quizzes")
OUT = os.path.join(ROOT, "courses", "ethical-hacking")
SITE = "https://vktechlearn.site"
AUTHOR = "Vïnâý Kúshwâhå"

CHAPTERS = [
    (1, "Ethical Hacking का परिचय", "White hat hacking क्या है, इसकी ज़रूरत और अपना सुरक्षित lab कैसे बनाएँ।", "hack1.jpg", "लैपटॉप पर काम करता hacker, ऊपर shield और padlock"),
    (2, "Python Basics for Hacking", "Python की बुनियाद — variables, loops, functions और security कामों के लिए scripts।", "hack2.jpg", "कोड और terminal दिखाता लैपटॉप, Python जैसा curve और gears"),
    (3, "Reconnaissance और Information Gathering", "Target के बारे में जानकारी जुटाना — passive से active scanning तक।", "hack3.jpg", "नेटवर्क नक्शे पर magnifying glass, WHOIS और DNS दस्तावेज़"),
    (4, "Exploitation Techniques", "Vulnerability जाँचना, buffer overflow समझना और web app की कमज़ोरियाँ।", "hack4.jpg", "टूटा padlock, चाबी और चेतावनी त्रिकोण"),
    (5, "Password Cracking और Wireless Hacking", "Brute force, dictionary attack, hash और Wi-Fi सुरक्षा की मूल बातें।", "hack5.jpg", "कीबोर्ड पर padlock, hash अंक, dictionary और घड़ी"),
    (6, "Malware Analysis और Reverse Engineering", "Malware के प्रकार, sandbox में जाँच और Python code पढ़ना।", "hack7.jpg", "Glass sandbox में bug, microscope और code brackets"),
    (7, "Network Security और Defense", "Python से IDS, network hardening और incident response।", "hack8.jpg", "Network diagram के ऊपर shield और monitoring graph"),
    (8, "Social Engineering और Python", "Phishing, मानवीय कमज़ोरी और उससे बचाव के तरीके।", "hack9.jpg", "Email envelope को खींचता fish hook और चेतावनी"),
    (9, "Advanced Python Techniques", "Pentest workflow, custom framework और automation।", "hack10.jpg", "Terminal के चारों ओर जुड़े modular blocks और gears"),
    (10, "Ethics, Law और Reporting", "Permission, scope, कानूनी सीमाएँ और professional report लिखना।", "hack11.jpg", "Laptop के पास न्याय की तराज़ू और checkmark वाला document"),
]

LESSONS = [
    ("ethical-hacking-kya-hai", "Ethical Hacking क्या है? White Hat, Black Hat और Grey Hat", 1, "Ethical hacking की परिभाषा, इसके फ़ायदे और white, black, grey hat hackers में फ़र्क़।", 6),
    ("hacking-lab-setup", "अपना Hacking Lab सेट करना — Kali Linux और Virtual Machine", 1, "Safe practice के लिए virtual lab, Kali Linux, Python और alag network बनाने का तरीका।", 7),
    ("python-basics-hacking", "Hacking के लिए Python Basics — Data Types से Functions तक", 2, "Variables, loops, conditions और functions — security scripts में कहाँ काम आते हैं।", 7),
    ("python-scripts-automation", "Python Scripts लिखना और काम Automate करना", 2, "Script चलाने का तरीका, files पढ़ना, requests से data लेना और छोटे tools बनाना।", 6),
    ("reconnaissance-kya-hai", "Reconnaissance क्या है? Passive और Active जानकारी जुटाना", 3, "Hacking lifecycle में recon की जगह, OSINT, WHOIS, DNS और public जानकारी का इस्तेमाल।", 6),
    ("python-recon-tools", "Python से Recon — WHOIS, DNS और Port Scanning", 3, "socket, requests और nmap जैसे tools से जानकारी जुटाने की सुरक्षित practice।", 7),
    ("vulnerability-assessment", "Vulnerability Assessment और Exploit की बुनियाद", 4, "CVE, CVSS, buffer overflow का concept और authorized testing में exploit का इस्तेमाल।", 7),
    ("web-exploits-python", "Web Application की कमज़ोरियाँ — SQL Injection, XSS, CSRF", 4, "तीन आम web flaws कैसे काम करते हैं और Python से उन्हें test करने का तरीका।", 7),
    ("password-cracking-basics", "Password Cracking — Brute Force, Dictionary और Hashing", 5, "Hash क्या है, strong password कैसे बनता है और cracking से बचाव कैसे होता है।", 6),
    ("wifi-hacking-basics", "Wi-Fi Security — WPA2, WPA3 और Wireless Testing", 5, "Wi-Fi सुरक्षा के प्रकार, handshake का मतलब और अपने नेटवर्क की जाँच कैसे करें।", 7),
    ("malware-kya-hai", "Malware क्या है? Virus, Worm, Trojan, Ransomware", 6, "Malware के प्रकार, उनका व्यवहार और ethical hacking में malware analysis की भूमिका।", 6),
    ("malware-analysis-python", "Python से Malware Analysis और Reverse Engineering", 6, "Sandbox में sample जाँचना, strings और imports पढ़ना, obfuscation पहचानना — बिना code चलाए।", 7),
    ("ids-python", "Python से Intrusion Detection System (IDS) बनाना", 7, "Traffic monitor करना, suspicious pattern पकड़ना और alert generate करना।", 7),
    ("network-hardening", "Network Hardening और Incident Response", 7, "Firewall नियम, patch management, logging और incident के बाद forensic data जुटाना।", 7),
    ("social-engineering", "Social Engineering — मानवीय कमज़ोरी को समझना", 8, "Phishing, pretexting, baiting कैसे काम करते हैं और कर्मचारी कैसे बच सकते हैं।", 6),
    ("phishing-simulation", "Phishing Simulation और Countermeasures", 8, "अनुमति वाले awareness अभियान, ईमेल indicators और Python से detection tool।", 6),
    ("pentest-workflow", "Penetration Testing Workflow — शुरू से Report तक", 9, "Scoping, testing, evidence, cleanup और report — पूरा professional workflow।", 7),
    ("custom-hacking-framework", "Python से अपना Hacking Framework बनाना", 9, "Modules, CLI, logging और safe defaults वाला reusable framework का ढाँचा।", 7),
    ("legal-boundaries", "कानूनी सीमाएँ — Permission, Scope और IT Act", 10, "लिखित अनुमति, scope definition, India का IT Act और ग़लत scope के नतीजे।", 7),
    ("reporting-documentation", "Report लिखना, Documentation और Career", 10, "Finding को severity के साथ लिखना, remediation सुझाना और cybersecurity में करियर।", 7),
]

CHAPTER_TITLE = {num: title for num, title, _, _, _ in CHAPTERS}
CHAPTER_INTRO = {num: intro for num, _, intro, _, _ in CHAPTERS}
CHAPTER_IMG = {num: (img, alt) for num, _, _, img, alt in CHAPTERS}

# Two lessons share chapter 5; the wireless lesson gets its own artwork.
LESSON_IMG = {"wifi-hacking-basics": ("hack6.jpg", "Wi-Fi router, लैपटॉप और मोबाइल जुड़े हुए, सिग्नल पर lock")}


def esc(text):
    return html.escape(text, quote=True)


def figure(num, slug=None, css="fig"):
    img, alt = LESSON_IMG.get(slug, CHAPTER_IMG[num])
    return (
        f'<figure class="{css}"><img src="/img/courses/{img}" alt="{alt}" width="1200" height="648" loading="lazy" decoding="async">'
        f'<figcaption>{alt} — Chapter {num}: {CHAPTER_TITLE[num]}</figcaption></figure>'
    )


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
<meta property="og:image" content="{SITE}/img/courses/hack1.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{SITE}/img/courses/hack1.jpg">
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
      <a href="/courses/ethical-hacking/">Ethical Hacking</a>
      <a href="/courses/#excel">MS Excel</a>
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


def build_course():
    sections = []
    for num, title, intro, _, _ in CHAPTERS:
        rows = []
        for index, (slug, name, chapter, summary, minutes) in enumerate(LESSONS, 1):
            if chapter != num:
                continue
            rows.append(
                f"""<li><a class="lesson-row" href="/courses/ethical-hacking/{slug}.html">
<span class="idx">{index:02d}</span>
<span><b>{name}</b><small>{summary}</small></span>
<span class="mins">{minutes} मिनट</span></a></li>"""
            )
        sections.append(
            f"""<section class="chapter" id="chapter-{num}">
<div class="chapter-head"><span class="num">CHAPTER {num}</span><h2>{title}</h2><span class="count">{len(rows)} लेसन</span></div>
<p style="color:var(--muted);margin-top:-.3rem">{intro}</p>
{figure(num, css="fig")}
<ul class="lesson-list">{''.join(rows)}</ul>
<p class="quiz-cta"><a class="cta ghost" href="/courses/ethical-hacking/quiz-chapter-{num}.html">Chapter {num} टेस्ट — 20 सवाल</a></p>
</section>"""
        )

    tests_nav = "".join(
        f'<li><a href="/courses/ethical-hacking/quiz-chapter-{num}.html"><b>Chapter {num}</b>'
        f'<small>{title} · 20 सवाल</small></a></li>'
        for num, title, _, _, _ in CHAPTERS
    )

    jsonld = (
        '<script type="application/ld+json">{"@context":"https://schema.org","@graph":['
        '{"@type":"Course","name":"Ethical Hacking with Python Course in Hindi",'
        '"description":"Ethical hacking ki buniyad, Python scripting, reconnaissance, exploitation, password aur wireless testing, malware analysis aur reporting — 20 lessons aur 10 chapter tests.",'
        f'"inLanguage":"hi","url":"{SITE}/courses/ethical-hacking/",'
        f'"provider":{{"@type":"Organization","name":"VK Tech Learn","url":"{SITE}/"}},'
        '"hasCourseInstance":{"@type":"CourseInstance","courseMode":"online","courseWorkload":"PT3H"}},'
        '{"@type":"BreadcrumbList","itemListElement":['
        '{"@type":"ListItem","position":1,"name":"Home","item":"' + SITE + '/"},'
        '{"@type":"ListItem","position":2,"name":"Courses","item":"' + SITE + '/courses/"},'
        '{"@type":"ListItem","position":3,"name":"Ethical Hacking","item":"' + SITE + '/courses/ethical-hacking/"}]}]}</script>'
    )

    body = f"""<main class="wrap">
<div class="crumbs"><a href="/">Home</a><span>/</span><a href="/courses/">Courses</a><span>/</span>Ethical Hacking</div>
<section class="c-hero">
  <span class="eyebrow">Course 2 · Beginner</span>
  <h1>Ethical Hacking with Python — पूरा मुफ़्त कोर्स (Hindi)</h1>
  <p class="lead">कानूनी और ethical तरीके से security testing सीखें — white hat hacking की बुनियाद, Python scripting, information gathering, web vulnerabilities, password और Wi-Fi सुरक्षा, malware analysis, defense और report लिखना। हर लेसन practical सोच के साथ, और हर चैप्टर के बाद 20 सवालों का टेस्ट।</p>
  <ul class="chips"><li>20 लेसन</li><li>10 चैप्टर</li><li>10 टेस्ट</li><li>~2.5 घंटे</li><li>बिल्कुल मुफ़्त</li></ul>
  <a class="cta" href="/courses/ethical-hacking/{LESSONS[0][0]}.html">पहला लेसन शुरू करें</a>
  {figure(1, css="fig")}
</section>

<div class="panel">
  <h2>⚠️ पहले यह पढ़ें — सिर्फ़ अनुमति के साथ</h2>
  <p>यह कोर्स सिर्फ़ <b>अपने सिस्टम, अपने lab या जिन पर लिखित अनुमति हो</b> उन पर testing के लिए है। बिना अनुमति किसी दूसरे के नेटवर्क, वेबसाइट, Wi-Fi या डिवाइस पर scanning या attack करना भारत में IT Act जैसे कानूनों के तहत अपराध है — जुर्माना और जेल दोनों हो सकते हैं। यहाँ हर technique ethical और defensive समझ के लिए समझाई गई है, किसी को नुक़सान पहुँचाने के लिए नहीं।</p>
</div>

<div class="panel">
  <h2>इस कोर्स में क्या सीखेंगे</h2>
  <ul class="grid2">
    <li><b>Ethical hacking की बुनियाद</b>White hat, scope, permission और lab setup।</li>
    <li><b>Python for security</b>Scripts, sockets, requests और automation।</li>
    <li><b>Recon और scanning</b>OSINT, WHOIS, DNS और port जानकारी।</li>
    <li><b>Vulnerabilities</b>SQL injection, XSS, CSRF और exploit की सोच।</li>
    <li><b>Passwords और Wi-Fi</b>Hashing, brute force और WPA2/WPA3 सुरक्षा।</li>
    <li><b>Defense और report</b>IDS, hardening, incident response और legal reporting।</li>
  </ul>
</div>

<div class="panel">
  <h2>Playlist — सारे लेसन क्रम से</h2>
  <p style="color:var(--muted)">जहाँ से पढ़ना हो वहाँ क्लिक करें। हर लेसन के अंत में अगला लेसन और हर चैप्टर के बाद 20 सवालों का टेस्ट मिलेगा।</p>
</div>

{''.join(sections)}

<div class="panel">
  <h2>Chapter टेस्ट — हर चैप्टर के 20 सवाल</h2>
  <p style="color:var(--muted)">हर चैप्टर के बाद 20 सवालों का टेस्ट है। पहले खुद जवाब दें, फिर अंत में दी उत्तर-कुंजी से जाँचें।</p>
  <ul class="test-grid">{tests_nav}</ul>
</div>

<div class="panel">
  <h2>कैसे पढ़ें</h2>
  <ul>
    <li><b>एक लेसन रोज़:</b> 20 दिन में पूरा कोर्स; जल्दबाज़ी में practical याद नहीं रहता।</li>
    <li><b>Virtual lab में:</b> Kali Linux को VM में चलाएँ, host machine पर सीधे experiment न करें।</li>
    <li><b>हर चैप्टर का टेस्ट:</b> 16+ सही मतलब चैप्टर समझ आ गया; कम हो तो लेसन दोबारा पढ़ें।</li>
    <li><b>नोट्स:</b> हर script और उसके output को अपनी भाषा में लिखें।</li>
  </ul>
</div>
</main>
{foot()}"""
    write(
        "index.html",
        head(
            "Ethical Hacking with Python Course in Hindi — 20 Free Lessons",
            "Ethical hacking सीखें Python के साथ — 20 लेसन, 10 चैप्टर और 10 टेस्ट में। Recon, web vulnerabilities, password, Wi-Fi, malware analysis और defense, आसान Hinglish में।",
            f"{SITE}/courses/ethical-hacking/",
            jsonld,
        )
        + body,
    )


def build_lesson(index):
    slug, title, chapter, summary, minutes = LESSONS[index - 1]
    with open(os.path.join(LESSON_DIR, slug + ".html"), encoding="utf-8") as handle:
        article = handle.read().strip()

    prev_link = '<span class="empty"></span>'
    next_link = '<span class="empty"></span>'
    if index > 1:
        pslug, ptitle = LESSONS[index - 2][0], LESSONS[index - 2][1]
        prev_link = f'<a class="prev" href="/courses/ethical-hacking/{pslug}.html"><small>← पिछला लेसन</small><b>{ptitle}</b></a>'
    if index < len(LESSONS):
        nslug, ntitle = LESSONS[index][0], LESSONS[index][1]
        next_link = f'<a class="next" href="/courses/ethical-hacking/{nslug}.html"><small>अगला लेसन →</small><b>{ntitle}</b></a>'

    page = head(title, summary, f"{SITE}/courses/ethical-hacking/{slug}.html") + f"""
<main class="wrap">
<div class="crumbs"><a href="/">Home</a><span>/</span><a href="/courses/">Courses</a><span>/</span><a href="/courses/ethical-hacking/">Ethical Hacking</a><span>/</span>लेसन {index}</div>
<header class="lesson-head">
  <span class="badge">Chapter {chapter} · {CHAPTER_TITLE[chapter]}</span>
  <h1>{title}</h1>
  <div class="lesson-meta"><span>लेसन {index} / {len(LESSONS)}</span><span>·</span><span>~{minutes} मिनट</span><span>·</span><span>by {AUTHOR}</span></div>
  <div class="progress" aria-hidden="true"><i style="width:{round(index * 100 / len(LESSONS))}%"></i></div>
</header>
<article class="lesson-body">
{figure(chapter, slug)}
{article}
</article>
<nav class="pager" aria-label="लेसन नेविगेशन">{prev_link}{next_link}</nav>
</main>
{foot()}"""
    write(f"{slug}.html", page)


def build_quiz(num):
    with open(os.path.join(QUIZ_DIR, f"chapter-{num}.json"), encoding="utf-8") as handle:
        questions = json.load(handle)["questions"]

    items, answers = [], []
    for index, question in enumerate(questions, 1):
        options = "".join(
            '<li><label><input type="radio" name="q{}:{}" value="{}"><span class="opt-key">{})</span> {}</label></li>'.format(
                num, index, i, "abcd"[i], esc(option)
            )
            for i, option in enumerate(question["options"])
        )
        correct = esc(question["options"][question["answer"]])
        items.append(
            f'<li data-answer="{question["answer"]}"><p>{esc(question["q"])}</p>'
            f'<ol class="q-options">{options}</ol>'
            f'<div class="quiz-explain" hidden><b>सही उत्तर: {correct}</b> — {esc(question["why"])}</div></li>'
        )
    for index, question in enumerate(questions, 1):
        letter = "abcd"[question["answer"]]
        answers.append(
            f'<li><b>Q{index} — ({letter})</b> {esc(question["options"][question["answer"]])}'
            f'<br><span style="color:var(--muted)">{esc(question["why"])}</span></li>'
        )

    prev_link = '<span class="empty"></span>'
    next_link = '<a class="next" href="/courses/ethical-hacking/"><small>कोर्स पर वापस</small><b>Ethical Hacking playlist</b></a>'
    if num > 1:
        prev_link = f'<a class="prev" href="/courses/ethical-hacking/quiz-chapter-{num-1}.html"><small>← पिछला टेस्ट</small><b>Chapter {num-1} टेस्ट</b></a>'
    if num < len(CHAPTERS):
        next_link = f'<a class="next" href="/courses/ethical-hacking/quiz-chapter-{num+1}.html"><small>अगला टेस्ट →</small><b>Chapter {num+1} टेस्ट</b></a>'

    page = head(
        f"Chapter {num} टेस्ट — 20 सवाल ({CHAPTER_TITLE[num]})",
        f"{CHAPTER_TITLE[num]} पर 20 MCQs का मुफ़्त टेस्ट, उत्तर और छोटी व्याख्या अंत में। Ethical Hacking कोर्स, Chapter {num}।",
        f"{SITE}/courses/ethical-hacking/quiz-chapter-{num}.html",
    ) + f"""
<main class="wrap">
<div class="crumbs"><a href="/">Home</a><span>/</span><a href="/courses/">Courses</a><span>/</span><a href="/courses/ethical-hacking/">Ethical Hacking</a><span>/</span>Chapter {num} टेस्ट</div>
<header class="lesson-head">
  <span class="badge">Chapter {num} · {CHAPTER_TITLE[num]}</span>
  <h1>Chapter {num} टेस्ट — 20 सवाल</h1>
  <div class="lesson-meta"><span>20 प्रश्न</span><span>·</span><span>हर सवाल 1 अंक</span><span>·</span><span>उत्तर अंत में</span></div>
</header>
<p class="quiz-note">हर सवाल का एक विकल्प चुनें और नीचे <b>जवाब जमा करें</b> दबाएँ — स्कोर और हर सवाल की व्याख्या तुरंत दिखेगी। 16 या ज़्यादा सही मतलब चैप्टर ठीक से समझ आ गया है।</p>
<form class="quiz-form" novalidate>
<ol class="quiz">{''.join(items)}</ol>
<div class="quiz-actions">
  <button class="cta" type="submit">जवाब जमा करें</button>
  <button class="cta ghost" type="reset" hidden>फिर से करें</button>
  <span class="quiz-count" aria-live="polite">0 / {len(questions)} चुने</span>
</div>
<div class="quiz-result" hidden tabindex="-1"></div>
</form>
<details class="answer-key-box" id="answers">
  <summary>उत्तर-कुंजी — सभी {len(questions)}</summary>
  <ol class="answer-key">{''.join(answers)}</ol>
</details>
<nav class="pager" aria-label="टेस्ट नेविगेशन">{prev_link}{next_link}</nav>
<p class="quiz-note">इस चैप्टर के लेसन फिर देखने हों तो <a href="/courses/ethical-hacking/#chapter-{num}">Chapter {num} की playlist</a> खोलें।</p>
<script src="/quiz.js" defer></script>
</main>
{foot()}"""
    write(f"quiz-chapter-{num}.html", page)


def write(relative, content):
    path = os.path.join(OUT, relative)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)


def main():
    missing = [slug for slug, *_ in LESSONS if not os.path.exists(os.path.join(LESSON_DIR, slug + ".html"))]
    if missing:
        raise SystemExit("missing lesson fragments: " + ", ".join(missing))
    build_course()
    for index in range(1, len(LESSONS) + 1):
        build_lesson(index)
    for num, *_ in CHAPTERS:
        build_quiz(num)
    print(f"hacking course built: course page + {len(LESSONS)} lessons + {len(CHAPTERS)} tests")


if __name__ == "__main__":
    main()
