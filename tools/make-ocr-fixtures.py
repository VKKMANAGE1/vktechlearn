#!/usr/bin/env python3
"""Generate the M07 OCR fixtures: scanned (image-only) PDFs and image notes in Hindi
and English, a table page, and a mixed PDF whose page 1 has a real text layer.

    python3 tools/make-ocr-fixtures.py [outdir]     # default artifacts/m07-fixtures

Needs: pillow, pymupdf and a Devanagari font (artifacts/fonts/NotoSansDevanagari.ttf).
Every page carries a page footer so page references can be checked, and every fixture
carries a unique token plus a number the AI answer can be compared against.
"""
import os
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "artifacts/m07-fixtures"
FONT = os.environ.get("OCR_FIXTURE_FONT", "artifacts/fonts/NotoSansDevanagari.ttf")
os.makedirs(OUT, exist_ok=True)

W, H = 1240, 1754  # A4 at 150 dpi
MARGIN = 90


def new_page():
    img = Image.new("RGB", (W, H), (253, 252, 250))
    return img, ImageDraw.Draw(img)


def fonts():
    hindi = ImageFont.truetype(FONT, 34)
    hindi_small = ImageFont.truetype(FONT, 26)
    title = ImageFont.truetype(FONT, 46)
    mono = ImageFont.truetype(FONT, 28)
    return title, hindi, hindi_small, mono


def footer(draw, text):
    draw.text((MARGIN, H - 90), text, font=ImageFont.truetype(FONT, 24), fill=(90, 90, 90))


def table(draw, x, y, rows, widths, font):
    row_h = 46
    for r, row in enumerate(rows):
        col_x = x
        for c, cell in enumerate(row):
            draw.rectangle([col_x, y + r * row_h, col_x + widths[c], y + (r + 1) * row_h], outline=(60, 60, 60))
            draw.text((col_x + 12, y + r * row_h + 8), str(cell), font=font, fill=(20, 20, 20))
            col_x += widths[c]
    return y + len(rows) * row_h


def save_pdf(images, name, page_labels):
    """Image-only PDF: every page is a JPEG raster, so there is no text layer at all."""
    doc = pymupdf.open()
    for img, _label in zip(images, page_labels):
        tmp = os.path.join(OUT, f".tmp-{name}.jpg")
        small = img.resize((900, int(img.height * 900 / img.width)), Image.LANCZOS)
        small.save(tmp, "JPEG", quality=85)
        page = doc.new_page(width=W * 0.75, height=H * 0.75)
        page.insert_image(page.rect, filename=tmp)
    doc.save(os.path.join(OUT, name), deflate=True, garbage=3)
    doc.close()
    os.remove(os.path.join(OUT, f".tmp-{name}.jpg"))
    print("wrote", name)


# ---------------------------------------------------------------- 1. scanned Hindi + English, 2 pages
title_f, hindi_f, hindi_small, mono = fonts()
pages = []
img, draw = new_page()
draw.text((MARGIN, 110), "गंगा स्वच्छता परियोजना — वार्षिक रिपोर्ट", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 220), "Token: TOKEN-SCAN-101", font=mono, fill=(160, 20, 20))
draw.text((MARGIN, 300), "यह दस्तावेज़ स्कैन किया गया है, इसमें कोई टेक्स्ट लेयर नहीं है।", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 360), "परियोजना का बजट: 445000 रुपये", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 420), "जिला: गोरखपुर, उत्तर प्रदेश", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 500), "English section: this page is a raster image.", font=hindi_small, fill=(20, 20, 20))
draw.text((MARGIN, 550), "First instalment amount: 283000 rupees", font=hindi_small, fill=(20, 20, 20))
draw.text((MARGIN, 600), "Deadline: 15 March 2027", font=hindi_small, fill=(20, 20, 20))
footer(draw, "पेज 1 / 2")
pages.append(img)

img, draw = new_page()
draw.text((MARGIN, 110), "दूसरा पेज — भुगतान विवरण", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 220), "Token: TOKEN-SCAN-102", font=mono, fill=(160, 20, 20))
draw.text((MARGIN, 300), "पहली किस्त: 283000 रुपये (प्राप्त)", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 360), "दूसरी किस्त: 162000 रुपये (बाकी)", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 440), "Second instalment is still pending as of this scan.", font=hindi_small, fill=(20, 20, 20))
footer(draw, "पेज 2 / 2")
pages.append(img)
save_pdf(pages, "scanned-hindi-en.pdf", ["p1", "p2"])

# ---------------------------------------------------------------- 2. multi-page scanned with a table on page 3
pages = []
img, draw = new_page()
draw.text((MARGIN, 110), "शिक्षा छात्रवृत्ति योजना 2027", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 200), "Token: TOKEN-OCR-201", font=mono, fill=(160, 20, 20))
draw.text((MARGIN, 280), "योजना का उद्देश्य: ग्रामीण छात्रों को छात्रवृत्ति।", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 340), "कुल छात्र: 120", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 400), "प्रति छात्र राशि: 25000 रुपये", font=hindi_f, fill=(20, 20, 20))
footer(draw, "पेज 1 / 3")
pages.append(img)

img, draw = new_page()
draw.text((MARGIN, 110), "पेज दो — पात्रता और शर्तें", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 200), "Token: TOKEN-OCR-202", font=mono, fill=(160, 20, 20))
draw.text((MARGIN, 280), "पात्र जिले: गोरखपुर, वाराणसी, लखनऊ।", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 340), "आवेदन की अंतिम तिथि: 31 जनवरी 2027", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 400), "Eligibility: minimum 60 percent marks.", font=hindi_small, fill=(20, 20, 20))
footer(draw, "पेज 2 / 3")
pages.append(img)

img, draw = new_page()
draw.text((MARGIN, 110), "पेज तीन — बजट तालिका", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 200), "Token: TOKEN-OCR-203", font=mono, fill=(160, 20, 20))
rows = [
    ["मद", "राशि (रुपये)"],
    ["हार्डवेयर", "445000"],
    ["सॉफ्टवेयर", "283000"],
    ["प्रशिक्षण", "162000"],
    ["कुल", "890000"],
]
table(draw, MARGIN, 300, rows, [420, 360], hindi_f)
draw.text((MARGIN, 620), "Table caption: budget split by category", font=hindi_small, fill=(20, 20, 20))
footer(draw, "पेज 3 / 3")
pages.append(img)
save_pdf(pages, "scanned-multipage.pdf", ["p1", "p2", "p3"])

# ---------------------------------------------------------------- 3. scanned table only
img, draw = new_page()
draw.text((MARGIN, 110), "Invoice summary / इनवॉइस सारांश", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 200), "Token: TOKEN-TABLE-301", font=mono, fill=(160, 20, 20))
rows = [
    ["Item", "Qty", "Rate", "Amount"],
    ["Notebook", "10", "445", "4450"],
    ["Pen", "100", "28", "2800"],
    ["Printer", "2", "12000", "24000"],
    ["Total", "", "", "31250"],
]
table(draw, MARGIN, 300, rows, [280, 160, 220, 260], hindi_f)
draw.text((MARGIN, 620), "भुगतान स्थिति: बाकी", font=hindi_f, fill=(20, 20, 20))
footer(draw, "पेज 1 / 1")
save_pdf([img], "scanned-table.pdf", ["p1"])

# ---------------------------------------------------------------- 4. mixed PDF: text page + scanned page
doc = pymupdf.open()
page = doc.new_page(width=595, height=842)
page.insert_font(fontname="noto", fontfile=FONT)
page.insert_text((60, 90), "Mixed PDF - page 1 has a real text layer", fontname="noto", fontsize=16)
page.insert_text((60, 130), "Token: TOKEN-MIX-601", fontname="noto", fontsize=14)
page.insert_text((60, 170), "यह पेज असली टेक्स्ट लेयर है, OCR की ज़रूरत नहीं।", fontname="noto", fontsize=13)
page.insert_text((60, 210), "Budget on this page: 445000 rupees", fontname="noto", fontsize=13)

img, draw = new_page()
draw.text((MARGIN, 110), "पेज दो — स्कैन किया गया पेज", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 200), "Token: TOKEN-MIX-602", font=mono, fill=(160, 20, 20))
draw.text((MARGIN, 280), "यह पेज इमेज है, इसे OCR से पढ़ना पड़ेगा।", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 340), "Pending amount: 162000 rupees", font=hindi_small, fill=(20, 20, 20))
footer(draw, "पेज 2 / 2")
tmp = os.path.join(OUT, ".tmp-mixed-page2.jpg")
img.resize((900, int(img.height * 900 / img.width)), Image.LANCZOS).save(tmp, "JPEG", quality=85)
page2 = doc.new_page(width=595, height=842)
page2.insert_image(page2.rect, filename=tmp)
doc.save(os.path.join(OUT, "scanned-mixed.pdf"))
doc.close()
os.remove(tmp)
print("wrote scanned-mixed.pdf")

# ---------------------------------------------------------------- 5. Hindi image note
img, draw = new_page()
draw.text((MARGIN, 110), "मीटिंग नोट — 12 नवंबर 2027", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 200), "Token: TOKEN-HINDI-401", font=mono, fill=(160, 20, 20))
draw.text((MARGIN, 280), "निर्णय: फ़ाइल अपलोड और OCR दोनों चालू रहेंगे।", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 340), "ज़िम्मेदार व्यक्ति: विनाय कुशवाहा", font=hindi_f, fill=(20, 20, 20))
draw.text((MARGIN, 400), "बजट: 445000 रुपये", font=hindi_f, fill=(20, 20, 20))
img.save(os.path.join(OUT, "hindi-note.png"))

# ---------------------------------------------------------------- 6. English table image
img, draw = new_page()
draw.text((MARGIN, 110), "Quarterly revenue table", font=title_f, fill=(10, 30, 80))
draw.text((MARGIN, 200), "Token: TOKEN-TBLIMG-501", font=mono, fill=(160, 20, 20))
rows = [
    ["Quarter", "Revenue"],
    ["Q1", "445000"],
    ["Q2", "283000"],
    ["Q3", "162000"],
]
table(draw, MARGIN, 300, rows, [320, 320], hindi_f)
img.save(os.path.join(OUT, "table-image.png"))

for name in sorted(os.listdir(OUT)):
    if name.startswith("."):
        continue
    print(f"  {name:26} {os.path.getsize(os.path.join(OUT, name))} bytes")
