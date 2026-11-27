#!/usr/bin/env python3
"""Draw branded in-body diagrams for posts (dark navy + neon cyan, 1392x752).

Text is rendered locally so labels are always spelled correctly, unlike
image-model output. Usage:

    python3 tools/gen_diagram.py              # every spec below
    python3 tools/gen_diagram.py slug-one     # only specs whose out contains it
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "img", "posts")
def _font_dir():
    local = os.path.join(ROOT, "tools", "fonts")
    if os.path.exists(os.path.join(local, "DejaVuSans-Bold.ttf")):
        return local
    try:
        import matplotlib
        cand = os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")
        if os.path.exists(os.path.join(cand, "DejaVuSans-Bold.ttf")):
            return cand
    except Exception:
        pass
    return "/opt/freestyle/python/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf"


FONTS = _font_dir()
S = 2  # supersample factor
W, H = 1392, 752

BG = (7, 12, 22)
CARD = (12, 21, 36)
CYAN = (0, 229, 255)
VIOLET = (160, 107, 255)
TEXT = (219, 230, 245)
MUTED = (127, 151, 181)


def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(os.path.join(FONTS, name), size * S)


def tracked(draw, xy, text, f, fill, tracking=2 * S):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking
    return x


def wrap(draw, text, f, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=f) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def base_canvas():
    img = Image.new("RGB", (W * S, H * S), BG)
    d = ImageDraw.Draw(img, "RGBA")
    step = 56 * S
    for x in range(-H * S, W * S, step):
        d.line([(x, 0), (x + H * S, H * S)], fill=(255, 255, 255, 7), width=1)
    for y in range(0, H * S, step):
        d.line([(0, y), (W * S, y)], fill=(255, 255, 255, 5), width=1)
    # soft cyan glow bottom-right
    glow = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * S * 0.55, H * S * 0.45, W * S * 1.15, H * S * 1.15], fill=(0, 180, 220, 46))
    glow = glow.filter(ImageFilter.GaussianBlur(140 * S // 2))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    return img, ImageDraw.Draw(img, "RGBA")


def rounded(d, box, radius, fill=None, outline=None, width=2 * S):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def card(img, d, box, radius=22 * S):
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle(box, radius=radius, fill=(0, 229, 255, 46))
    glow = glow.filter(ImageFilter.GaussianBlur(18 * S))
    img.alpha_composite(glow) if img.mode == "RGBA" else img.paste(
        Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB"), (0, 0)
    )
    d = ImageDraw.Draw(img, "RGBA")
    rounded(d, box, radius, fill=CARD + (255,), outline=(0, 229, 255, 150), width=int(1.6 * S))
    return d


def arrow(d, x1, y1, x2, y2, color=CYAN, width=3 * S):
    d.line([(x1, y1), (x2, y2)], fill=color + (220,), width=width)
    head = 10 * S
    if abs(x2 - x1) >= abs(y2 - y1):
        sign = 1 if x2 > x1 else -1
        d.polygon([(x2, y2), (x2 - sign * head, y2 - head // 2), (x2 - sign * head, y2 + head // 2)], fill=color + (255,))
    else:
        sign = 1 if y2 > y1 else -1
        d.polygon([(x1 if False else x2, y2), (x2 - head // 2, y2 - sign * head), (x2 + head // 2, y2 - sign * head)], fill=color + (255,))


def header(img, d, spec):
    kicker_f = font(19, True)
    tracked(d, (70 * S, 62 * S), spec.get("kicker", "").upper(), kicker_f, CYAN, tracking=4 * S)
    title_f = font(40, True)
    y = 100 * S
    for line in wrap(d, spec["title"], title_f, (W - 140) * S):
        d.text((70 * S, y), line, font=title_f, fill=(244, 248, 255))
        y += 52 * S
    if spec.get("sub"):
        sub_f = font(21)
        for line in wrap(d, spec["sub"], sub_f, (W - 160) * S):
            d.text((70 * S, y + 6 * S), line, font=sub_f, fill=MUTED)
            y += 28 * S
    return y


def draw_cards(img, spec):
    d = ImageDraw.Draw(img, "RGBA")
    top = header(img, d, spec)
    cards = spec["cards"]
    n = len(cards)
    gapx = 44 * S if n > 2 else 70 * S
    x0, x1 = 70 * S, (W - 70) * S
    cw = (x1 - x0 - gapx * (n - 1)) / n
    cy = max(top + 46 * S, 300 * S)
    ch = 300 * S if n > 2 else 260 * S
    if cy + ch > 660 * S:
        cy = 660 * S - ch
    centers = []
    for i, c in enumerate(cards):
        bx = x0 + i * (cw + gapx)
        box = [bx, cy, bx + cw, cy + ch]
        d = card(img, d, box)
        accent = VIOLET if c.get("accent") == "violet" else CYAN
        # number badge
        r = 20 * S
        d.ellipse([bx + 22 * S, cy + 22 * S, bx + 22 * S + 2 * r, cy + 22 * S + 2 * r],
                  fill=accent + (36,), outline=accent + (210,), width=int(1.6 * S))
        bf = font(19, True)
        label = str(i + 1)
        tw = d.textlength(label, font=bf)
        d.text((bx + 22 * S + r - tw / 2, cy + 22 * S + r - 14 * S), label, font=bf, fill=(245, 250, 255))
        head_f = font(22, True)
        ty = cy + 76 * S
        for line in wrap(d, c["head"], head_f, cw - 44 * S):
            d.text((bx + 22 * S, ty), line, font=head_f, fill=TEXT)
            ty += 30 * S
        ty += 12 * S
        line_f = font(19)
        for item in c.get("lines", []):
            for j, line in enumerate(wrap(d, item, line_f, cw - 58 * S)):
                if j == 0:
                    d.ellipse([bx + 24 * S, ty + 9 * S, bx + 32 * S, ty + 17 * S], fill=accent + (230,))
                d.text((bx + 44 * S, ty), line, font=line_f, fill=(196, 212, 232))
                ty += 26 * S
            ty += 4 * S
        centers.append((bx + cw, cy + ch / 2))
    for i in range(n - 1):
        ax = centers[i][0] + 8 * S
        bx = x0 + (i + 1) * (cw + gapx)
        arrow(d, ax, centers[i][1], bx - 8 * S, centers[i][1])
    if spec.get("foot"):
        f = font(18)
        d.text((70 * S, (H - 62) * S), spec["foot"], font=f, fill=MUTED)


def draw_flow(img, spec):
    """Vertical pipeline: nodes stacked, arrows between, notes on the right."""
    d = ImageDraw.Draw(img, "RGBA")
    top = header(img, d, spec)
    nodes = spec["nodes"]
    n = len(nodes)
    x0, w = 70 * S, 470 * S
    avail = (H - 70) * S - (top + 32 * S)
    gap = (avail - n * 74 * S) / max(n - 1, 1)
    y = top + 32 * S
    for i, node in enumerate(nodes):
        box = [x0, y, x0 + w, y + 74 * S]
        d = card(img, d, box, radius=14 * S)
        f = font(21, True)
        d.text((x0 + 24 * S, y + 14 * S), node["label"], font=f, fill=(240, 248, 255))
        if node.get("sub"):
            sf = font(17)
            d.text((x0 + 24 * S, y + 44 * S), node["sub"], font=sf, fill=MUTED)
        if node.get("note"):
            nf = font(19)
            for j, line in enumerate(wrap(d, node["note"], nf, (W - 640) * S)):
                d.text((x0 + w + 44 * S, y + 20 * S + j * 26 * S), line, font=nf, fill=(196, 212, 232))
        if i < n - 1:
            arrow(d, x0 + w / 2, y + 76 * S, x0 + w / 2, y + gap + 72 * S - 6 * S)
        y += 74 * S + gap
    if spec.get("foot"):
        f = font(18)
        d.text((70 * S, (H - 40) * S), spec["foot"], font=f, fill=MUTED)


def draw_scale(img, spec):
    """Two panes side by side, each with a little bar chart of capacity."""
    d = ImageDraw.Draw(img, "RGBA")
    top = header(img, d, spec)
    panes = spec["panes"]
    n = len(panes)
    gap = 50 * S
    x0, x1 = 70 * S, (W - 70) * S
    pw = (x1 - x0 - gap * (n - 1)) / n
    py = max(top + 40 * S, 280 * S)
    ph = min(320 * S, (H - 100) * S - py)
    for i, p in enumerate(panes):
        bx = x0 + i * (pw + gap)
        d = card(img, d, [bx, py, bx + pw, py + ph])
        accent = VIOLET if p.get("accent") == "violet" else CYAN
        f = font(25, True)
        d.text((bx + 28 * S, py + 24 * S), p["head"], font=f, fill=(244, 248, 255))
        sf = font(18)
        y = py + 66 * S
        for line in p.get("lines", []):
            for ln in wrap(d, line, sf, pw - 56 * S):
                d.text((bx + 28 * S, y), ln, font=sf, fill=(196, 212, 232))
                y += 24 * S
        # capacity bars
        bars = p.get("bars", [])
        if bars:
            bx0 = bx + 28 * S
            maxh = 88 * S
            barw = 26 * S
            for k, val in enumerate(bars):
                h = max(4 * S, maxh * val)
                d.rounded_rectangle([bx0 + k * (barw + 10 * S), py + ph - 30 * S - h,
                                     bx0 + k * (barw + 10 * S) + barw, py + ph - 30 * S],
                                    radius=6 * S, fill=accent + (200,))
    if spec.get("foot"):
        f = font(18)
        d.text((70 * S, (H - 40) * S), spec["foot"], font=f, fill=MUTED)


SPECS = [
    {
        "out": "prompt-anatomy-hindi.jpg",
        "kind": "cards",
        "kicker": "Prompt anatomy",
        "title": "Ek accha prompt ke 4 hisse",
        "sub": "Har hissa ek chhoti si line hai — par inhi se jawab ka level tay hota hai.",
        "cards": [
            {"head": "Role", "lines": ["Kaun ban kar jawab de", "Senior editor, teacher, reviewer"]},
            {"head": "Task", "lines": ["Ek hi kaam, saaf verb", "Likho, jodo, jaancho, samjhao"]},
            {"head": "Context", "lines": ["Kis audience ke liye", "Kya pehle se pata hai"]},
            {"head": "Format", "lines": ["Kitna lamba, kis shape me", "Table, list, 3 options"]},
        ],
        "foot": "Chaaron hisse ek hi prompt me — bas isi kram me.",
    },
    {
        "out": "prompt-iteration-hindi.jpg",
        "kind": "flow",
        "kicker": "Iteration loop",
        "title": "Ek prompt ko sudharne ka chhota chakkar",
        "nodes": [
            {"label": "1. Pehla draft", "sub": "kaccha prompt, seedha sawaal", "note": "Perfect prompt ka intezaar mat karo — pehla jawab hi naksha hai."},
            {"label": "2. Gap dhoondo", "sub": "kya galat ya adhoora hai", "note": "Fact galat, tone off, ya lambaai zyada — ek baar me ek gap."},
            {"label": "3. Ek badlav jodo", "sub": "role, example ya format", "note": "Ek waqt me ek badlav, warna pata nahi chalega kisne kaam kiya."},
            {"label": "4. Compare karo", "sub": "purana vs naya jawab", "note": "Do jawab saath rakho; behtar wala hi aage le jao."},
            {"label": "5. Prompt save karo", "sub": "template bana lo", "note": "Jo chal gaya use library me daalo — dobara mat socho."},
        ],
        "foot": "Teen-chaar chakkar me hi zyadatar prompts apni jagah par aa jaate hain.",
    },
    {
        "out": "ml-vs-dl-layers-hindi.jpg",
        "kind": "scale",
        "kicker": "Features vs layers",
        "title": "Machine learning aur deep learning ka farq",
        "panes": [
            {"head": "Machine learning", "lines": ["Insaan features banata hai", "Kam data me chalta hai", "Faisla padhne layak rehta hai"], "bars": [0.28, 0.36, 0.44, 0.52, 0.6]},
            {"head": "Deep learning", "lines": ["Model khud features seekhta hai", "Bahut data aur GPU chahiye", "Andar ka hisaab dhundhla hota hai"], "accent": "violet", "bars": [0.2, 0.38, 0.62, 0.8, 1.0]},
        ],
        "foot": "Data kam hai to ML, data bahut hai to DL — par pehle simple baseline try karo.",
    },
    {
        "out": "ml-learning-types-hindi.jpg",
        "kind": "cards",
        "kicker": "Learning types",
        "title": "Teen tarah ki learning, teen tarah ke sawaal",
        "cards": [
            {"head": "Supervised", "lines": ["Label wala data", "Email spam ya nahi", "Sabse aam shuruaat"]},
            {"head": "Unsupervised", "lines": ["Bina label ka data", "Customer groups", "Pattern dhoondta hai"]},
            {"head": "Reinforcement", "lines": ["Reward se seekhna", "Game, robot, pricing", "Try aur feedback"]},
        ],
        "foot": "Pehle socho aapke paas label hai ya nahi — wahi tarika chunta hai.",
    },
    {
        "out": "coding-agents-compare-hindi.jpg",
        "kind": "cards",
        "kicker": "Coding agents",
        "title": "Teen tarike, teen kaam ke liye",
        "cards": [
            {"head": "Terminal agent", "lines": ["Repo ke andar chalta hai", "Khud files badalta hai", "Review aur control zaroori"]},
            {"head": "Cloud agent", "lines": ["Task bhejo, PR aayega", "Lambi baat ke liye theek", "Network par depend"]},
            {"head": "IDE autocomplete", "lines": ["Line ke andar madad", "Speed sabse zyada", "Bade badlav nahi"]},
        ],
        "foot": "Chhota kaam — autocomplete. Bada kaam — agent. Dono ke beech: code review.",
    },
    {
        "out": "coding-agent-safeguards-hindi.jpg",
        "kind": "flow",
        "kicker": "Guardrails",
        "title": "Agent ko repo me ghusane se pehle",
        "nodes": [
            {"label": "Branch alag", "sub": "main par seedha nahi", "note": "Agent ka har badlav apni branch me — main hamesha chalne layak."},
            {"label": "Tests pehle", "sub": "fail hone par rukna", "note": "Test suite hi agent ka pehla reviewer hai."},
            {"label": "Diff chhota", "sub": "ek commit, ek kaam", "note": "200 line ka diff insaan padh leta hai; 2000 line ka nahi."},
            {"label": "Insaan ka review", "sub": "merge se pehle", "note": "Security, data aur logic — teen cheezein khud dekho."},
        ],
        "foot": "Agent tez likhta hai; zimmedari phir bhi review karne wale ki rehti hai.",
    },
    {
        "out": "scaling-vertical-horizontal-hindi.jpg",
        "kind": "scale",
        "kicker": "Do tarah ka scale",
        "title": "Bada server ya zyada server?",
        "panes": [
            {"head": "Vertical scaling", "lines": ["Ek server me CPU aur RAM badhao", "Code same rehta hai", "Ek hi hadd tak chalta hai"], "bars": [0.3, 0.45, 0.62, 0.8, 1.0]},
            {"head": "Horizontal scaling", "lines": ["Server ki ginti badhao", "Load balancer chahiye", "Failure se bachav aasan"], "accent": "violet", "bars": [0.2, 0.2, 0.2, 0.2, 0.2]},
        ],
        "foot": "Shuruaat vertical se karo, par state ko aisa likho ki horizontal mumkin ho.",
    },
    {
        "out": "cache-request-path-hindi.jpg",
        "kind": "flow",
        "kicker": "Request path",
        "title": "Ek request cache se kaise guzarti hai",
        "nodes": [
            {"label": "Browser", "sub": "local cache", "note": "Sabse sasta jawab wahi hai jo server tak pahuncha hi na ho."},
            {"label": "CDN / edge", "sub": "static files", "note": "Images, CSS aur JS yahin se aate hain — database tak nahi jaate."},
            {"label": "App cache", "sub": "Redis, memcached", "note": "Baar-baar wala sawaal yahan ruk jaata hai, milliseconds me."},
            {"label": "Database", "sub": "asli source of truth", "note": "Yahan sirf wahi query aaye jo cache me nahi mili."},
        ],
        "foot": "Har layer par ek sawaal: kya ye jawab pehle se kisi ke paas hai?",
    },
    {
        "out": "api-request-flow-hindi.jpg",
        "kind": "flow",
        "kicker": "API request",
        "title": "Ek API call me kya hota hai",
        "nodes": [
            {"label": "Client", "sub": "app ya browser", "note": "Request banata hai: method, URL, headers aur body."},
            {"label": "API server", "sub": "request sunta hai", "note": "Token jaanchta hai, data check karta hai, phir kaam par bhejta hai."},
            {"label": "Database", "sub": "asli data", "note": "Sirf utna data nikalta hai jitna jawab ke liye chahiye."},
            {"label": "Response", "sub": "JSON + status code", "note": "200 matlab theek, 400 request ki galti, 500 server ki galti."},
        ],
        "foot": "Har API apne aap me ek contract hai — method, path, status aur shape.",
    },
    {
        "out": "rest-methods-hindi.jpg",
        "kind": "cards",
        "kicker": "HTTP methods",
        "title": "GET, POST, PUT aur DELETE",
        "cards": [
            {"head": "GET", "lines": ["Data padhna — safe", "Bar-bar chal sakta hai", "Cache ho sakta hai"]},
            {"head": "POST", "lines": ["Naya record banana", "Do baar bheja to do record?"], "accent": "violet"},
            {"head": "PUT / PATCH", "lines": ["Record badalna", "PUT poora, PATCH thoda"]},
            {"head": "DELETE", "lines": ["Record hatana", "Soft delete soch samajh kar"], "accent": "violet"},
        ],
        "foot": "Method galat chuna to API ka poora matlab badal jaata hai.",
    },
    {
        "out": "git-three-areas-hindi.jpg",
        "kind": "flow",
        "kicker": "Git ke teen hisse",
        "title": "File se commit tak ka safar",
        "nodes": [
            {"label": "Working directory", "sub": "aapki files", "note": "Yahan aap likhte hain; Git isme kuch nahi badalta."},
            {"label": "Staging area", "sub": "git add", "note": "Sirf wahi files chuno jo ek commit me jaani chahiye."},
            {"label": "Local commit", "sub": "git commit", "note": "Ek checkpoint, message ke saath — ab safe hai."},
            {"label": "Remote", "sub": "git push", "note": "Team ke saath share; yahi se backup bhi banta hai."},
        ],
        "foot": "Teen jagah yaad rakhein: likha kahan, chuna kahan, sambhala kahan.",
    },
    {
        "out": "git-branch-merge-hindi.jpg",
        "kind": "cards",
        "kicker": "Branch ka kaam",
        "title": "Main, branch aur merge",
        "cards": [
            {"head": "main", "lines": ["Hamesha chalne wali line", "Yahan seedha kaam nahi"]},
            {"head": "feature branch", "lines": ["Ek kaam, ek branch", "Chhota aur saaf diff"], "accent": "violet"},
            {"head": "pull request", "lines": ["Code padhne ki jagah", "Test aur review yahin"]},
            {"head": "merge", "lines": ["main me wapas", "Conflict ho to haath se"]},
        ],
        "foot": "Chhoti branch aur roz merge — dono aadatein conflict kam karti hain.",
    },
    {
        "out": "data-science-roadmap-hindi.jpg",
        "kind": "cards",
        "kicker": "Roadmap",
        "title": "Data science ke chaar stambh",
        "cards": [
            {"head": "SQL aur Excel", "lines": ["Data nikalna", "Sabse pehla hunar"]},
            {"head": "Python", "lines": ["pandas, cleaning", "Chart banana"], "accent": "violet"},
            {"head": "Statistics", "lines": ["Average vs median", "Sample aur test"]},
            {"head": "Machine learning", "lines": ["Baseline pehle", "Phir model"]},
        ],
        "foot": "Order yahi hai — ML sabse aakhir me, sabse pehle nahi.",
    },
    {
        "out": "data-science-portfolio-hindi.jpg",
        "kind": "flow",
        "kicker": "Portfolio project",
        "title": "Ek project jo interview me chalta hai",
        "nodes": [
            {"label": "Sawaal", "sub": "business ki bhasha me", "note": "\"Kaun se customers churn hote hain\" — model ka naam nahi."},
            {"label": "Data", "sub": "kahan se, kitna", "note": "Source, date range aur safai ka tarika likho."},
            {"label": "Model", "sub": "baseline se shuru", "note": "Simple model ka score pehle, phir comparison."},
            {"label": "Nateeja", "sub": "dashboard ya memo", "note": "Ek page me: kya mila, kitna bharosa, aage kya."},
        ],
        "foot": "Teen project is tarah ke, chaar certificate se zyada kaam aate hain.",
    },
    {
        "out": "cyber-basics-hindi.jpg",
        "kind": "cards",
        "kicker": "Aadatein",
        "title": "Chaar aadatein jo sabse zyada bachati hain",
        "cards": [
            {"head": "Alag password", "lines": ["Har site ka apna", "Manager me rakho"]},
            {"head": "2FA", "lines": ["Password ke baad code", "App, SMS se behtar"], "accent": "violet"},
            {"head": "Update", "lines": ["Phone, laptop, router", "Auto-update on"]},
            {"head": "Backup", "lines": ["Ek copy bahar", "Restore bhi test karo"]},
        ],
        "foot": "In chaar par 90% common attacks ka asar kam ho jaata hai.",
    },
    {
        "out": "cyber-incident-hindi.jpg",
        "kind": "flow",
        "kicker": "Incident",
        "title": "Account hack ho jaye to kya karein",
        "nodes": [
            {"label": "1. Password badlo", "sub": "doosre device se", "note": "Sabse pehle email, phir bank aur social."},
            {"label": "2. Sessions band karo", "sub": "logout all devices", "note": "Purane login ko bahar nikalo."},
            {"label": "3. Bank aur team ko batao", "sub": "jaldi, sharm ke bina", "note": "Der se batane me nuksan badhta hai."},
            {"label": "4. Report aur check", "sub": "cybercrime.gov.in, 1930", "note": "Paise ka case ho to jitni jaldi, utna better."},
        ],
        "foot": "Hack ke baad pehla ghanta sabse keemti hota hai.",
    },
    {
        "out": "vm-vs-container-hindi.jpg",
        "kind": "scale",
        "kicker": "VM vs container",
        "title": "Do tarah ka isolation",
        "panes": [
            {"head": "Virtual machine", "lines": ["Har VM me poora OS", "Boot hone me samay", "Bhaari par alag-alag"], "bars": [0.55, 0.55, 0.55]},
            {"head": "Container", "lines": ["OS host se share", "Secondon me start", "Halka, par kernel same"], "accent": "violet", "bars": [0.18, 0.18, 0.18, 0.18, 0.18, 0.18]},
        ],
        "foot": "Container tez aur halka hai; VM zyada alag aur bhaari.",
    },
    {
        "out": "docker-build-run-hindi.jpg",
        "kind": "flow",
        "kicker": "Image se container",
        "title": "Dockerfile se chalte container tak",
        "nodes": [
            {"label": "Dockerfile", "sub": "recipe likhi hui", "note": "Base image, files, install steps aur start command."},
            {"label": "Image", "sub": "build ka nateeja", "note": "Ek fixed snapshot — same image har machine par same chalti hai."},
            {"label": "Registry", "sub": "image ka store", "note": "Team aur server yahin se image kheenchte hain."},
            {"label": "Container", "sub": "chalta hua image", "note": "Ek image se das container, alag-alag port par."},
        ],
        "foot": "Image recipe ka nateeja hai; container us recipe ka chalta hua roop.",
    },
    {
        "out": "python-roadmap-hindi.jpg",
        "kind": "cards",
        "kicker": "Python roadmap",
        "title": "Chaar kadam, chhah hafte",
        "cards": [
            {"head": "1. Basics", "lines": ["Variables, loops, functions", "Roz 30 minute"]},
            {"head": "2. Data", "lines": ["Lists, dicts, files", "Chhote scripts"], "accent": "violet"},
            {"head": "3. Libraries", "lines": ["requests, pandas", "Error handling"]},
            {"head": "4. Project", "lines": ["Ek asli kaam", "GitHub par daalo"]},
        ],
        "foot": "Har kadam par likhna zaroori hai — sirf video dekhna kaafi nahi.",
    },
    {
        "out": "python-practice-loop-hindi.jpg",
        "kind": "flow",
        "kicker": "Practice loop",
        "title": "Seekhne ka chakkar jo chalta rahe",
        "nodes": [
            {"label": "Padho", "sub": "ek chhota concept", "note": "Ek baar me ek cheez — 20 minute se zyada nahi."},
            {"label": "Likhо", "sub": "bina dekhe code", "note": "Copy-paste se seekh nahi hoti; galti se hoti hai."},
            {"label": "Todo", "sub": "jaan-boojh kar", "note": "Code ka ek hissa hatao aur dobara chalane ki koshish karo."},
            {"label": "Project me daalo", "sub": "chhota sa use", "note": "Jo concept project me aaya, wahi yaad rehta hai."},
        ],
        "foot": "Galtiyan hi syllabus hain — unhe padhna chhodo mat.",
    },
    {
        "out": "sql-query-order-hindi.jpg",
        "kind": "flow",
        "kicker": "SQL ka kram",
        "title": "Query likhne aur chalne ka order",
        "nodes": [
            {"label": "FROM / JOIN", "sub": "pehle table chuno", "note": "Yahan tay hota hai ki data kahan se aayega."},
            {"label": "WHERE", "sub": "rows chhaanto", "note": "Jitni jaldi rows kam hon, utna tez query."},
            {"label": "GROUP BY", "sub": "jodo aur gino", "note": "Har group par SUM, COUNT, AVG laga sakte hain."},
            {"label": "HAVING", "sub": "group par shart", "note": "WHERE rows par lagta hai, HAVING groups par."},
            {"label": "ORDER BY + LIMIT", "sub": "ant me sajao", "note": "Bina ORDER BY ke 'top 10' ka koi matlab nahi."},
        ],
        "foot": "Likhne me SELECT pehle aata hai, par chalta sabse baad me.",
    },
    {
        "out": "sql-join-types-hindi.jpg",
        "kind": "cards",
        "kicker": "JOIN ke prakar",
        "title": "Kaun si rows saath aayengi",
        "cards": [
            {"head": "INNER JOIN", "lines": ["Sirf matching rows", "Sabse aam aur safe"]},
            {"head": "LEFT JOIN", "lines": ["Bayein sab, daayein jo mile", "Missing ko NULL dikhao"], "accent": "violet"},
            {"head": "RIGHT JOIN", "lines": ["Ulta LEFT", "Kam istemal hota hai"]},
            {"head": "FULL JOIN", "lines": ["Dono taraf sab", "Bade data par bhaari"], "accent": "violet"},
        ],
        "foot": "JOIN galat chuna to rows chupchap kam ho jaati hain — count se jaancho.",
    },
    {
        "out": "sql-vs-nosql-tradeoffs-hindi.jpg",
        "kind": "scale",
        "kicker": "Do model",
        "title": "Schema pehle ya shape baad me",
        "panes": [
            {"head": "Relational (SQL)", "lines": ["Schema pehle se tay", "JOIN aur transaction strong", "Report ke liye behtar"], "bars": [0.5, 0.5, 0.5, 0.5]},
            {"head": "Document (NoSQL)", "lines": ["Shape badal sakti hai", "Ek document me poora record", "Bade write ke liye aasan"], "accent": "violet", "bars": [0.2, 0.3, 0.45, 0.6, 0.8]},
        ],
        "foot": "Zydatar apps SQL se shuru karke hi theek rehte hain.",
    },
    {
        "out": "database-choice-hindi.jpg",
        "kind": "flow",
        "kicker": "Faisla",
        "title": "Database chunne ke chaar sawaal",
        "nodes": [
            {"label": "Data ka shape", "sub": "table ya document", "note": "Rishte hain to relational; nested record hai to document."},
            {"label": "Read ya write", "sub": "kaun zyada", "note": "Read heavy me index aur cache zyada maayne rakhte hain."},
            {"label": "Consistency", "sub": "paisa ya likes", "note": "Paisa ho to transaction aur strong consistency chahiye."},
            {"label": "Team ka hunar", "sub": "jo aata hai wahi lo", "note": "Naya database seekhne ki keemat bhi ginti me aati hai."},
        ],
        "foot": "Trend dekhkar database na chuno — sawaal se chuno.",
    },
    {
        "out": "excel-formula-families-hindi.jpg",
        "kind": "cards",
        "kicker": "Formula parivar",
        "title": "Chaar parivar, zyadatar kaam",
        "cards": [
            {"head": "SUM / COUNT", "lines": ["Jodna aur ginna", "SUMIF se shart ke saath"]},
            {"head": "IF / IFS", "lines": ["Shart par nateeja", "Nested IF se bacho"], "accent": "violet"},
            {"head": "VLOOKUP / XLOOKUP", "lines": ["Do table jodo", "XLOOKUP naya aur aasan"]},
            {"head": "TEXT / DATE", "lines": ["Naam saaf karo", "Mahina nikaalo"]},
        ],
        "foot": "Formula yaad karne se pehle socho — kaam kaun se parivar ka hai.",
    },
    {
        "out": "excel-pivot-flow-hindi.jpg",
        "kind": "flow",
        "kicker": "Raw se report",
        "title": "Data se dashboard tak",
        "nodes": [
            {"label": "Raw data", "sub": "ek row, ek record", "note": "Header ek hi row me, merge cell nahi, khali row nahi."},
            {"label": "Table banao", "sub": "Ctrl + T", "note": "Table se range apne aap badhti hai."},
            {"label": "Pivot table", "sub": "rows, columns, values", "note": "Pehle sawaal tay karo, phir fields kheencho."},
            {"label": "Chart", "sub": "ek message", "note": "Ek chart, ek baat — sab kuch ek chart me nahi."},
        ],
        "foot": "Jo report har hafte banti hai, use pivot se hamesha ke liye bana do.",
    },
    {
        "out": "index-lookup-hindi.jpg",
        "kind": "cards",
        "kicker": "Index anatomy",
        "title": "Index andar se kaisa hota hai",
        "cards": [
            {"head": "Key", "lines": ["Jo value dhundhi jaati hai", "Sorted rehti hai"]},
            {"head": "Pointer", "lines": ["Asli row kahan hai", "Isi se data milta hai"], "accent": "violet"},
            {"head": "Order", "lines": ["A se Z, chhote se bade", "Range query isi se tez"]},
            {"head": "Cost", "lines": ["Har insert par update", "Jagah bhi leta hai"], "accent": "violet"},
        ],
        "foot": "Index ek chhoti sorted list hai — poora data nahi.",
    },
    {
        "out": "index-query-speed-hindi.jpg",
        "kind": "flow",
        "kicker": "Slow query",
        "title": "Dheemi query ko theek karne ka kram",
        "nodes": [
            {"label": "1. Naapo", "sub": "kitna samay, kitni rows", "note": "Bina naape fix karna andhere me teer chalana hai."},
            {"label": "2. EXPLAIN chalao", "sub": "plan dekho", "note": "Full scan dikhe to index ki soch banti hai."},
            {"label": "3. Index jodo", "sub": "WHERE aur JOIN ke column par", "note": "Ek index, ek sawaal — sab par ek saath nahi."},
            {"label": "4. Dobara naapo", "sub": "purane se tulna", "note": "Behtar na ho to index hatao; bekaar bojh mat rakho."},
        ],
        "foot": "Pehle naapo, phir badlo, phir dobara naapo.",
    },
    {
        "out": "bi-tools-compare-hindi.jpg",
        "kind": "cards",
        "kicker": "BI tools",
        "title": "Chaar options, chaar surat",
        "cards": [
            {"head": "Power BI", "lines": ["Excel ke kareeb", "Sasta, Windows ke saath"]},
            {"head": "Tableau", "lines": ["Visual me sabse aage", "Mehnga, seekhne me samay"], "accent": "violet"},
            {"head": "Looker Studio", "lines": ["Free, browser me", "Google data ke saath best"]},
            {"head": "Excel", "lines": ["Chhote data ke liye", "Pivot se kaam chal jata hai"], "accent": "violet"},
        ],
        "foot": "Tool se pehle sawaal: kaun dekhega, kitni baar, aur kis data par.",
    },
    {
        "out": "bi-dashboard-flow-hindi.jpg",
        "kind": "flow",
        "kicker": "Dashboard",
        "title": "Data se dashboard tak",
        "nodes": [
            {"label": "Source", "sub": "SQL, sheet, API", "note": "Ek hi source of truth rakho, warna number alag aayenge."},
            {"label": "Model", "sub": "saaf tables", "note": "Naam ek jaise, date ka ek format, duplicate nahi."},
            {"label": "Visual", "sub": "ek sawaal, ek chart", "note": "Sab kuch ek page par thoosna dashboard nahi hota."},
            {"label": "Share", "sub": "sahi log, sahi access", "note": "Refresh ka waqt aur data ki date likho."},
        ],
        "foot": "Dashboard ka test: 10 second me ek faisla ho jaye.",
    },
    {
        "out": "data-cleaning-steps-hindi.jpg",
        "kind": "flow",
        "kicker": "Cleaning steps",
        "title": "Gande data ka paanch kadam ka ilaj",
        "nodes": [
            {"label": "1. Profile", "sub": "kitni rows, kitne khali", "note": "Pehle data ko dekho, usme kya hai — bina badle."},
            {"label": "2. Missing", "sub": "khali cells", "note": "Har khali cell ka matlab alag hota hai: pata nahi, zero, ya galti."},
            {"label": "3. Duplicate", "sub": "ek hi cheez do baar", "note": "Business key tay karo, phir duplicate hatao."},
            {"label": "4. Types", "sub": "date, number, text", "note": "Ek column, ek type — warna total galat aayega."},
            {"label": "5. Outliers", "sub": "anokhe values", "note": "Hatao nahi, pehle samjho — kabhi wahi asli signal hota hai."},
        ],
        "foot": "Saaf data ka record rakho: kya badla aur kyun.",
    },
    {
        "out": "dirty-data-signs-hindi.jpg",
        "kind": "cards",
        "kicker": "Warning signs",
        "title": "Chaar cheezein jo har dataset me milti hain",
        "cards": [
            {"head": "Missing", "lines": ["Khali cell", "Ya 'N/A' likha hua"]},
            {"head": "Duplicate", "lines": ["Same order do baar", "Total dugna"]},
            {"head": "Mixed type", "lines": ["5000 aur '5000'", "Date teen format me"], "accent": "violet"},
            {"head": "Outlier", "lines": ["Age 250 saal", "Amount me extra zero"], "accent": "violet"},
        ],
        "foot": "In chaaron ko ignore kiya to model aur report dono galat honge.",
    },
    {
        "out": "internet-layers-hindi.jpg",
        "kind": "cards",
        "kicker": "Ek request, chaar layers",
        "title": "Browser se server tak kaise pahunchti hai",
        "cards": [
            {"head": "IP", "lines": ["Packet ka pata", "Har device ka address"]},
            {"head": "DNS", "lines": ["Naam se address", "Phonebook jaisa"], "accent": "violet"},
            {"head": "TCP", "lines": ["Bharosemand connection", "Sab sahi order me"]},
            {"head": "HTTP + TLS", "lines": ["Request aur response", "Data encrypted"], "accent": "violet"},
        ],
        "foot": "Koi ek layer ruke to page nahi khulega.",
    },
    {
        "out": "dns-lookup-hindi.jpg",
        "kind": "flow",
        "kicker": "DNS lookup",
        "title": "Naam se IP tak ka safar",
        "nodes": [
            {"label": "1. Cache", "sub": "browser aur OS", "note": "Mil gaya to safar yahin khatam."},
            {"label": "2. Resolver", "sub": "ISP ka server", "note": "Yeh aage poochhne ka kaam karta hai."},
            {"label": "3. Root aur TLD", "sub": ".com ya .site", "note": "Authoritative server ka naam milta hai."},
            {"label": "4. Authoritative", "sub": "asli IP address", "note": "Jawab TTL tak cache rehta hai."},
        ],
        "foot": "Jawab har level par cache hota hai — isliye dusri baar tez.",
    },
    {
        "out": "tls-handshake-hindi.jpg",
        "kind": "flow",
        "kicker": "TLS handshake",
        "title": "Chaar message me secure connection",
        "nodes": [
            {"label": "1. Client Hello", "sub": "version aur ciphers", "note": "Browser batata hai kya kya samajhta hai."},
            {"label": "2. Server Hello", "sub": "certificate ke saath", "note": "Server apni pehchan saabit karta hai."},
            {"label": "3. Verification", "sub": "CA, domain, expiry", "note": "Browser certificate jaanchta hai."},
            {"label": "4. Session key", "sub": "encrypted data", "note": "Ab har request encrypt hoke jati hai."},
        ],
        "foot": "TLS 1.3 me yeh safar ek round trip me poora hota hai.",
    },
    {
        "out": "https-padlock-hindi.jpg",
        "kind": "cards",
        "kicker": "Taale ke andar",
        "title": "HTTPS kya deta hai — aur kya nahi",
        "cards": [
            {"head": "Certificate", "lines": ["Domain ka naam", "CA ka signature"]},
            {"head": "Encryption", "lines": ["Data padha nahi ja sakta", "Session key se"], "accent": "violet"},
            {"head": "Integrity", "lines": ["Raaste me badlav pakda jata hai", "Har packet check hota hai"]},
            {"head": "Seema", "lines": ["Site imandar hai", "Yeh taala nahi batata"], "accent": "violet"},
        ],
        "foot": "Taala bharose ka ishara hai, imandari ka saboot nahi.",
    },
    {
        "out": "stack-skills-hindi.jpg",
        "kind": "cards",
        "kicker": "Chaar parat",
        "title": "Ek product, chaar tarah ka kaam",
        "cards": [
            {"head": "Frontend", "lines": ["HTML, CSS, JS", "Dikhne wala hissa"]},
            {"head": "Backend", "lines": ["API aur logic", "Server par chalta hai"], "accent": "violet"},
            {"head": "Database", "lines": ["Data kahan rehta hai", "SQL ya NoSQL"]},
            {"head": "DevOps", "lines": ["Deploy aur monitoring", "Sab chalta rahe"], "accent": "violet"},
        ],
        "foot": "Har parat ka apna kaam — aur apni zimmedari.",
    },
    {
        "out": "frontend-backend-flow-hindi.jpg",
        "kind": "flow",
        "kicker": "Button click",
        "title": "Click se database tak",
        "nodes": [
            {"label": "1. Click", "sub": "frontend data jodta hai", "note": "UI turant feedback deta hai."},
            {"label": "2. API call", "sub": "JSON POST request", "note": "Yahan network ka samay lagta hai."},
            {"label": "3. Backend", "sub": "validate aur save", "note": "Permission aur data dono jaanche jate hain."},
            {"label": "4. Response", "sub": "success ya error", "note": "Frontend isi se UI badalta hai."},
        ],
        "foot": "Error kis step par aaya, usse pata chalta hai kahan dekhna hai.",
    },
    {
        "out": "hosting-types-hindi.jpg",
        "kind": "cards",
        "kicker": "Hosting options",
        "title": "Chaar options, chaar hisaab",
        "cards": [
            {"head": "Shared", "lines": ["Ek server, kai sites", "Sasta, kam control"]},
            {"head": "VPS", "lines": ["Apna hissa server", "Root access"], "accent": "violet"},
            {"head": "Dedicated", "lines": ["Poora server aapka", "Mehnga, tez"]},
            {"head": "Cloud", "lines": ["Load ke hisaab se", "Bill bhi badalta hai"], "accent": "violet"},
        ],
        "foot": "Kimat se pehle site ka type dekho — static ke liye server hi nahi chahiye.",
    },
    {
        "out": "hosting-choice-hindi.jpg",
        "kind": "flow",
        "kicker": "Hosting chunna",
        "title": "Saat sawaal, ek faisla",
        "nodes": [
            {"label": "1. Site ka type", "sub": "static, WordPress, app", "note": "Yahin se aadha faisla ho jata hai."},
            {"label": "2. Traffic", "sub": "kitne visits", "note": "Shared ya cloud, isi se tay hota hai."},
            {"label": "3. Kaun sambhale", "sub": "aap ya team", "note": "Managed ya unmanaged ka jawab."},
            {"label": "4. Budget aur support", "sub": "backup, SSL, exit", "note": "Sasta plan mehnga pad sakta hai."},
        ],
        "foot": "Pehle type, phir traffic, phir maintenance — ulta kram mehnga padta hai.",
    },
    {
        "out": "dns-records-types-hindi.jpg",
        "kind": "cards",
        "kicker": "DNS records",
        "title": "Kaun sa record kis kaam ka",
        "cards": [
            {"head": "A / AAAA", "lines": ["Site ka IP address", "IPv4 aur IPv6"]},
            {"head": "CNAME", "lines": ["Naam se naam", "Root par nahi"], "accent": "violet"},
            {"head": "MX", "lines": ["Email kahan jaye", "Priority ke saath"]},
            {"head": "TXT", "lines": ["Verification aur SPF", "DMARC bhi yahin"], "accent": "violet"},
        ],
        "foot": "Ek record galat ho to site ya email band ho sakta hai.",
    },
    {
        "out": "dns-migration-hindi.jpg",
        "kind": "flow",
        "kicker": "DNS badalna",
        "title": "Safe migration ka kram",
        "nodes": [
            {"label": "1. TTL ghatao", "sub": "300 seconds", "note": "24 ghante pehle karo, baad me nahi."},
            {"label": "2. Naya setup test", "sub": "bina DNS badle", "note": "Temporary URL se sab jaancho."},
            {"label": "3. Records badlo", "sub": "ek saath, poore", "note": "Aadhe purane, aadhe naye mat chhodo."},
            {"label": "4. TTL wapas badhao", "sub": "sab theek ho to", "note": "Ek hafta ruk kar purani jagah band karo."},
        ],
        "foot": "TTL pehle ghatao, records baad me badlo — yahi safe kram hai.",
    },
    {
        "out": "vitals-three-hindi.jpg",
        "kind": "cards",
        "kicker": "Core Web Vitals",
        "title": "Teen metric, teen sawal",
        "cards": [
            {"head": "LCP", "lines": ["Sabse bada element", "2.5s se kam"]},
            {"head": "INP", "lines": ["Click ka jawab", "200ms se kam"], "accent": "violet"},
            {"head": "CLS", "lines": ["Layout kitna hila", "0.1 se kam"]},
            {"head": "Field data", "lines": ["Asli users ka data", "75% visits par"]},
        ],
        "foot": "Teeno behtar ho, tabhi page ka anubhav behtar kehlata hai.",
    },
    {
        "out": "vitals-fix-hindi.jpg",
        "kind": "flow",
        "kicker": "Speed sudharna",
        "title": "Naap se sudhar tak",
        "nodes": [
            {"label": "1. Field data dekho", "sub": "Search Console", "note": "Asli users ka data sach bolta hai."},
            {"label": "2. Sabse bhaari cheez", "sub": "image, font, script", "note": "Ek baar me ek hi cheez badlo."},
            {"label": "3. Badlo aur naapo", "sub": "lab me repeat", "note": "Bina naape pata nahi chalega."},
            {"label": "4. Field me confirm", "sub": "2–4 hafte baad", "note": "Ranking field data par milti hai."},
        ],
        "foot": "Naapo, badlo, dobara naapo — yahi ek tarika hai.",
    },
    {
        "out": "cloud-service-models-hindi.jpg",
        "kind": "cards",
        "kicker": "Teen models",
        "title": "IaaS, PaaS aur SaaS me kaun kya sambhale",
        "cards": [
            {"head": "IaaS", "lines": ["Machine aur network", "OS se aap sambhalo"]},
            {"head": "PaaS", "lines": ["Runtime tayyar", "Sirf code do"], "accent": "violet"},
            {"head": "SaaS", "lines": ["Software tayyar", "Login karo, kaam karo"]},
            {"head": "On-premise", "lines": ["Sab kuch aapka", "Bijli se patch tak"], "accent": "violet"},
        ],
        "foot": "Jitna upar jaoge, utni kam zimmedari — aur utna kam control.",
    },
    {
        "out": "cloud-choice-hindi.jpg",
        "kind": "flow",
        "kicker": "Cloud chunna",
        "title": "Faisla kaise karein",
        "nodes": [
            {"label": "1. Workload", "sub": "static, app, data", "note": "Yahin se aadha faisla hota hai."},
            {"label": "2. Niyam", "sub": "data kahan reh sakta hai", "note": "Region aur compliance isi se tay hote hain."},
            {"label": "3. Load ka pattern", "sub": "sthir ya badalta", "note": "Stable load par dedicated sasta pad sakta hai."},
            {"label": "4. Budget aur team", "sub": "kaun sambhalega", "note": "Managed service samay bachati hai."},
        ],
        "foot": "Pehle workload, phir niyam, phir paisa — ulta karne se bill badhta hai.",
    },
    {
        "out": "ci-cd-stages-hindi.jpg",
        "kind": "flow",
        "kicker": "Pipeline",
        "title": "Commit se production tak",
        "nodes": [
            {"label": "1. Commit", "sub": "trigger chalu", "note": "Har push aur pull request par."},
            {"label": "2. Build", "sub": "lint aur compile", "note": "Sabse sasta check pehle."},
            {"label": "3. Test", "sub": "unit aur integration", "note": "Yahan fail hona behtar hai."},
            {"label": "4. Deploy", "sub": "staging, phir prod", "note": "Wahi artifact jo test hua."},
        ],
        "foot": "Har stage ek filter hai — jo paas kare, wahi aage jaye.",
    },
    {
        "out": "ci-cd-gates-hindi.jpg",
        "kind": "cards",
        "kicker": "Chaar gates",
        "title": "Pipeline ke chaar sawaal",
        "cards": [
            {"head": "Lint", "lines": ["Code saaf hai?", "Seconds me jawab"]},
            {"head": "Build", "lines": ["Sab jud raha hai?", "Artifact banti hai"], "accent": "violet"},
            {"head": "Test", "lines": ["Kaam kar raha hai?", "Unit se e2e tak"]},
            {"head": "Deploy", "lines": ["Live ja sakta hai?", "Health check ke baad"], "accent": "violet"},
        ],
        "foot": "Ek gate fail ho to aage mat badho — yahi pipeline ka poora matlab hai.",
    },
    {
        "out": "devops-loop-hindi.jpg",
        "kind": "flow",
        "kicker": "DevOps loop",
        "title": "Ek chakkar, chaar starr",
        "nodes": [
            {"label": "1. Plan", "sub": "sawaal aur scope", "note": "Chhota badlav, saaf maksad."},
            {"label": "2. Build", "sub": "code aur test", "note": "CI yahan kaam karta hai."},
            {"label": "3. Deploy", "sub": "staging se prod", "note": "Automation se, haath se nahi."},
            {"label": "4. Monitor", "sub": "metrics aur logs", "note": "Yahan se agla plan banta hai."},
        ],
        "foot": "DevOps ek line nahi, loop hai — monitoring se plan tak wapas.",
    },
    {
        "out": "devops-practices-hindi.jpg",
        "kind": "cards",
        "kicker": "Chaar aadatein",
        "title": "Tools se pehle yeh aadatein",
        "cards": [
            {"head": "Chhote badlav", "lines": ["Roz merge, roz deploy", "Rollback aasan"]},
            {"head": "CI/CD", "lines": ["Har commit par test", "Wahi build live"], "accent": "violet"},
            {"head": "IaC", "lines": ["Setup code me", "Dobara bana sakte hain"]},
            {"head": "Monitoring", "lines": ["Users se pehle pata", "Blameless postmortem"], "accent": "violet"},
        ],
        "foot": "Tool badalna aasan hai, aadat badalna mushkil — isi se farq padta hai.",
    },
    {
        "out": "iac-benefits-hindi.jpg",
        "kind": "cards",
        "kicker": "IaC ke fayde",
        "title": "Code me likhne se kya milta hai",
        "cards": [
            {"head": "Dohraav", "lines": ["Same setup har baar", "Haath ki galti kam"]},
            {"head": "Review", "lines": ["Badlav PR me dikhta", "Chupchap port nahi khulta"], "accent": "violet"},
            {"head": "History", "lines": ["Git me record", "Kisne, kab, kyun"]},
            {"head": "Recovery", "lines": ["Poora env dobara", "Aapda me kaam aata"], "accent": "violet"},
        ],
        "foot": "Ek file, chaar fayde — sabse bada: setup dobara ban sakta hai.",
    },
    {
        "out": "terraform-flow-hindi.jpg",
        "kind": "flow",
        "kicker": "Terraform",
        "title": "Likho, plan dekho, apply karo",
        "nodes": [
            {"label": "1. Likho", "sub": ".tf files", "note": "Resources aur variables."},
            {"label": "2. init", "sub": "provider setup", "note": "Har naye project par ek baar."},
            {"label": "3. plan", "sub": "kya badlega", "note": "Ise kabhi skip mat karo."},
            {"label": "4. apply", "sub": "state update", "note": "State hi yaaddasht hai."},
        ],
        "foot": "Plan padhna sabse zaroori step hai — wahi bachata hai.",
    },
    {
        "out": "serverless-flow-hindi.jpg",
        "kind": "flow",
        "kicker": "Serverless",
        "title": "Event se response tak",
        "nodes": [
            {"label": "1. Event", "sub": "request ya file", "note": "Function apne aap nahi chalta."},
            {"label": "2. Function", "sub": "naya ya warm", "note": "Cold start yahin lagta hai."},
            {"label": "3. Kaam", "sub": "validate aur save", "note": "Stateless rehna zaroori hai."},
            {"label": "4. Band", "sub": "billing rukti hai", "note": "Sirf chalne ka paisa lagta hai."},
        ],
        "foot": "Har request par function uthta hai, kaam karta hai, band ho jata hai.",
    },
    {
        "out": "serverless-compare-hindi.jpg",
        "kind": "cards",
        "kicker": "Serverless vs server",
        "title": "Chaar farq jo faisla badalte hain",
        "cards": [
            {"head": "Kharch", "lines": ["Sirf use ka bill", "Lagatar load me mehnga"]},
            {"head": "Scaling", "lines": ["Apne aap infinite", "Koi setup nahi"], "accent": "violet"},
            {"head": "Seema", "lines": ["15 min timeout", "Stateless hona zaroori"]},
            {"head": "Sahi kab", "lines": ["Webhook, cron, burst", "Long jobs ke liye nahi"], "accent": "violet"},
        ],
        "foot": "Sawaal ek hai — load lagatar hai ya tukdon me?",
    },
    {
        "out": "monitoring-pillars-hindi.jpg",
        "kind": "cards",
        "kicker": "Observability",
        "title": "Teen pillars, teen sawaal",
        "cards": [
            {"head": "Metrics", "lines": ["Kya ho raha hai", "Numbers aur alerts"]},
            {"head": "Logs", "lines": ["Kya hua", "Kis user ke liye"], "accent": "violet"},
            {"head": "Traces", "lines": ["Kahan samay gaya", "Service se service"]},
            {"head": "SLO", "lines": ["Kitni galti allowed", "Alert isi se"]},
        ],
        "foot": "Ek ke bina doosra adhura — teenon milkar asli karan tak pahunchate hain.",
    },
    {
        "out": "alert-flow-hindi.jpg",
        "kind": "flow",
        "kicker": "Alerts",
        "title": "Shor se signal tak",
        "nodes": [
            {"label": "1. SLO tay karo", "sub": "99.9% requests", "note": "User ke anubhav se jodo."},
            {"label": "2. Error budget", "sub": "mahine ki gunjaish", "note": "Isi se alert ka level tay hota hai."},
            {"label": "3. Alert", "sub": "budget tez khatam", "note": "Har alert ka ek malik ho."},
            {"label": "4. Runbook", "sub": "pehle kya dekhein", "note": "Raat 3 baje sochna nahi padta."},
        ],
        "foot": "Alert batata hai ki user prabhavit hai — number badha, yeh nahi.",
    },
    {
        "out": "neural-network-layers-hindi.jpg",
        "kind": "cards",
        "kicker": "Teen parat",
        "title": "Ek prediction ke teen hisse",
        "cards": [
            {"head": "Input", "lines": ["Raw numbers", "Pixels ya features"]},
            {"head": "Hidden", "lines": ["Pattern banate hain", "Guna, jod, activation"], "accent": "violet"},
            {"head": "Output", "lines": ["Faisla ya number", "Probability"]},
            {"head": "Loss", "lines": ["Galti ka naap", "Training ka compass"], "accent": "violet"},
        ],
        "foot": "Input data, hidden pattern, output jawab — loss batata hai kitna galat.",
    },
    {
        "out": "neural-network-training-hindi.jpg",
        "kind": "flow",
        "kicker": "Training loop",
        "title": "Chaar step, lakhon baar",
        "nodes": [
            {"label": "1. Forward pass", "sub": "prediction banti hai", "note": "Shuru me weights random hote hain."},
            {"label": "2. Loss", "sub": "sahi jawab se tulna", "note": "Galti ka ek number."},
            {"label": "3. Backprop", "sub": "har weight ka hissa", "note": "Gradient peeche ki taraf jata hai."},
            {"label": "4. Update", "sub": "thoda sa sudhar", "note": "Learning rate kadam tay karta hai."},
        ],
        "foot": "Yeh chakkar tab tak chalta hai jab tak loss kaafi kam na ho jaye.",
    },
    {
        "out": "attention-qkv-hindi.jpg",
        "kind": "cards",
        "kicker": "Attention",
        "title": "Query, key aur value",
        "cards": [
            {"head": "Query", "lines": ["Main kya dhoondh raha hoon", "Sawaal ka vector"]},
            {"head": "Key", "lines": ["Main kis se match karunga", "Pehchan ka vector"], "accent": "violet"},
            {"head": "Value", "lines": ["Mere paas kya hai", "Asli information"]},
            {"head": "Output", "lines": ["Weighted mix", "Softmax ke weights"], "accent": "violet"},
        ],
        "foot": "Query sawaal, key pehchan, value jawab — teenon milkar attention.",
    },
    {
        "out": "transformer-block-hindi.jpg",
        "kind": "flow",
        "kicker": "Ek block",
        "title": "Token se next token tak",
        "nodes": [
            {"label": "1. Tokenize", "sub": "text se tokens", "note": "Har token ek number."},
            {"label": "2. Embed", "sub": "vector aur position", "note": "Kram ka signal zaroori."},
            {"label": "3. Attention", "sub": "tokens baat karte hain", "note": "Kai heads, ek saath."},
            {"label": "4. Feed-forward", "sub": "phir next token", "note": "Block 30–100 baar dohrata hai."},
        ],
        "foot": "Ek hi simple block, bas bahut baar — yahi aaj ke LLM ka core hai.",
    },
    {
        "out": "embedding-space-hindi.jpg",
        "kind": "cards",
        "kicker": "Embedding space",
        "title": "Matlab ka naksha",
        "cards": [
            {"head": "Vector", "lines": ["384–3072 numbers", "Fixed length"]},
            {"head": "Paas", "lines": ["Similar matlab", "Chhoti doori"], "accent": "violet"},
            {"head": "Door", "lines": ["Alag matlab", "Badi doori"]},
            {"head": "Model", "lines": ["Ek hi model", "Mix mat karo"], "accent": "violet"},
        ],
        "foot": "Numbers ka matlab unki jagah me hai — doori hi similarity hai.",
    },
    {
        "out": "vector-search-flow-hindi.jpg",
        "kind": "flow",
        "kicker": "Vector search",
        "title": "Query se top-k tak",
        "nodes": [
            {"label": "1. Query embed", "sub": "wahi model", "note": "Document wale model se hi."},
            {"label": "2. Similarity", "sub": "cosine ya dot", "note": "Model card ke hisaab se."},
            {"label": "3. Top-k", "sub": "5–20 candidates", "note": "Ek result par bharosa nahi."},
            {"label": "4. Rerank", "sub": "keyword aur LLM", "note": "Hybrid search behtar."},
        ],
        "foot": "Embed, search, top-k, rerank — chaar step, aur quality ka farq.",
    },
    {
        "out": "hallucination-causes-hindi.jpg",
        "kind": "cards",
        "kicker": "Kyun hoti hai",
        "title": "Confident galat jawab ke karan",
        "cards": [
            {"head": "Objective", "lines": ["Agla token, sach nahi", "Plausible jeetta hai"]},
            {"head": "Compression", "lines": ["Arabon tokens", "Detail chhoot jati hai"], "accent": "violet"},
            {"head": "Missing data", "lines": ["Naya ya internal", "Model bana deta hai"]},
            {"head": "Sycophancy", "lines": ["User ki baat maan lena", "Assumption sach ban jata"], "accent": "violet"},
        ],
        "foot": "Model jhooth nahi bolta — woh sabse plausible jawab chunta hai.",
    },
    {
        "out": "hallucination-guardrails-hindi.jpg",
        "kind": "cards",
        "kicker": "Bachav",
        "title": "Chaar parat ka guardrail",
        "cards": [
            {"head": "Retrieval", "lines": ["Jawab documents se", "Sabse bada farq"]},
            {"head": "Citation", "lines": ["Har claim ka source", "Code se check"], "accent": "violet"},
            {"head": "Structured", "lines": ["JSON schema", "Creative galti rukti"]},
            {"head": "Review", "lines": ["Insaan ka final word", "High-stakes ke liye"], "accent": "violet"},
        ],
        "foot": "Har parat alag galti pakadti hai — ek bhi kaafi nahi.",
    },
    {
        "out": "eval-confusion-hindi.jpg",
        "kind": "cards",
        "kicker": "Chaar box",
        "title": "Accuracy se aage",
        "cards": [
            {"head": "Precision", "lines": ["Galat alarm kitna", "TP / (TP + FP)"]},
            {"head": "Recall", "lines": ["Kitna chhoota", "TP / (TP + FN)"], "accent": "violet"},
            {"head": "F1", "lines": ["Dono ka mean", "Trade-off chhupta hai"]},
            {"head": "Threshold", "lines": ["Business faisla", "0.5 niyam nahi"], "accent": "violet"},
        ],
        "foot": "Pehle poochho galat hone ka kharch kya hai — phir metric chuno.",
    },
    {
        "out": "eval-loop-hindi.jpg",
        "kind": "flow",
        "kicker": "Evaluation loop",
        "title": "Galti se sudhar tak",
        "nodes": [
            {"label": "1. Golden set", "sub": "50–100 asli cases", "note": "Users ke sawaal, team ke nahi."},
            {"label": "2. Error buckets", "sub": "30 galtiyan, 5 wajah", "note": "Yahin asli samay bachta hai."},
            {"label": "3. Ek fix", "sub": "ek hi badlav", "note": "Ek baar me ek cheez."},
            {"label": "4. Dobara naapo", "sub": "offline, phir A/B", "note": "Guardrails bhi dekho."},
        ],
        "foot": "Evaluate, bucket, fix, repeat — yahi loop quality banata hai.",
    },
    {
        "out": "bias-sources-hindi.jpg",
        "kind": "cards",
        "kicker": "Bias kahan se",
        "title": "Chaar asli raaste",
        "cards": [
            {"head": "Historical", "lines": ["Purane faisle", "Wahi bias sikhata"]},
            {"head": "Sampling", "lines": ["Kuch group kam", "Model kamzor"], "accent": "violet"},
            {"head": "Labels", "lines": ["Insaan ke labels", "Unka bias saath"]},
            {"head": "Proxy", "lines": ["Pincode, school", "Sensitive ka substitute"], "accent": "violet"},
        ],
        "foot": "Bias code me nahi aata — data, labels aur feedback se aata hai.",
    },
    {
        "out": "ethics-checks-hindi.jpg",
        "kind": "cards",
        "kicker": "Saat checks",
        "title": "Release se pehle",
        "cards": [
            {"head": "Purpose", "lines": ["Kya decide karega", "Aur kya nahi"]},
            {"head": "Subgroup", "lines": ["Har group ka score", "Alag se naapo"], "accent": "violet"},
            {"head": "Explain", "lines": ["Kaaran aur appeal", "User ko dikhao"]},
            {"head": "Monitor", "lines": ["Bias drift", "Har mahine dekho"], "accent": "violet"},
        ],
        "foot": "Checks ko release checklist me daalo — warna slides me rahenge.",
    },
    {
        "out": "chatbot-stack-hindi.jpg",
        "kind": "flow",
        "kicker": "Chatbot stack",
        "title": "Sawaal se jawab tak",
        "nodes": [
            {"label": "User message", "sub": "site, app ya WhatsApp", "note": "Channel alag, core pipeline same."},
            {"label": "Retrieval", "sub": "top 3 chunks", "note": "Galat chunk mila to jawab bhi galat hoga."},
            {"label": "System prompt", "sub": "role + hadd + fallback", "note": "'Pata nahi' kehne ki permission yahin milti hai."},
            {"label": "Model", "sub": "jawab likhta hai", "note": "Temperature kam — support bot ko creativity nahi chahiye."},
            {"label": "Answer + source", "sub": "document ka link", "note": "Source dikhane se bharosa aur debugging dono aasan."},
        ],
        "foot": "Har step alag se test karo — galti aksar retrieval me hoti hai, model me nahi.",
    },
    {
        "out": "chatbot-decide-hindi.jpg",
        "kind": "cards",
        "kicker": "Teen raaste",
        "title": "Chatbot kahan se shuru karein",
        "cards": [
            {"head": "No-code", "lines": ["Ek shaam me live", "Knowledge + widget ready", "Control kam"]},
            {"head": "Low-code", "lines": ["Widget + apna logic", "Webhook aur API", "Beech ka raasta"], "accent": "violet"},
            {"head": "Poora API", "lines": ["Apna UI aur data", "Cost par control", "Developer chahiye"]},
        ],
        "foot": "Pehla version no-code se banao; API tab jao jab ek clear hadd aaye.",
    },
    {
        "out": "pandas-analysis-loop-hindi.jpg",
        "kind": "flow",
        "kicker": "Analysis loop",
        "title": "Sawaal se verified number tak",
        "nodes": [
            {"label": "1. Data samjho", "sub": "shape, null, duplicate", "note": "Teen line ka kaam, das ghante bachata hai."},
            {"label": "2. Code maango", "sub": "schema + sawaal + rules", "note": "Schema dene se column ki galtiyan khatam."},
            {"label": "3. Chalao", "sub": "pandas sach batata hai", "note": "LLM ka number nahi, output ka number."},
            {"label": "4. Verify", "sub": "total + spot check", "note": "Denominator kya hai — yahi sabse bada sawaal."},
            {"label": "5. Summary", "sub": "verified table se", "note": "Har insight ke saath uska number quote karo."},
        ],
        "foot": "LLM translator hai, oracle nahi — number hamesha pandas se aayega.",
    },
    {
        "out": "llm-data-safety-hindi.jpg",
        "kind": "cards",
        "kicker": "Safety rules",
        "title": "AI se analysis ke chaar niyam",
        "cards": [
            {"head": "Schema do", "lines": ["Columns + dtypes", "Dummy rows kaafi"]},
            {"head": "Code chalao", "lines": ["Khud run karo", "Output dekho"], "accent": "violet"},
            {"head": "Number verify", "lines": ["Total milao", "Spot check karo"]},
            {"head": "Data minimal", "lines": ["PII hatao", "Local model socho"], "accent": "violet"},
        ],
        "foot": "Theek dikhne wala galat number sabse khatarnak hota hai.",
    },
    {
        "out": "image-prompt-parts-hindi.jpg",
        "kind": "cards",
        "kicker": "Prompt anatomy",
        "title": "Image prompt ke chaar hisse",
        "cards": [
            {"head": "Subject", "lines": ["Kya dikhna hai", "Kitna bada, kahan"]},
            {"head": "Style", "lines": ["Photo, 3D, flat", "Editorial ya poster"], "accent": "violet"},
            {"head": "Composition", "lines": ["Ratio aur khaali jagah", "Text kahan aayega"]},
            {"head": "Lighting", "lines": ["Window, studio, hard", "Mood aur shadow"], "accent": "violet"},
        ],
        "foot": "Aspect ratio prompt me likho — baad me crop karne se composition barbaad hoti hai.",
    },
    {
        "out": "prompt-to-poster-hindi.jpg",
        "kind": "flow",
        "kicker": "Poster workflow",
        "title": "Prompt se poster tak",
        "nodes": [
            {"label": "1. Brief", "sub": "message + audience", "note": "Ek line me decision — baaki sab isse nikalta hai."},
            {"label": "2. 4 variations", "sub": "seed badal kar", "note": "Pehli image draft hoti hai, final nahi."},
            {"label": "3. Inpaint", "sub": "galat hissa theek karo", "note": "Poori image dobara banane se sasta."},
            {"label": "4. Design tool", "sub": "text, logo, CTA", "note": "Padhne wala text AI se kabhi nahi."},
            {"label": "5. Export", "sub": "size + sRGB", "note": "Platform ke size me, file limit ke andar."},
        ],
        "foot": "AI sirf image deta hai — poster baaki chaar step me banta hai.",
    },
    {
        "out": "transcription-pipeline-hindi.jpg",
        "kind": "flow",
        "kicker": "Transcription",
        "title": "Audio se use-able notes tak",
        "nodes": [
            {"label": "Audio", "sub": "mic paas, fan band", "note": "Sabse bada farq audio quality ka hai."},
            {"label": "16 kHz mono", "sub": "30 second chunks", "note": "Model isi par train hai; sentence beech me nahi tootta."},
            {"label": "Speech model", "sub": "language force karo", "note": "Auto-detect Hinglish par confuse hota hai."},
            {"label": "Speaker labels", "sub": "kaun bol raha hai", "note": "Naam nahi milte — glossary se map karo."},
            {"label": "Notes", "sub": "decisions + actions", "note": "Transcript nahi, faisle chahiye."},
        ],
        "foot": "Audio saaf + glossary = 90% accuracy ka asli raaz.",
    },
    {
        "out": "voice-tool-pick-hindi.jpg",
        "kind": "cards",
        "kicker": "Tool chunna",
        "title": "Teen zaroorat, teen tool",
        "cards": [
            {"head": "Local Whisper", "lines": ["Free aur offline", "Confidential calls", "Labels nahi"]},
            {"head": "Meeting tool", "lines": ["Auto join + summary", "Speaker labels", "Cloud me audio"], "accent": "violet"},
            {"head": "Studio tool", "lines": ["Subtitles aur dubbing", "Voice choice", "Content ke liye"]},
        ],
        "foot": "Confidential audio local, internal meeting cloud, client video studio — data ke hisaab se tool.",
    },
    {
        "out": "shorts-workflow-hindi.jpg",
        "kind": "flow",
        "kicker": "Shorts workflow",
        "title": "Idea se upload tak",
        "nodes": [
            {"label": "Hook", "sub": "pehle 3 second", "note": "Yahan faisla hota hai — AI yahan kamzor hai."},
            {"label": "Script", "sub": "80–110 shabd", "note": "Bol kar padho, mann me nahi."},
            {"label": "Rough cut", "sub": "silence + filler hatao", "note": "AI ka sabse bada time-saving step."},
            {"label": "Captions", "sub": "haath se check", "note": "Naam aur number hi galat hote hain."},
            {"label": "Upload", "sub": "title + 3 hashtags", "note": "48 ghante chhedo mat, analytics dekho."},
        ],
        "foot": "Editing se reach nahi badhti — hook se badhti hai.",
    },
    {
        "out": "shorts-retention-hindi.jpg",
        "kind": "cards",
        "kicker": "Retention",
        "title": "Teen jagah faisla hota hai",
        "cards": [
            {"head": "0–3 sec", "lines": ["Sawaal ya claim", "Clickbait nahi", "60%+ retention chahiye"]},
            {"head": "Beech", "lines": ["Har 2–4 sec badlav", "Ek idea, do nahi", "Drop yahan dikhta hai"], "accent": "violet"},
            {"head": "Aakhir", "lines": ["Loop ka hint", "CTA halka", "Replay = reach"]},
        ],
        "foot": "Analytics me pehle 3-second retention dekho, effects nahi.",
    },
    {
        "out": "automation-trigger-hindi.jpg",
        "kind": "flow",
        "kicker": "Workflow",
        "title": "Trigger se action tak",
        "nodes": [
            {"label": "Trigger", "sub": "form, email, schedule", "note": "Ek event, ek workflow — do trigger mat milao."},
            {"label": "Filter", "sub": "sirf zaroori cases", "note": "'Created after' filter bulk galtiyan rokta hai."},
            {"label": "AI step", "sub": "classify, extract, summarize", "note": "Sirf unstructured text par — warna sasta rule kaafi hai."},
            {"label": "Action", "sub": "sheet, CRM, email", "note": "Destructive action par approval rakho."},
            {"label": "Notify", "sub": "error ya success", "note": "Bina notification workflow chupchap band ho jata hai."},
        ],
        "foot": "Pehla workflow 3 step ka — chalta hua chhota, bada banne se behtar hai.",
    },
    {
        "out": "automation-tool-pick-hindi.jpg",
        "kind": "scale",
        "kicker": "Zapier vs n8n",
        "title": "Aasan ya control?",
        "panes": [
            {"head": "Zapier", "lines": ["7000+ ready connectors", "Minutes me setup", "Per-task pricing"], "bars": [0.25, 0.35, 0.5, 0.7, 0.95]},
            {"head": "n8n", "lines": ["Open-source, self-host", "Code, loops, branching", "High volume par sasta"], "accent": "violet", "bars": [0.3, 0.45, 0.6, 0.8, 1.0]},
        ],
        "foot": "Simple aur non-technical — Zapier. Sensitive data ya volume — n8n.",
    },
]

DRAW = {"cards": draw_cards, "flow": draw_flow, "scale": draw_scale}


def main():
    only = sys.argv[1:]
    os.makedirs(OUT, exist_ok=True)
    for spec in SPECS:
        if only and not any(o in spec["out"] for o in only):
            continue
        img, d = base_canvas()
        img = img.convert("RGBA")
        DRAW[spec["kind"]](img, spec)
        final = img.convert("RGB").resize((W, H), Image.LANCZOS)
        path = os.path.join(OUT, spec["out"])
        final.save(path, "JPEG", quality=86, optimize=True, progressive=True)
        print(f"written: img/posts/{spec['out']} ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    main()
