#!/usr/bin/env python3
"""Generate the M06 file-upload fixtures (one file per supported format).

Every fixture carries a unique token plus a number so an AI answer can be checked
against the real document content instead of a guess.

    python3 tools/make-upload-fixtures.py [outdir]   # default artifacts/m06-fixtures
"""
import csv
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches, Pt as PPt
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import xlwt

OUT = sys.argv[1] if len(sys.argv) > 1 else "artifacts/m06-fixtures"
os.makedirs(OUT, exist_ok=True)


def path(name):
    return os.path.join(OUT, name)


# ---------------------------------------------------------------- PDF
c = canvas.Canvas(path("sample.pdf"), pagesize=A4)
c.setFont("Helvetica-Bold", 16)
c.drawString(60, 780, "SHAVI AI - PDF upload fixture")
c.setFont("Helvetica", 12)
c.drawString(60, 750, "Token: TOKEN-PDF-4417")
c.drawString(60, 730, "Project: Ganga Cleanup Drive")
c.drawString(60, 710, "Budget: 445000 rupees")
c.drawString(60, 690, "City: Gorakhpur")
c.drawString(60, 660, "Page 1 of 2 - introduction")
c.showPage()
c.setFont("Helvetica-Bold", 14)
c.drawString(60, 780, "Page 2 - Payment schedule")
c.setFont("Helvetica", 12)
c.drawString(60, 750, "First instalment: 283000 rupees")
c.drawString(60, 730, "Second instalment: 162000 rupees")
c.drawString(60, 710, "Deadline: 15 March 2027")
c.drawString(60, 690, "Token repeated: TOKEN-PDF-4417")
c.save()

# ---------------------------------------------------------------- DOCX
doc = Document()
doc.add_heading("SHAVI AI - DOCX upload fixture", level=1)
doc.add_paragraph("Token: TOKEN-DOCX-5521")
doc.add_paragraph("नीति दस्तावेज़: शिक्षा छात्रवृत्ति योजना 2027")
p = doc.add_paragraph()
p.add_run("Scholarship amount: 25000 rupees per student. ").bold = True
doc.add_paragraph("Eligible districts: Gorakhpur, Varanasi, Lucknow.")
table = doc.add_table(rows=3, cols=2)
rows = [("Item", "Value"), ("Students", "120"), ("Total", "3000000")]
for i, (k, v) in enumerate(rows):
    table.cell(i, 0).text = k
    table.cell(i, 1).text = v
doc.save(path("sample.docx"))

# ---------------------------------------------------------------- XLSX
wb = Workbook()
ws = wb.active
ws.title = "Budget"
ws.append(["Category", "Amount"])
ws.append(["Hardware", 445000])
ws.append(["Software", 283000])
ws.append(["Training", 162000])
ws.append(["Token", "TOKEN-XLSX-6633"])
ws2 = wb.create_sheet("Team")
ws2.append(["Name", "Role"])
ws2.append(["Vînâý", "Lead"])
ws2.append(["Token", "TOKEN-XLSX-6633"])
wb.save(path("sample.xlsx"))

# ---------------------------------------------------------------- XLS (legacy)
book = xlwt.Workbook()
sheet = book.add_sheet("Sales")
data = [
    ("Region", "Revenue"),
    ("East", 445000),
    ("West", 283000),
    ("North", 162000),
    ("Token", "TOKEN-XLS-7744"),
]
for r, row in enumerate(data):
    for col, val in enumerate(row):
        sheet.write(r, col, val)
book.save(path("sample.xls"))

# ---------------------------------------------------------------- CSV
with open(path("sample.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["product", "qty", "price"])
    w.writerow(["notebook", 10, 445])
    w.writerow(["pen", 100, 28])
    w.writerow(["token", "TOKEN-CSV-8855", ""])

# ---------------------------------------------------------------- PPTX
prs = Presentation()
s1 = prs.slides.add_slide(prs.slide_layouts[1])
s1.shapes.title.text = "SHAVI AI - PPTX upload fixture"
tf = s1.placeholders[1].text_frame
tf.text = "Token: TOKEN-PPTX-9966"
p2 = tf.add_paragraph()
p2.text = "Launch city: Gorakhpur"
p3 = tf.add_paragraph()
p3.text = "Launch budget: 445000 rupees"
s2 = prs.slides.add_slide(prs.slide_layouts[5])
s2.shapes.title.text = "Roadmap"
box = s2.shapes.add_textbox(Inches(1), Inches(2), Inches(6), Inches(2))
btf = box.text_frame
btf.text = "Q1: research"
q = btf.add_paragraph()
q.text = "Q2: launch with 120 students"
prs.save(path("sample.pptx"))

# ---------------------------------------------------------------- JSON
payload = {
    "token": "TOKEN-JSON-1177",
    "project": "Shavi AI file upload",
    "budget_rupees": 445000,
    "team": [{"name": "Vînâý", "role": "lead"}, {"name": "Ananya", "role": "design"}],
    "formats": ["pdf", "docx", "xlsx", "csv", "pptx", "json", "txt", "image"],
}
with open(path("sample.json"), "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, indent=2)

# ---------------------------------------------------------------- TXT
with open(path("sample.txt"), "w", encoding="utf-8") as fh:
    fh.write("SHAVI AI - TXT upload fixture\n")
    fh.write("Token: TOKEN-TXT-3399\n")
    fh.write("मीटिंग नोट्स: 12 नवंबर 2027, गोरखपुर।\n")
    fh.write("Decision: ship file upload with 9 formats.\n")
    fh.write("Owner: Vînâý Kushwaha. Blocking issue: none.\n")

# ---------------------------------------------------------------- images
def make_image(name, token, size=(900, 600), color=(250, 250, 248)):
    img = Image.new("RGB", size, color)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 54)
        small = ImageFont.truetype("DejaVuSans.ttf", 34)
    except OSError:
        font = small = ImageFont.load_default()
    d.rectangle([40, 40, size[0] - 40, size[1] - 40], outline=(20, 90, 160), width=6)
    d.text((80, 110), "SHAVI VISION", font=font, fill=(20, 40, 80))
    d.text((80, 210), token, font=font, fill=(200, 40, 40))
    d.text((80, 320), "Invoice total: 445000 rupees", font=small, fill=(30, 30, 30))
    d.text((80, 380), "City: Gorakhpur", font=small, fill=(30, 30, 30))
    d.text((80, 450), "Date: 15 March 2027", font=small, fill=(30, 30, 30))
    img.save(path(name), quality=92)


make_image("sample.png", "TOKEN-IMG-2288")
make_image("sample.jpg", "TOKEN-JPG-6611", color=(252, 250, 245))

for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)), "bytes")
