#!/usr/bin/env python3
"""Build the PDF toolbox: one hub page + one standalone page per tool.

Run from the repo root:  python3 tools/build_pdf_tools.py
Output: pdf/index.html and pdf/<tool>.html
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from pdf_extra_convert import EXTRA_CONVERT  # noqa: E402
from pdf_extra_edit import EXTRA_EDIT  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "pdf"

NAV = """    <header class="top">
      <div class="wrap">
        <a class="brand" href="/pdf/">
          <span class="brand-badge">📄</span>
          <span>PDF Toolbox<small>VK TECH LEARN</small></span>
        </a>
        <nav>
          <a href="/pdf/">All tools</a>
          <a href="/pdf/compress.html">Compress</a>
          <a href="/pdf/merge.html">Merge</a>
          <a href="/pdf/protect.html">Protect</a>
          <a href="https://vktechlearn.site/">Main site</a>
        </nav>
      </div>
    </header>"""

FOOT = """    <footer class="foot">
      <div class="wrap">
        Files are processed inside your browser — nothing is uploaded to a server.
        Made by <a href="https://vktechlearn.site/">Vïnâý Kúshwâhå</a>.
      </div>
    </footer>"""


def page(tool):
    related = "".join(
        f'<a href="/pdf/{slug}.html" target="_blank" rel="noopener">{name}</a>'
        for slug, name in tool["related"]
    )
    steps = "".join(f"<li>{s}</li>" for s in tool["steps"])
    rules = "".join(
        f'<li class="{"warn" if warn else ""}">{text}</li>' for text, warn in tool["rules"]
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{tool['name']} — Free Online PDF Tool | VK Tech Learn</title>
<meta name="description" content="{tool['meta']}">
<link rel="canonical" href="https://vktechlearn.site/pdf/{tool['slug']}.html">
<link rel="stylesheet" href="/pdf/style.css">
<script src="/pdf/app.js"></script>
</head>
<body>
{NAV}

<main class="wrap">
  <div class="tool-head">
    <div class="eyebrow">{tool['cat']}</div>
    <h1>{tool['icon']} {tool['name']}</h1>
    <p>{tool['desc']}</p>
    <div class="related">{related}</div>
  </div>

  <div class="two-col">
    <section class="panel">
      <h2><span>1</span>Upload &amp; set options</h2>
{tool['body']}
      <div class="status" id="status"></div>
      <div class="output" id="output"></div>
    </section>

    <aside>
      <section class="panel">
        <h2><span>2</span>How to use</h2>
        <ol class="steps">{steps}</ol>
      </section>
      <section class="panel">
        <h2><span>3</span>Rules &amp; limits</h2>
        <ul class="rules">{rules}</ul>
      </section>
    </aside>
  </div>
</main>

{FOOT}
<script>
{tool['script']}
</script>
</body>
</html>
"""


HUB = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF Toolbox — 12 Free PDF Tools That Run in Your Browser | VK Tech Learn</title>
<meta name="description" content="Merge, split, compress, rotate, watermark, sign, annotate, protect and inspect PDFs free. Every tool runs inside your browser — your files never leave your device.">
<link rel="canonical" href="https://vktechlearn.site/pdf/">
<link rel="stylesheet" href="/pdf/style.css">
<script src="/pdf/app.js"></script>
</head>
<body>
{nav}

<main class="wrap">
  <section class="hero">
    <h1>Every PDF tool you need, in one place</h1>
    <p>12 free tools to merge, split, compress, rotate, watermark, sign, annotate and protect PDF files.
       Everything runs in your browser, so your documents never leave your device.</p>
    <div class="chips">
      <span class="chip">100% free</span>
      <span class="chip">No sign-up</span>
      <span class="chip">No uploads</span>
      <span class="chip">Works on mobile</span>
    </div>
  </section>

  <div class="filters" id="filters">
{filters}
  </div>
  <p class="count" id="count">{count} tools</p>

  <section class="grid" id="grid">
{cards}
  </section>
</main>

<script>
(function () {
  const buttons = Array.from(document.querySelectorAll('.filter'));
  const cards = Array.from(document.querySelectorAll('.card'));
  const count = document.getElementById('count');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.filter;
      let shown = 0;
      cards.forEach((card) => {
        const match = cat === 'all' || card.dataset.cat === cat;
        card.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      count.textContent = shown + (shown === 1 ? ' tool' : ' tools');
    });
  });
})();
</script>

{foot}
</body>
</html>
"""


def hub_card(tool):
    return f"""    <a class="card" href="/pdf/{tool['slug']}.html" target="_blank" rel="noopener" data-cat="{tool['cat']}">
      <div class="card-icon">{tool['icon']}</div>
      <div class="eyebrow">{tool['cat']}</div>
      <h3>{tool['name']}</h3>
      <p>{tool['desc']}</p>
      <span class="go">Open tool →</span>
    </a>"""


FILE_FIELD = """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
        <div class="hint">One PDF file, up to 50 MB.</div>
      </div>"""

PREVIEW = """      <div class="field">
        <label>Preview</label>
        <div class="preview" id="preview">No file selected yet.</div>
      </div>"""


# ---------------------------------------------------------------- tools

MERGE = {
    "slug": "merge",
    "name": "Merge PDF",
    "icon": "🧩",
    "desc": "Combine two or more PDF files into a single document, in the order you choose.",
    "meta": "Merge PDF files free in your browser. Add up to 50 MB per file, reorder pages and download one combined PDF.",
    "steps": [
        "Select <strong>two or more PDF files</strong> with the file picker.",
        "Check the list — use ▲ ▼ to change the order, ✕ to remove a file.",
        "Press <strong>Merge PDFs</strong> and wait for the green message.",
        "Click <strong>Download merged.pdf</strong> to save the combined file.",
    ],
    "rules": [
        ("At least 2 PDF files are required.", True),
        ("Each file can be up to 50 MB.", False),
        ("Password-protected PDFs are rejected — unlock them first.", True),
        ("Your files stay in the browser; nothing is uploaded.", False),
    ],
    "related": [("split", "Split PDF"), ("extract", "Extract Pages"), ("compress", "Compress PDF")],
    "body": """      <div class="field">
        <label for="file">PDF files to merge</label>
        <input type="file" id="file" accept="application/pdf" multiple>
        <div class="hint">Pick 2 or more files. Each file can be up to 50 MB.</div>
      </div>
      <ul class="list" id="list"></ul>
      <div class="actions">
        <button class="btn" id="run" type="button">Merge PDFs</button>
        <button class="btn secondary" id="clear" type="button">Clear list</button>
      </div>
      <div class="field" style="margin-top:1rem">
        <label>Preview (first file)</label>
        <div class="preview" id="preview">No file selected yet.</div>
      </div>""",
    "script": """const fileInput = document.getElementById('file');
const listEl = document.getElementById('list');
const runBtn = document.getElementById('run');
const clearBtn = document.getElementById('clear');
let items = [];
let seq = 0;

function render() {
  listEl.innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="num">' + (i + 1) + '</span>' +
      '<span class="name">' + it.file.name + ' · ' + formatBytes(it.file.size) + '</span>' +
      '<button type="button" data-act="up" data-id="' + it.id + '" title="Move up">▲</button>' +
      '<button type="button" data-act="down" data-id="' + it.id + '" title="Move down">▼</button>' +
      '<button type="button" data-act="del" data-id="' + it.id + '" title="Remove">✕</button>';
    listEl.appendChild(li);
  });
  if (items.length) renderPreview(items[0].file, 'preview', 2);
  else document.getElementById('preview').textContent = 'No file selected yet.';
}

fileInput.addEventListener('change', (e) => {
  for (const f of e.target.files || []) items.push({ id: 'f' + (++seq), file: f });
  fileInput.value = '';
  clearStatus();
  document.getElementById('output').innerHTML = '';
  render();
});

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const i = items.findIndex((x) => x.id === btn.dataset.id);
  if (i < 0) return;
  const act = btn.dataset.act;
  if (act === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
  if (act === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
  if (act === 'del') items.splice(i, 1);
  render();
});

clearBtn.addEventListener('click', () => {
  items = [];
  clearStatus();
  document.getElementById('output').innerHTML = '';
  render();
});

runBtn.addEventListener('click', async () => {
  if (items.length < 2) { setStatus('err', 'Please select at least 2 PDF files to merge.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Merge PDFs', 'Merging…');
  setStatus('info', 'Merging ' + items.length + ' files…');
  try {
    await ensureLibs();
    const merged = await PDFLib.PDFDocument.create();
    for (const it of items) {
      const bytes = await readFileBytes(it.file);
      const src = await PDFLib.PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const out = await merged.save();
    addDownload(out, 'merged.pdf', 'Download merged.pdf');
    setStatus('ok', '✅ Merged ' + items.length + ' files into ' + merged.getPageCount() + ' pages.');
  } catch (err) {
    setStatus('err', '❌ Could not merge: ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Merge PDFs');
  }
});

render();""",
}

SPLIT = {
    "slug": "split",
    "name": "Split PDF",
    "icon": "✂️",
    "desc": "Pick the pages you want from a PDF and save them as a new, smaller document.",
    "meta": "Split a PDF online for free. Choose pages like 1-3,5 and download a new PDF — processed locally in your browser.",
    "steps": [
        "Choose the PDF you want to split.",
        "Type the page range — for example <strong>1-3,5</strong>; leave it empty for all pages.",
        "Set the output filename.",
        "Press <strong>Split PDF</strong> and download the result.",
    ],
    "rules": [
        ("Page numbers start at 1 and must exist in the document.", True),
        ("Use commas for single pages and a hyphen for ranges: 1,3,5-7.", False),
        ("Empty page box = every page is copied.", False),
        ("Maximum file size is 50 MB.", False),
    ],
    "related": [("extract", "Extract Pages"), ("merge", "Merge PDF"), ("rotate", "Rotate PDF")],
    "body": FILE_FIELD + """      <div class="row">
        <div class="field">
          <label for="range">Pages to keep</label>
          <input type="text" id="range" placeholder="e.g. 1-3,5">
          <div class="hint">Leave empty to keep all pages.</div>
        </div>
        <div class="field">
          <label for="name">Output filename</label>
          <input type="text" id="name" value="split.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Split PDF</button></div>
""" + PREVIEW,
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 2);
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Split PDF', 'Splitting…');
  setStatus('info', 'Reading the document…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const src = await PDFLib.PDFDocument.load(bytes);
    const total = src.getPageCount();
    const idx = parsePageRange(document.getElementById('range').value, total);
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(src, idx);
    pages.forEach((p) => out.addPage(p));
    const bytesOut = await out.save();
    const name = (document.getElementById('name').value || 'split.pdf').trim();
    addDownload(bytesOut, name, 'Download ' + name);
    setStatus('ok', '✅ Saved ' + idx.length + ' of ' + total + ' pages.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Split PDF');
  }
});""",
}

ROTATE = {
    "slug": "rotate",
    "name": "Rotate PDF",
    "icon": "🔄",
    "desc": "Turn every page of a PDF by 90°, 180° or 270° so scans and photos sit upright.",
    "meta": "Rotate PDF pages online free. Fix sideways scans by 90, 180 or 270 degrees in your browser.",
    "steps": [
        "Choose the PDF that needs rotating.",
        "Pick the angle: 90° clockwise, 180°, or 270°.",
        "Press <strong>Rotate PDF</strong>.",
        "Download the rotated file and check the preview.",
    ],
    "rules": [
        ("The angle is applied to every page in the file.", False),
        ("Rotation is saved in the PDF itself, so it opens correctly everywhere.", False),
        ("Running the tool twice adds the angles together.", True),
        ("Maximum file size is 50 MB.", False),
    ],
    "related": [("merge", "Merge PDF"), ("split", "Split PDF"), ("compress", "Compress PDF")],
    "body": FILE_FIELD + """      <div class="row">
        <div class="field">
          <label for="angle">Rotation</label>
          <select id="angle">
            <option value="90">90° clockwise</option>
            <option value="180">180° (upside down)</option>
            <option value="270">270° (90° anticlockwise)</option>
          </select>
        </div>
        <div class="field">
          <label for="name">Output filename</label>
          <input type="text" id="name" value="rotated.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Rotate PDF</button></div>
""" + PREVIEW,
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 2);
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Rotate PDF', 'Rotating…');
  setStatus('info', 'Rotating pages…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const doc = await PDFLib.PDFDocument.load(bytes);
    const angle = parseInt(document.getElementById('angle').value, 10);
    const pages = doc.getPages();
    pages.forEach((p) => p.setRotation(PDFLib.degrees(p.getRotation().angle + angle)));
    const out = await doc.save();
    const name = (document.getElementById('name').value || 'rotated.pdf').trim();
    addDownload(out, name, 'Download ' + name);
    setStatus('ok', '✅ Rotated ' + pages.length + ' page(s) by ' + angle + '°.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Rotate PDF');
  }
});""",
}

WATERMARK = {
    "slug": "watermark",
    "name": "Add Watermark",
    "icon": "💧",
    "desc": "Stamp text such as CONFIDENTIAL or DRAFT diagonally across every page.",
    "meta": "Add a text watermark to a PDF free. Control size, colour and opacity — all in your browser.",
    "steps": [
        "Choose the PDF you want to watermark.",
        "Type the watermark text, size and opacity.",
        "Pick a colour (grey, red, blue or black).",
        "Press <strong>Add watermark</strong> and download the file.",
    ],
    "rules": [
        ("The watermark is drawn diagonally on every page.", False),
        ("Opacity 0.1–0.8 keeps the text visible without hiding content.", False),
        ("Watermark text is limited to the Latin alphabet (Helvetica font).", True),
        ("Maximum file size is 50 MB.", False),
    ],
    "related": [("protect", "Protect PDF"), ("annotate", "Annotation"), ("sign", "Sign PDF")],
    "body": FILE_FIELD + """      <div class="row">
        <div class="field">
          <label for="text">Watermark text</label>
          <input type="text" id="text" value="CONFIDENTIAL">
        </div>
        <div class="field">
          <label for="size">Font size</label>
          <input type="number" id="size" value="48" min="8" max="120">
        </div>
      </div>
      <div class="row-3">
        <div class="field">
          <label for="opacity">Opacity</label>
          <input type="range" id="opacity" min="0.1" max="0.8" step="0.05" value="0.3">
        </div>
        <div class="field">
          <label for="color">Colour</label>
          <select id="color">
            <option value="gray">Grey</option>
            <option value="red">Red</option>
            <option value="blue">Blue</option>
            <option value="black">Black</option>
          </select>
        </div>
        <div class="field">
          <label for="name">Output filename</label>
          <input type="text" id="name" value="watermarked.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Add watermark</button></div>
""" + PREVIEW,
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 2);
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Add watermark', 'Adding…');
  setStatus('info', 'Drawing the watermark…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const doc = await PDFLib.PDFDocument.load(bytes);
    const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const text = document.getElementById('text').value || 'CONFIDENTIAL';
    const size = parseInt(document.getElementById('size').value, 10) || 48;
    const opacity = parseFloat(document.getElementById('opacity').value) || 0.3;
    const colors = {
      gray: PDFLib.rgb(0.45, 0.45, 0.45),
      red: PDFLib.rgb(0.85, 0.1, 0.1),
      blue: PDFLib.rgb(0.1, 0.25, 0.75),
      black: PDFLib.rgb(0, 0, 0)
    };
    const color = colors[document.getElementById('color').value] || colors.gray;
    const pages = doc.getPages();
    pages.forEach((p) => {
      const { width, height } = p.getSize();
      p.drawText(text, { x: width / 4, y: height / 2, size, font, color, opacity, rotate: PDFLib.degrees(45) });
    });
    const out = await doc.save();
    const name = (document.getElementById('name').value || 'watermarked.pdf').trim();
    addDownload(out, name, 'Download ' + name);
    setStatus('ok', '✅ Watermark added to ' + pages.length + ' page(s).');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Add watermark');
  }
});""",
}

ANNOTATE = {
    "slug": "annotate",
    "name": "PDF Annotation",
    "icon": "🖍️",
    "desc": "Drop a coloured highlight box with your note anywhere on a page.",
    "meta": "Annotate PDF online free — add a highlight box and note text on any page, saved straight into the PDF.",
    "steps": [
        "Choose the PDF you want to annotate.",
        "Type the note and the page number.",
        "Pick a highlight colour and set the X/Y position (points from the bottom-left).",
        "Press <strong>Add annotation</strong> and download.",
    ],
    "rules": [
        ("Position is measured in PDF points from the bottom-left corner (A4 = 595 × 842).", False),
        ("The note is drawn as a new layer; the original text is not changed.", False),
        ("Repeat the tool to add more notes — each run adds one box.", False),
        ("Maximum file size is 50 MB.", True),
    ],
    "related": [("edit", "Add Text"), ("sign", "Sign PDF"), ("watermark", "Watermark")],
    "body": FILE_FIELD + """      <div class="row">
        <div class="field">
          <label for="text">Note text</label>
          <input type="text" id="text" placeholder="e.g. Check this number">
        </div>
        <div class="field">
          <label for="page">Page number</label>
          <input type="number" id="page" value="1" min="1">
        </div>
      </div>
      <div class="row-3">
        <div class="field">
          <label for="color">Highlight</label>
          <select id="color">
            <option value="yellow">Yellow</option>
            <option value="lime">Lime</option>
            <option value="cyan">Cyan</option>
            <option value="pink">Pink</option>
            <option value="orange">Orange</option>
          </select>
        </div>
        <div class="field">
          <label for="x">X position</label>
          <input type="number" id="x" value="72">
        </div>
        <div class="field">
          <label for="y">Y position</label>
          <input type="number" id="y" value="700">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Add annotation</button></div>
""" + PREVIEW,
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 2);
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Add annotation', 'Adding…');
  setStatus('info', 'Adding the note…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const doc = await PDFLib.PDFDocument.load(bytes);
    const pages = doc.getPages();
    const pageNum = Math.max(1, parseInt(document.getElementById('page').value, 10) || 1);
    if (pageNum > pages.length) throw new Error('This document has only ' + pages.length + ' pages.');
    const page = pages[pageNum - 1];
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const text = document.getElementById('text').value || 'Annotation';
    const x = parseFloat(document.getElementById('x').value) || 72;
    const y = parseFloat(document.getElementById('y').value) || 700;
    const colors = {
      yellow: PDFLib.rgb(1, 1, 0.4),
      lime: PDFLib.rgb(0.7, 1, 0.5),
      cyan: PDFLib.rgb(0.5, 1, 1),
      pink: PDFLib.rgb(1, 0.6, 0.8),
      orange: PDFLib.rgb(1, 0.7, 0.3)
    };
    const color = colors[document.getElementById('color').value] || colors.yellow;
    const boxWidth = Math.max(font.widthOfTextAtSize(text, 12) + 20, 200);
    page.drawRectangle({ x, y, width: boxWidth, height: 30, color, opacity: 0.45, borderColor: color, borderWidth: 1 });
    page.drawText(text, { x: x + 10, y: y + 9, size: 12, font, color: PDFLib.rgb(0, 0, 0) });
    const out = await doc.save();
    addDownload(out, 'annotated.pdf', 'Download annotated.pdf');
    setStatus('ok', '✅ Note added on page ' + pageNum + '.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Add annotation');
  }
});""",
}

SIGN = {
    "slug": "sign",
    "name": "Sign PDF",
    "icon": "✍️",
    "desc": "Draw your signature with a mouse or finger and place it on any page.",
    "meta": "Sign a PDF free in your browser. Draw a signature, choose the page and position, and download the signed file.",
    "steps": [
        "Draw your signature in the white pad (mouse, stylus or finger).",
        "Choose the PDF, the page and the scale.",
        "Set X/Y position — 400/100 places it bottom-right on A4.",
        "Press <strong>Apply signature</strong> and download.",
    ],
    "rules": [
        ("The signature is a transparent PNG, so the page content stays visible.", False),
        ("Use X ≈ 400 and Y ≈ 100 for a bottom-right signature on an A4 page.", False),
        ("Page numbers start at 1.", True),
        ("Maximum file size is 50 MB.", False),
    ],
    "related": [("annotate", "Annotation"), ("protect", "Protect PDF"), ("edit", "Add Text")],
    "body": """      <div class="field">
        <label>Draw your signature</label>
        <canvas class="sign-pad" id="pad" width="900" height="300"></canvas>
        <div class="actions" style="margin-top:.6rem">
          <button class="btn secondary small" id="clearPad" type="button">Clear pad</button>
          <span class="hint" style="margin:0">Draw slowly for a smooth line.</span>
        </div>
      </div>
""" + FILE_FIELD + """      <div class="row-3">
        <div class="field">
          <label for="page">Page number</label>
          <input type="number" id="page" value="1" min="1">
        </div>
        <div class="field">
          <label for="scale">Scale</label>
          <input type="number" id="scale" value="0.5" step="0.1" min="0.1" max="2">
        </div>
        <div class="field">
          <label for="x">X position</label>
          <input type="number" id="x" value="400">
        </div>
        <div class="field">
          <label for="y">Y position</label>
          <input type="number" id="y" value="100">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Apply signature</button></div>""",
    "script": """const pad = document.getElementById('pad');
const ctx = pad.getContext('2d');
const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
ctx.lineWidth = 3;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.strokeStyle = '#0b1220';

let drawing = false;
let last = null;

function pos(e) {
  const r = pad.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  return {
    x: (p.clientX - r.left) * (pad.width / r.width),
    y: (p.clientY - r.top) * (pad.height / r.height)
  };
}

function start(e) { drawing = true; last = pos(e); e.preventDefault(); }
function move(e) {
  if (!drawing) return;
  const p = pos(e);
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  last = p;
  e.preventDefault();
}
function end() { drawing = false; }

pad.addEventListener('mousedown', start);
pad.addEventListener('mousemove', move);
window.addEventListener('mouseup', end);
pad.addEventListener('touchstart', start, { passive: false });
pad.addEventListener('touchmove', move, { passive: false });
window.addEventListener('touchend', end);

document.getElementById('clearPad').addEventListener('click', () => {
  ctx.clearRect(0, 0, pad.width, pad.height);
});

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  const data = ctx.getImageData(0, 0, pad.width, pad.height).data;
  let hasInk = false;
  for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) { hasInk = true; break; } }
  if (!hasInk) { setStatus('err', 'Please draw your signature in the pad first.'); return; }

  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Apply signature', 'Signing…');
  setStatus('info', 'Placing your signature…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const doc = await PDFLib.PDFDocument.load(bytes);
    const pages = doc.getPages();
    const pageNum = Math.max(1, parseInt(document.getElementById('page').value, 10) || 1);
    if (pageNum > pages.length) throw new Error('This document has only ' + pages.length + ' pages.');
    const page = pages[pageNum - 1];
    const img = await doc.embedPng(pad.toDataURL('image/png'));
    const scale = parseFloat(document.getElementById('scale').value) || 0.5;
    const dims = img.scale(scale);
    page.drawImage(img, {
      x: parseFloat(document.getElementById('x').value) || 400,
      y: parseFloat(document.getElementById('y').value) || 100,
      width: dims.width,
      height: dims.height,
      opacity: 0.95
    });
    const out = await doc.save();
    addDownload(out, 'signed.pdf', 'Download signed.pdf');
    setStatus('ok', '✅ Signature placed on page ' + pageNum + '.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Apply signature');
  }
});""",
}

COMPRESS = {
    "slug": "compress",
    "name": "Compress PDF",
    "icon": "🗜️",
    "desc": "Shrink image-heavy and scanned PDFs by re-rendering pages at a smaller size.",
    "meta": "Compress a PDF free in your browser. Choose a quality level and download a much smaller file — no uploads.",
    "steps": [
        "Choose the PDF you want to shrink.",
        "Pick a compression level: light, balanced, strong or maximum.",
        "Press <strong>Compress PDF</strong> and watch the size comparison.",
        "Download the smaller file (or the original if it was already optimised).",
    ],
    "rules": [
        ("Pages are re-rendered as images, so text is no longer selectable.", True),
        ("Best results on scanned documents, photo PDFs and screenshot exports.", False),
        ("If the result would be larger, the original file is offered instead.", False),
        ("Large files take longer — keep the tab open until it finishes.", False),
    ],
    "related": [("merge", "Merge PDF"), ("rotate", "Rotate PDF"), ("split", "Split PDF")],
    "body": FILE_FIELD + """      <div class="row">
        <div class="field">
          <label for="level">Compression level</label>
          <select id="level">
            <option value="0.85|1.6">Light — best quality</option>
            <option value="0.72|1.3" selected>Balanced — recommended</option>
            <option value="0.6|1.05">Strong — smaller file</option>
            <option value="0.45|0.85">Maximum — smallest file</option>
          </select>
        </div>
        <div class="field">
          <label for="name">Output filename</label>
          <input type="text" id="name" value="compressed.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Compress PDF</button></div>
""" + PREVIEW,
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 2);
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  const [quality, scale] = document.getElementById('level').value.split('|').map(Number);
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Compress PDF', 'Compressing…');
  setStatus('info', 'Loading the document…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const out = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus('info', 'Compressing page ' + i + ' of ' + pdf.numPages + '…');
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const c = canvas.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: c, viewport }).promise;
      const jpg = await out.embedJpg(dataUrlToBytes(canvas.toDataURL('image/jpeg', quality)));
      const p = out.addPage([viewport.width, viewport.height]);
      p.drawImage(jpg, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    }
    const compressed = await out.save();
    let finalBytes = compressed;
    let note = '';
    if (compressed.length >= file.size) {
      finalBytes = new Uint8Array(bytes);
      note = ' This PDF is already well optimised, so the original is offered instead.';
    }
    const name = (document.getElementById('name').value || 'compressed.pdf').trim();
    addDownload(finalBytes, name, 'Download ' + name);
    const saved = file.size > finalBytes.length ? Math.round((1 - finalBytes.length / file.size) * 100) : 0;
    setStatus('ok', '✅ ' + formatBytes(file.size) + ' → ' + formatBytes(finalBytes.length) +
      ' (' + saved + '% smaller).' + note);
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Compress PDF');
  }
});""",
}

EDIT = {
    "slug": "edit",
    "name": "Add Text to PDF",
    "icon": "✏️",
    "desc": "Write new text on top of any page — labels, corrections, stamps or short notes.",
    "meta": "Add text to a PDF free. Place new text on any page with custom size, colour and position — in your browser.",
    "steps": [
        "Choose the PDF you want to write on.",
        "Type the text and the page number.",
        "Set font size, colour and X/Y position.",
        "Press <strong>Add text</strong> and download the file.",
    ],
    "rules": [
        ("This adds a new text layer — existing text is not removed or rewritten.", True),
        ("Replacing existing words needs OCR and server processing, which this tool does not do.", True),
        ("Position is measured from the bottom-left of the page in points.", False),
        ("Only Latin text is supported (Helvetica font).", False),
    ],
    "related": [("annotate", "Annotation"), ("sign", "Sign PDF"), ("watermark", "Watermark")],
    "body": FILE_FIELD + """      <div class="row">
        <div class="field">
          <label for="text">Text to add</label>
          <input type="text" id="text" value="Hello World">
        </div>
        <div class="field">
          <label for="page">Page number</label>
          <input type="number" id="page" value="1" min="1">
        </div>
      </div>
      <div class="row-3">
        <div class="field">
          <label for="size">Font size</label>
          <input type="number" id="size" value="16" min="6" max="100">
        </div>
        <div class="field">
          <label for="x">X position</label>
          <input type="number" id="x" value="72">
        </div>
        <div class="field">
          <label for="y">Y position</label>
          <input type="number" id="y" value="720">
        </div>
        <div class="field">
          <label for="color">Colour</label>
          <select id="color">
            <option value="black">Black</option>
            <option value="red">Red</option>
            <option value="blue">Blue</option>
            <option value="green">Green</option>
            <option value="white">White</option>
          </select>
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Add text</button></div>
""" + PREVIEW,
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 2);
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Add text', 'Adding…');
  setStatus('info', 'Writing the text…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const doc = await PDFLib.PDFDocument.load(bytes);
    const pages = doc.getPages();
    const pageNum = Math.max(1, parseInt(document.getElementById('page').value, 10) || 1);
    if (pageNum > pages.length) throw new Error('This document has only ' + pages.length + ' pages.');
    const page = pages[pageNum - 1];
    const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const colors = {
      black: PDFLib.rgb(0, 0, 0),
      red: PDFLib.rgb(0.8, 0.1, 0.1),
      blue: PDFLib.rgb(0.1, 0.25, 0.75),
      green: PDFLib.rgb(0, 0.55, 0.25),
      white: PDFLib.rgb(1, 1, 1)
    };
    page.drawText(document.getElementById('text').value || 'Hello World', {
      x: parseFloat(document.getElementById('x').value) || 72,
      y: parseFloat(document.getElementById('y').value) || 720,
      size: parseInt(document.getElementById('size').value, 10) || 16,
      font,
      color: colors[document.getElementById('color').value] || colors.black
    });
    const out = await doc.save();
    addDownload(out, 'edited.pdf', 'Download edited.pdf');
    setStatus('ok', '✅ Text added on page ' + pageNum + '.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Add text');
  }
});""",
}

EXTRACT = {
    "slug": "extract",
    "name": "Extract Pages",
    "icon": "📤",
    "desc": "Pull out just the pages you need — for example 1,3 and 5-7 — into a new PDF.",
    "meta": "Extract pages from a PDF free. Pick pages like 1,3,5-7 and download a new document, processed in your browser.",
    "steps": [
        "Choose the PDF file.",
        "Type the pages you need, e.g. <strong>1,3,5-7</strong>.",
        "Set the output filename.",
        "Press <strong>Extract pages</strong> and download.",
    ],
    "rules": [
        ("Pages are kept in the order they appear in the document.", False),
        ("The page range cannot be empty — this tool always needs a selection.", True),
        ("For every page, use Split PDF with an empty range instead.", False),
        ("Maximum file size is 50 MB.", False),
    ],
    "related": [("split", "Split PDF"), ("merge", "Merge PDF"), ("rotate", "Rotate PDF")],
    "body": FILE_FIELD + """      <div class="row">
        <div class="field">
          <label for="range">Pages to extract</label>
          <input type="text" id="range" placeholder="e.g. 1,3,5-7">
          <div class="hint">Commas for single pages, hyphen for ranges.</div>
        </div>
        <div class="field">
          <label for="name">Output filename</label>
          <input type="text" id="name" value="extracted.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Extract pages</button></div>
""" + PREVIEW,
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 2);
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  const range = document.getElementById('range').value;
  if (!range.trim()) { setStatus('err', 'Please type the pages you want, for example 1,3,5-7.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Extract pages', 'Extracting…');
  setStatus('info', 'Extracting pages…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const src = await PDFLib.PDFDocument.load(bytes);
    const total = src.getPageCount();
    const idx = parsePageRange(range, total);
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(src, idx);
    pages.forEach((p) => out.addPage(p));
    const bytesOut = await out.save();
    const name = (document.getElementById('name').value || 'extracted.pdf').trim();
    addDownload(bytesOut, name, 'Download ' + name);
    setStatus('ok', '✅ Extracted ' + idx.length + ' page(s) from ' + total + '.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Extract pages');
  }
});""",
}

BLANK = {
    "slug": "blank",
    "name": "Create Blank PDF",
    "icon": "📄",
    "desc": "Generate an empty PDF with as many pages as you want, in A4, Letter, Legal or A3.",
    "meta": "Create a blank PDF free — choose page count and size (A4, Letter, Legal, A3) and download instantly.",
    "steps": [
        "Enter how many pages you need (1–100).",
        "Choose the page size.",
        "Name the file.",
        "Press <strong>Create PDF</strong> and download.",
    ],
    "rules": [
        ("Maximum 100 pages per file.", True),
        ("Supported sizes: A4, Letter, Legal and A3.", False),
        ("The PDF has no text or margins — it is completely empty.", False),
        ("Works offline once the page has loaded.", False),
    ],
    "related": [("merge", "Merge PDF"), ("split", "Split PDF"), ("protect", "Protect PDF")],
    "body": """      <div class="row">
        <div class="field">
          <label for="pages">Number of pages</label>
          <input type="number" id="pages" value="1" min="1" max="100">
        </div>
        <div class="field">
          <label for="size">Page size</label>
          <select id="size">
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">Letter (8.5 × 11 in)</option>
            <option value="legal">Legal (8.5 × 14 in)</option>
            <option value="a3">A3 (297 × 420 mm)</option>
          </select>
        </div>
        <div class="field">
          <label for="name">Filename</label>
          <input type="text" id="name" value="blank.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Create PDF</button></div>""",
    "script": """const runBtn = document.getElementById('run');

runBtn.addEventListener('click', async () => {
  const pages = Math.max(1, Math.min(100, parseInt(document.getElementById('pages').value, 10) || 1));
  const sizeKey = document.getElementById('size').value;
  const name = (document.getElementById('name').value || 'blank.pdf').trim();
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Create PDF', 'Creating…');
  setStatus('info', 'Building the document…');
  try {
    await ensureLibs();
    const doc = await PDFLib.PDFDocument.create();
    const sizes = {
      a4: PDFLib.PageSizes.A4,
      letter: PDFLib.PageSizes.Letter,
      legal: PDFLib.PageSizes.Legal,
      a3: PDFLib.PageSizes.A3
    };
    const size = sizes[sizeKey] || PDFLib.PageSizes.A4;
    for (let i = 0; i < pages; i++) doc.addPage(size);
    doc.setTitle('Blank PDF');
    doc.setProducer('VK PDF Toolbox');
    doc.setCreationDate(new Date());
    const out = await doc.save();
    addDownload(out, name, 'Download ' + name);
    setStatus('ok', '✅ Created ' + pages + ' blank page(s).');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Create PDF');
  }
});""",
}

PROTECT = {
    "slug": "protect",
    "name": "Protect PDF",
    "icon": "🔒",
    "desc": "Password-protect a PDF with real AES-256 encryption and choose what the reader may do.",
    "meta": "Protect a PDF with a password free. AES-256 encryption in your browser, with print and copy permissions.",
    "steps": [
        "Choose the PDF you want to protect.",
        "Enter an open password (minimum 4 characters).",
        "Optionally set an owner password and allow printing or copying.",
        "Press <strong>Protect PDF</strong> and download the encrypted file.",
    ],
    "rules": [
        ("The open password is required — without it the PDF cannot be opened.", True),
        ("Encryption is AES-256 (PDF 1.7), applied in your browser.", False),
        ("Editing, annotating and page extraction are blocked by default.", False),
        ("There is no password recovery — store the password safely.", True),
        ("Already-protected PDFs must be unlocked before using this tool.", True),
    ],
    "related": [("watermark", "Watermark"), ("sign", "Sign PDF"), ("info", "PDF Info")],
    "body": FILE_FIELD + """      <div class="row">
        <div class="field">
          <label for="pass">Open password (required)</label>
          <input type="password" id="pass" placeholder="At least 4 characters">
        </div>
        <div class="field">
          <label for="owner">Owner password (optional)</label>
          <input type="password" id="owner" placeholder="Defaults to the open password">
        </div>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" id="allowPrint" checked> Allow printing</label>
        <label class="check"><input type="checkbox" id="allowCopy"> Allow copying text</label>
      </div>
      <div class="field" style="margin-top:.9rem">
        <label for="name">Output filename</label>
        <input type="text" id="name" value="protected.pdf">
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Protect PDF</button></div>""",
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  const pass = document.getElementById('pass').value;
  if (pass.length < 4) { setStatus('err', 'Please use a password with at least 4 characters.'); return; }
  const owner = document.getElementById('owner').value || pass;
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Protect PDF', 'Encrypting…');
  setStatus('info', 'Encrypting with AES-256…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const doc = await PDFLib.PDFDocument.load(bytes);
    doc.encrypt({
      userPassword: pass,
      ownerPassword: owner,
      permissions: {
        printing: document.getElementById('allowPrint').checked,
        copying: document.getElementById('allowCopy').checked,
        modifying: false,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false
      }
    });
    const out = await doc.save();
    const name = (document.getElementById('name').value || 'protected.pdf').trim();
    addDownload(out, name, 'Download ' + name);
    setStatus('ok', '✅ PDF encrypted with AES-256. Share the password separately from the file.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Protect PDF');
  }
});""",
}

INFO = {
    "slug": "info",
    "name": "PDF Information",
    "icon": "ℹ️",
    "desc": "See a PDF's page count, size, title, author, dates and PDF version at a glance.",
    "meta": "Check PDF details free — pages, size, title, author, creation date and PDF version, read locally in your browser.",
    "steps": [
        "Choose any PDF file.",
        "Press <strong>Analyse PDF</strong>.",
        "Read the table: pages, size, title, author, creator and dates.",
        "Nothing is saved or uploaded.",
    ],
    "rules": [
        ("Everything is read locally from the file you choose.", False),
        ("Empty metadata is shown as “Not set” instead of a made-up value.", False),
        ("Password-protected PDFs cannot be inspected until unlocked.", True),
        ("Maximum file size is 50 MB.", False),
    ],
    "related": [("compress", "Compress PDF"), ("protect", "Protect PDF"), ("split", "Split PDF")],
    "body": FILE_FIELD + """      <div class="actions"><button class="btn" id="run" type="button">Analyse PDF</button></div>
      <div id="results" style="display:none;margin-top:1rem">
        <table class="meta">
          <tr><th>Pages</th><td id="mPages">—</td></tr>
          <tr><th>File size</th><td id="mSize">—</td></tr>
          <tr><th>PDF version</th><td id="mVersion">—</td></tr>
          <tr><th>Title</th><td id="mTitle">—</td></tr>
          <tr><th>Author</th><td id="mAuthor">—</td></tr>
          <tr><th>Creator</th><td id="mCreator">—</td></tr>
          <tr><th>Created</th><td id="mCreated">—</td></tr>
          <tr><th>Modified</th><td id="mModified">—</td></tr>
        </table>
      </div>
""" + PREVIEW,
    "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');

fileInput.addEventListener('change', () => {
  clearStatus();
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 2);
});

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  setBusy(runBtn, true, 'Analyse PDF', 'Reading…');
  setStatus('info', 'Reading the document…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const head = new TextDecoder('latin1').decode(new Uint8Array(bytes).slice(0, 8));
    const version = (head.match(/%PDF-(\\d\\.\\d)/) || [])[1];
    const doc = await PDFLib.PDFDocument.load(bytes);
    const set = (id, value) => { document.getElementById(id).textContent = value || 'Not set'; };
    set('mPages', String(doc.getPageCount()));
    set('mSize', formatBytes(file.size));
    set('mVersion', version ? 'PDF ' + version : 'Unknown');
    set('mTitle', doc.getTitle());
    set('mAuthor', doc.getAuthor());
    set('mCreator', doc.getCreator());
    const created = doc.getCreationDate();
    const modified = doc.getModificationDate();
    set('mCreated', created ? created.toLocaleString() : '');
    set('mModified', modified ? modified.toLocaleString() : '');
    document.getElementById('results').style.display = 'block';
    setStatus('ok', '✅ Read ' + doc.getPageCount() + ' page(s) from this PDF.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Analyse PDF');
  }
});""",
}

CORE = [MERGE, SPLIT, ROTATE, WATERMARK, ANNOTATE, SIGN, COMPRESS, EDIT, EXTRACT, BLANK, PROTECT, INFO]

CORE_CATS = {
    "merge": "Organize",
    "split": "Organize",
    "extract": "Organize",
    "blank": "Organize",
    "compress": "Optimize",
    "info": "Optimize",
    "rotate": "Edit",
    "watermark": "Edit",
    "annotate": "Edit",
    "edit": "Edit",
    "protect": "Security",
    "sign": "Security",
}

for _tool in CORE:
    _tool["cat"] = CORE_CATS[_tool["slug"]]

CATEGORIES = ["Organize", "Optimize", "Convert", "Edit", "Security", "Intelligence"]

ALL_TOOLS = CORE + EXTRA_CONVERT + EXTRA_EDIT
TOOLS = [t for cat in CATEGORIES for t in ALL_TOOLS if t["cat"] == cat]


def filters_html():
    parts = ['    <button class="filter active" type="button" data-filter="all">All PDF tools</button>']
    for cat in CATEGORIES:
        n = sum(1 for t in TOOLS if t["cat"] == cat)
        parts.append(f'    <button class="filter" type="button" data-filter="{cat}">{cat} <span>{n}</span></button>')
    return "\n".join(parts)


def main():
    OUT.mkdir(exist_ok=True)
    for tool in TOOLS:
        (OUT / (tool["slug"] + ".html")).write_text(page(tool), encoding="utf-8")
    cards = "\n".join(hub_card(t) for t in TOOLS)
    html = (HUB
            .replace("{nav}", NAV)
            .replace("{filters}", filters_html())
            .replace("{count}", str(len(TOOLS)))
            .replace("{cards}", cards)
            .replace("{foot}", FOOT))
    (OUT / "index.html").write_text(html, encoding="utf-8")
    print(f"wrote hub + {len(TOOLS)} tool pages into {OUT}")


if __name__ == "__main__":
    main()
