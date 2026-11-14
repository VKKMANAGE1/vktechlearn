#!/usr/bin/env python3
"""Build the image toolbox: hub page + one standalone page per tool.

Run from the repo root:  python3 tools/build_img_tools.py
Output: img/index.html and img/<tool>.html
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "img"

NAV = """    <header class="top">
      <div class="wrap">
        <a class="brand" href="/img/">
          <span class="brand-badge">🖼️</span>
          <span>Image Toolbox<small>VK TECH LEARN</small></span>
        </a>
        <nav>
          <a href="/img/">All tools</a>
          <a href="/img/compress.html">Compress</a>
          <a href="/img/resize.html">Resize</a>
          <a href="/img/crop.html">Crop</a>
          <a href="/pdf/">PDF tools</a>
          <a href="https://vktechlearn.site/">Main site</a>
        </nav>
      </div>
    </header>"""

FOOT = """    <footer class="foot">
      <div class="wrap">
        Images are processed inside your browser — nothing is uploaded to a server.
        Made by <a href="https://vktechlearn.site/">Vïnâý Kúshwâhå</a>.
        <br>© 2026 VK Tech Learn · All rights reserved. Design and code may not be reused without permission.
      </div>
    </footer>"""


def page(tool):
    related = "".join(
        f'<a href="/img/{slug}.html" target="_blank" rel="noopener">{name}</a>'
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
<title>{tool['name']} — Free Online Image Tool | VK Tech Learn</title>
<meta name="description" content="{tool['meta']}">
<link rel="canonical" href="https://vktechlearn.site/img/{tool['slug']}.html">
<link rel="stylesheet" href="/pdf/style.min.css">
<script src="/img/app.min.js"></script>
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
<title>Image Toolbox — Compress, Resize, Crop & Convert Images Free | VK Tech Learn</title>
<meta name="description" content="Compress, resize, crop, rotate, convert and watermark images free. Every tool runs in your browser, so your photos never leave your device.">
<link rel="canonical" href="https://vktechlearn.site/img/">
<link rel="stylesheet" href="/pdf/style.min.css">
<script src="/img/app.min.js"></script>
</head>
<body>
{nav}

<main class="wrap">
  <section class="hero">
    <h1>Every tool you need to edit images, in one place</h1>
    <p>13 free tools to compress, resize, crop, rotate, convert and watermark photos.
       Everything runs inside your browser — no sign-up, no uploads, works on mobile.</p>
    <div class="chips">
      <span class="chip">100% free</span>
      <span class="chip">Batch friendly</span>
      <span class="chip">No uploads</span>
      <span class="chip">JPG · PNG · WebP</span>
    </div>
  </section>

  <div class="filters" id="filters">
{filters}
  </div>
  <p class="count" id="count">{count} tools</p>

  <section class="grid" id="grid">
{cards}
  </section>

  <p class="count" style="margin-top:.4rem">Need documents instead? Open the
    <a href="/pdf/" style="color:#93c5fd">PDF Toolbox</a> — 35 tools for PDFs.</p>
</main>

{foot}
<script>
(function () {{
  const buttons = Array.from(document.querySelectorAll('.filter'));
  const cards = Array.from(document.querySelectorAll('.card'));
  const count = document.getElementById('count');
  buttons.forEach((btn) => {{
    btn.addEventListener('click', () => {{
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.filter;
      let shown = 0;
      cards.forEach((card) => {{
        const match = cat === 'all' || card.dataset.cat === cat;
        card.style.display = match ? '' : 'none';
        if (match) shown++;
      }});
      count.textContent = shown + (shown === 1 ? ' tool' : ' tools');
    }});
  }});
}})();
</script>
</body>
</html>
"""


def hub_card(tool):
    return f"""    <a class="card" href="/img/{tool['slug']}.html" target="_blank" rel="noopener" data-cat="{tool['cat']}">
      <div class="card-icon">{tool['icon']}</div>
      <div class="eyebrow">{tool['cat']}</div>
      <h3>{tool['name']}</h3>
      <p>{tool['desc']}</p>
      <span class="go">Open tool →</span>
    </a>"""


FILE_ONE = """      <div class="field">
        <label for="file">Choose an image</label>
        <input type="file" id="file" accept="image/*">
        <div class="hint">JPG, PNG or WebP, up to 40 MB.</div>
      </div>"""

FILE_MANY = """      <div class="field">
        <label for="file">Choose images</label>
        <input type="file" id="file" accept="image/*" multiple>
        <div class="hint">Pick as many as you like — several images arrive in one ZIP.</div>
      </div>"""

PREVIEW = """      <div class="field" style="margin-top:1rem">
        <label>Preview</label>
        <div class="preview" id="preview">No image selected yet.</div>
      </div>"""


TOOLS = [
    {
        "slug": "compress",
        "name": "Compress IMAGE",
        "icon": "🗜️",
        "cat": "Optimize",
        "desc": "Shrink JPG, PNG and WebP photos while keeping them sharp enough to use.",
        "meta": "Compress images free in your browser. Choose quality and width, batch compress JPG PNG WebP and download a ZIP.",
        "steps": [
            "Select one or more images.",
            "Pick a quality level and an optional maximum width.",
            "Press <strong>Compress images</strong>.",
            "Download the single image, or the ZIP for a batch.",
        ],
        "rules": [
            ("Output is always JPEG, so transparency is replaced with white.", True),
            ("Photos usually shrink 50–80%; screenshots and flat graphics shrink less.", False),
            ("Downscaling to 1920 px or less saves the most space for web use.", False),
            ("Images are processed on your device, up to 40 MB each.", False),
        ],
        "related": [("resize", "Resize IMAGE"), ("to-jpg", "Convert to JPG"), ("upscale", "Upscale")],
        "body": FILE_MANY + """      <div class="row-3">
        <div class="field">
          <label for="quality">Quality</label>
          <select id="quality">
            <option value="0.85">High — barely visible loss</option>
            <option value="0.7" selected>Balanced — recommended</option>
            <option value="0.55">Small — for email</option>
            <option value="0.4">Tiny — for thumbnails</option>
          </select>
        </div>
        <div class="field">
          <label for="maxw">Maximum width</label>
          <select id="maxw">
            <option value="0" selected>Keep original size</option>
            <option value="1920">1920 px</option>
            <option value="1280">1280 px</option>
            <option value="800">800 px</option>
          </select>
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Compress images</button></div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  const { img, url } = await imageFromFile(file);
  showPreview(url);
  imgSetStatus('info', fileInput.files.length + ' image(s) selected, ' + imgBytes(file.size) + ' each on average.');
});
runBtn.addEventListener('click', async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) { imgSetStatus('err', 'Please choose at least one image.'); return; }
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Compress images', 'Compressing…');
  try {
    const quality = parseFloat(document.getElementById('quality').value) || 0.7;
    const maxw = parseInt(document.getElementById('maxw').value, 10) || 0;
    const out = [];
    let before = 0;
    let after = 0;
    for (let i = 0; i < files.length; i++) {
      imgSetStatus('info', 'Compressing ' + (i + 1) + ' of ' + files.length + '…');
      const { img, url } = await imageFromFile(files[i]);
      const canvas = imageToCanvas(img, maxw, '#ffffff');
      const blob = await canvasBlob(canvas, 'image/jpeg', quality);
      URL.revokeObjectURL(url);
      before += files[i].size;
      after += blob.size;
      out.push({ name: baseName(files[i].name) + '-compressed.jpg', blob });
    }
    await deliverFiles(out, 'compressed-images.zip');
    const saved = before > after ? Math.round((1 - after / before) * 100) : 0;
    imgSetStatus('ok', '✅ ' + files.length + ' image(s): ' + imgBytes(before) + ' → ' + imgBytes(after) + ' (' + saved + '% smaller).');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Compress images');
  }
});""",
    },
    {
        "slug": "resize",
        "name": "Resize IMAGE",
        "icon": "📐",
        "cat": "Modify",
        "desc": "Change an image's dimensions by percent or exact pixel width, keeping its shape.",
        "meta": "Resize images free. Set a percentage or pixel width, batch resize JPG PNG WebP and download.",
        "steps": [
            "Choose one or more images.",
            "Pick <strong>percent</strong> or <strong>pixel width</strong>.",
            "Press <strong>Resize images</strong>.",
            "Download the resized image or the ZIP.",
        ],
        "rules": [
            ("Aspect ratio is always kept, so height follows the width automatically.", False),
            ("Upscaling beyond 200% looks soft — use the Upscale tool for a smoother result.", True),
            ("Output keeps the original format (JPEG stays JPEG, PNG stays PNG).", False),
            ("Maximum input size is 40 MB per image.", False),
        ],
        "related": [("compress", "Compress IMAGE"), ("crop", "Crop IMAGE"), ("upscale", "Upscale")],
        "body": FILE_MANY + """      <div class="row-3">
        <div class="field">
          <label for="mode">Resize by</label>
          <select id="mode">
            <option value="percent" selected>Percentage</option>
            <option value="width">Pixel width</option>
          </select>
        </div>
        <div class="field">
          <label for="value">Value</label>
          <input type="number" id="value" value="50" min="1">
          <div class="hint">Percent (1–400) or width in pixels.</div>
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Resize images</button></div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  const { img, url } = await imageFromFile(file);
  showPreview(url);
  imgSetStatus('info', 'Original size: ' + img.naturalWidth + ' × ' + img.naturalHeight + ' px.');
});
runBtn.addEventListener('click', async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) { imgSetStatus('err', 'Please choose at least one image.'); return; }
  const mode = document.getElementById('mode').value;
  const value = parseFloat(document.getElementById('value').value);
  if (!value || value <= 0) { imgSetStatus('err', 'Please enter a positive size value.'); return; }
  if (mode === 'percent' && value > 400) { imgSetStatus('err', 'Please use 400% or less.'); return; }
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Resize images', 'Resizing…');
  try {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      imgSetStatus('info', 'Resizing ' + (i + 1) + ' of ' + files.length + '…');
      const { img, url } = await imageFromFile(files[i]);
      const scale = mode === 'percent' ? value / 100 : value / img.naturalWidth;
      const canvas = newCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const isPng = /png/i.test(files[i].type) || /\\.png$/i.test(files[i].name);
      const type = isPng ? 'image/png' : 'image/jpeg';
      const blob = await canvasBlob(canvas, type, 0.92);
      const ext = isPng ? 'png' : 'jpg';
      out.push({ name: baseName(files[i].name) + '-' + canvas.width + 'x' + canvas.height + '.' + ext, blob });
    }
    await deliverFiles(out, 'resized-images.zip');
    imgSetStatus('ok', '✅ ' + files.length + ' image(s) resized. Last output: ' + (out[out.length - 1].name) + '.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Resize images');
  }
});""",
    },
    {
        "slug": "crop",
        "name": "Crop IMAGE",
        "icon": "✂️",
        "cat": "Modify",
        "desc": "Drag a rectangle over the photo to keep just that part, with optional fixed ratios.",
        "meta": "Crop images free. Drag a selection on the preview, lock 1:1 or 16:9, and download the cropped photo.",
        "steps": [
            "Choose an image.",
            "Drag a rectangle on the preview — the shaded part is removed.",
            "Optionally pick an aspect ratio; drag again to apply it.",
            "Press <strong>Crop image</strong> and download.",
        ],
        "rules": [
            ("The crop keeps the original resolution inside the selection, not the preview size.", False),
            ("Fixed ratios snap the selection to 1:1, 4:3 or 16:9 while you drag.", False),
            ("A selection smaller than 2% of the image is ignored.", True),
            ("Maximum input size is 40 MB.", False),
        ],
        "related": [("resize", "Resize IMAGE"), ("rotate", "Rotate IMAGE"), ("blur-face", "Blur face")],
        "body": FILE_ONE + """      <div class="row">
        <div class="field">
          <label for="aspect">Aspect ratio</label>
          <select id="aspect">
            <option value="0" selected>Free</option>
            <option value="1">1:1 square</option>
            <option value="1.3333">4:3</option>
            <option value="1.7778">16:9</option>
            <option value="0.75">3:4 portrait</option>
          </select>
        </div>
        <div class="field" style="display:flex;align-items:flex-end">
          <button class="btn secondary small" id="reset" type="button">Reset selection</button>
        </div>
      </div>
      <div class="field">
        <label>Drag over the image to select the crop</label>
        <div class="redact-wrap">
          <canvas id="base"></canvas>
          <canvas id="overlay"></canvas>
        </div>
        <div class="hint" id="selection">Select a file, then drag on the image.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Crop image</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const base = document.getElementById('base');
const overlay = document.getElementById('overlay');
const runBtn = document.getElementById('run');
let photo = null;
let rect = null;
let drag = null;

function paint() {
  drawSelectionStage(base, overlay, rect);
  if (rect) {
    document.getElementById('selection').textContent =
      'Selection: ' + Math.round(rect.w * 100) + '% × ' + Math.round(rect.h * 100) + '% of the image.';
  }
}

async function loadPhoto(file) {
  const { img, url } = await imageFromFile(file);
  photo = img;
  const scale = Math.min(1, 900 / img.naturalWidth);
  base.width = Math.round(img.naturalWidth * scale);
  base.height = Math.round(img.naturalHeight * scale);
  const ctx = base.getContext('2d');
  ctx.drawImage(img, 0, 0, base.width, base.height);
  rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  overlay.width = base.width;
  overlay.height = base.height;
  paint();
  URL.revokeObjectURL(url);
}

function point(e) {
  const r = overlay.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  return { x: clamp01((p.clientX - r.left) / r.width), y: clamp01((p.clientY - r.top) / r.height) };
}

function start(e) { const p = point(e); drag = { x: p.x, y: p.y }; e.preventDefault(); }
function move(e) {
  if (!drag) return;
  const p = point(e);
  const aspect = parseFloat(document.getElementById('aspect').value) || 0;
  let x = Math.min(drag.x, p.x);
  let y = Math.min(drag.y, p.y);
  let w = Math.abs(p.x - drag.x);
  let h = Math.abs(p.y - drag.y);
  if (aspect) {
    h = (w * overlay.width) / (overlay.height * aspect);
    if (y + h > 1) h = 1 - y;
    w = (h * aspect * overlay.height) / overlay.width;
    if (x + w > 1) { w = 1 - x; h = (w * overlay.width) / (overlay.height * aspect); }
    if (p.x < drag.x) x = Math.max(0, drag.x - w);
    if (p.y < drag.y) y = Math.max(0, drag.y - h);
  }
  rect = { x, y, w: clamp01(w), h: clamp01(h) };
  paint();
  e.preventDefault();
}
function end() { drag = null; }

overlay.addEventListener('mousedown', start);
overlay.addEventListener('mousemove', move);
window.addEventListener('mouseup', end);
overlay.addEventListener('touchstart', start, { passive: false });
overlay.addEventListener('touchmove', move, { passive: false });
window.addEventListener('touchend', end);

fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  try {
    await loadPhoto(file);
    imgSetStatus('ok', '✅ Image loaded — drag on it to choose the crop area.');
  } catch (err) { imgSetStatus('err', '❌ ' + err.message); }
});

document.getElementById('reset').addEventListener('click', () => {
  if (!photo) return;
  rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  paint();
});

runBtn.addEventListener('click', async () => {
  if (!photo) { imgSetStatus('err', 'Please choose an image first.'); return; }
  if (!rect || rect.w < 0.02 || rect.h < 0.02) { imgSetStatus('err', 'Please drag a larger crop area.'); return; }
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Crop image', 'Cropping…');
  try {
    const sx = Math.round(rect.x * photo.naturalWidth);
    const sy = Math.round(rect.y * photo.naturalHeight);
    const sw = Math.max(1, Math.round(rect.w * photo.naturalWidth));
    const sh = Math.max(1, Math.round(rect.h * photo.naturalHeight));
    const canvas = newCanvas(sw, sh);
    canvas.getContext('2d').drawImage(photo, sx, sy, sw, sh, 0, 0, sw, sh);
    const isPng = /\\.png$/i.test(fileInput.files[0].name);
    const blob = await canvasBlob(canvas, isPng ? 'image/png' : 'image/jpeg', 0.92);
    downloadBlob(blob, baseName(fileInput.files[0].name) + '-cropped.' + (isPng ? 'png' : 'jpg'));
    showPreview(canvas);
    imgSetStatus('ok', '✅ Cropped to ' + sw + ' × ' + sh + ' px.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Crop image');
  }
});""",
    },
    {
        "slug": "to-jpg",
        "name": "Convert to JPG",
        "icon": "🖼️",
        "cat": "Convert",
        "desc": "Turn PNG, WebP, GIF, BMP or SVG images into standard JPG files.",
        "meta": "Convert images to JPG free. PNG, WebP, GIF, BMP and SVG become JPEG with a white background, in bulk.",
        "steps": [
            "Choose one or more images.",
            "Pick the JPG quality.",
            "Press <strong>Convert to JPG</strong>.",
            "Download the JPG, or the ZIP for several files.",
        ],
        "rules": [
            ("Transparent PNG/WebP areas become white — JPG has no transparency.", True),
            ("HEIC, RAW and PSD are not supported by browsers; export them as JPG/PNG first.", True),
            ("Animated GIFs convert as a still frame.", False),
            ("Maximum input size is 40 MB per image.", False),
        ],
        "related": [("from-jpg", "Convert from JPG"), ("compress", "Compress IMAGE"), ("html-to-image", "HTML to IMAGE")],
        "body": FILE_MANY + """      <div class="field">
        <label for="quality">JPG quality</label>
        <select id="quality">
          <option value="0.92" selected>High (recommended)</option>
          <option value="0.8">Medium</option>
          <option value="0.65">Smaller file</option>
        </select>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to JPG</button></div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  const { url } = await imageFromFile(file);
  showPreview(url);
  imgSetStatus('info', fileInput.files.length + ' image(s) ready to convert.');
});
runBtn.addEventListener('click', async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) { imgSetStatus('err', 'Please choose at least one image.'); return; }
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Convert to JPG', 'Converting…');
  try {
    const quality = parseFloat(document.getElementById('quality').value) || 0.92;
    const out = [];
    for (let i = 0; i < files.length; i++) {
      imgSetStatus('info', 'Converting ' + (i + 1) + ' of ' + files.length + '…');
      const { img, url } = await imageFromFile(files[i]);
      const canvas = imageToCanvas(img, 0, '#ffffff');
      const blob = await canvasBlob(canvas, 'image/jpeg', quality);
      URL.revokeObjectURL(url);
      out.push({ name: baseName(files[i].name) + '.jpg', blob });
    }
    await deliverFiles(out, 'images-jpg.zip');
    imgSetStatus('ok', '✅ ' + files.length + ' image(s) converted to JPG.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Convert to JPG');
  }
});""",
    },
    {
        "slug": "from-jpg",
        "name": "Convert from JPG",
        "icon": "🔄",
        "cat": "Convert",
        "desc": "Save JPG photos as PNG (lossless, transparency-ready) or modern WebP.",
        "meta": "Convert JPG to PNG or WebP free. Batch convert photos in your browser and download a ZIP.",
        "steps": [
            "Choose one or more JPG files.",
            "Pick PNG or WebP as the output.",
            "Press <strong>Convert</strong>.",
            "Download the converted image or the ZIP.",
        ],
        "rules": [
            ("PNG files are larger than JPGs — the quality stays exactly the same.", False),
            ("WebP files are usually 25–35% smaller than JPG at similar quality.", False),
            ("Animated GIF creation is not supported here; use an animation editor.", True),
            ("Maximum input size is 40 MB per image.", False),
        ],
        "related": [("to-jpg", "Convert to JPG"), ("compress", "Compress IMAGE"), ("resize", "Resize IMAGE")],
        "body": FILE_MANY + """      <div class="field">
        <label for="format">Output format</label>
        <select id="format">
          <option value="png" selected>PNG — lossless</option>
          <option value="webp">WebP — smaller</option>
        </select>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert</button></div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  const { url } = await imageFromFile(file);
  showPreview(url);
  imgSetStatus('info', fileInput.files.length + ' image(s) ready.');
});
runBtn.addEventListener('click', async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) { imgSetStatus('err', 'Please choose at least one JPG image.'); return; }
  const format = document.getElementById('format').value;
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Convert', 'Converting…');
  try {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      imgSetStatus('info', 'Converting ' + (i + 1) + ' of ' + files.length + '…');
      const { img, url } = await imageFromFile(files[i]);
      const canvas = imageToCanvas(img);
      const blob = format === 'webp'
        ? await canvasBlob(canvas, 'image/webp', 0.9)
        : await canvasBlob(canvas, 'image/png');
      URL.revokeObjectURL(url);
      if (!blob) throw new Error('This browser cannot write ' + format.toUpperCase() + '.');
      out.push({ name: baseName(files[i].name) + '.' + format, blob });
    }
    await deliverFiles(out, 'converted-images.zip');
    imgSetStatus('ok', '✅ ' + files.length + ' image(s) converted to ' + format.toUpperCase() + '.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Convert');
  }
});""",
    },
    {
        "slug": "photo-editor",
        "name": "Photo editor",
        "icon": "🎨",
        "cat": "Create",
        "desc": "Adjust light, colour and sharpness, then add a caption — live on the preview.",
        "meta": "Free online photo editor. Change brightness, contrast, saturation and blur, add text, and download the photo.",
        "steps": [
            "Choose a photo.",
            "Move the sliders — the preview updates immediately.",
            "Add a caption, its size and colour.",
            "Press <strong>Save photo</strong>.",
        ],
        "rules": [
            ("Preview is downscaled for speed; the saved file uses the full resolution.", False),
            ("Filters are baked into the exported file — keep a copy of the original.", False),
            ("Text is placed near the bottom, centred, with a soft shadow for readability.", False),
            ("This is a filter editor, not a layer-based design tool.", True),
            ("Maximum input size is 40 MB.", False),
        ],
        "related": [("meme", "Meme generator"), ("watermark", "Watermark IMAGE"), ("crop", "Crop IMAGE")],
        "body": FILE_ONE + """      <div class="row-3">
        <div class="field">
          <label for="brightness">Brightness</label>
          <input type="range" id="brightness" min="50" max="160" value="100">
        </div>
        <div class="field">
          <label for="contrast">Contrast</label>
          <input type="range" id="contrast" min="50" max="180" value="100">
        </div>
        <div class="field">
          <label for="saturation">Saturation</label>
          <input type="range" id="saturation" min="0" max="200" value="100">
        </div>
        <div class="field">
          <label for="blur">Blur</label>
          <input type="range" id="blur" min="0" max="6" value="0" step="0.5">
        </div>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" id="gray"> Black &amp; white</label>
        <label class="check"><input type="checkbox" id="sepia"> Sepia</label>
      </div>
      <div class="row-3" style="margin-top:.9rem">
        <div class="field">
          <label for="caption">Caption</label>
          <input type="text" id="caption" placeholder="Optional text">
        </div>
        <div class="field">
          <label for="capSize">Caption size</label>
          <input type="number" id="capSize" value="42" min="10" max="200">
        </div>
        <div class="field">
          <label for="capColor">Colour</label>
          <input type="color" id="capColor" value="#ffffff">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Save photo</button></div>
      <div class="field" style="margin-top:1rem">
        <label>Preview</label>
        <div class="preview" id="preview">No image selected yet.</div>
      </div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
const controls = ['brightness', 'contrast', 'saturation', 'blur', 'gray', 'sepia', 'caption', 'capSize', 'capColor'].map((id) => document.getElementById(id));
let photo = null;

function filterString() {
  const b = document.getElementById('brightness').value / 100;
  const c = document.getElementById('contrast').value / 100;
  const s = document.getElementById('saturation').value / 100;
  const bl = document.getElementById('blur').value;
  const gray = document.getElementById('gray').checked ? 1 : 0;
  const sepia = document.getElementById('sepia').checked ? 1 : 0;
  return 'brightness(' + b + ') contrast(' + c + ') saturate(' + s + ') blur(' + bl + 'px) grayscale(' + gray + ') sepia(' + sepia + ')';
}

function render(maxSide) {
  if (!photo) return null;
  const canvas = imageToCanvas(photo, maxSide);
  const ctx = canvas.getContext('2d');
  ctx.filter = filterString();
  ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
  ctx.filter = 'none';
  const caption = document.getElementById('caption').value.trim();
  if (caption) {
    const size = Math.max(10, parseInt(document.getElementById('capSize').value, 10) || 42) * (canvas.width / (photo.naturalWidth || canvas.width));
    ctx.font = 'bold ' + Math.max(12, size) + 'px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = document.getElementById('capColor').value || '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = Math.max(4, size / 6);
    ctx.fillText(caption, canvas.width / 2, canvas.height - Math.max(12, canvas.height * 0.04));
    ctx.shadowBlur = 0;
  }
  return canvas;
}

function refreshPreview() {
  const canvas = render(760);
  if (canvas) showPreview(canvas);
}

controls.forEach((el) => el.addEventListener('input', refreshPreview));
controls.forEach((el) => el.addEventListener('change', refreshPreview));

fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const { img, url } = await imageFromFile(file);
    photo = img;
    URL.revokeObjectURL(url);
    refreshPreview();
    imgSetStatus('info', 'Photo loaded: ' + img.naturalWidth + ' × ' + img.naturalHeight + ' px.');
  } catch (err) { imgSetStatus('err', '❌ ' + err.message); }
});

runBtn.addEventListener('click', async () => {
  if (!photo) { imgSetStatus('err', 'Please choose a photo first.'); return; }
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Save photo', 'Saving…');
  try {
    const canvas = render(0);
    const isPng = /\\.png$/i.test(fileInput.files[0].name);
    const blob = await canvasBlob(canvas, isPng ? 'image/png' : 'image/jpeg', 0.92);
    downloadBlob(blob, baseName(fileInput.files[0].name) + '-edited.' + (isPng ? 'png' : 'jpg'));
    showPreview(canvas);
    imgSetStatus('ok', '✅ Saved at ' + canvas.width + ' × ' + canvas.height + ' px.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Save photo');
  }
});""",
    },
    {
        "slug": "upscale",
        "name": "Upscale",
        "icon": "🔍",
        "cat": "Optimize",
        "desc": "Enlarge a small image 2×, 3× or 4× with smooth high-quality scaling.",
        "meta": "Upscale images free. Enlarge JPG or PNG 2x, 3x or 4x in your browser with smooth interpolation.",
        "steps": [
            "Choose the image you want to enlarge.",
            "Pick a scale factor.",
            "Press <strong>Upscale image</strong>.",
            "Download the larger PNG and compare it at 100%.",
        ],
        "rules": [
            ("This is high-quality interpolation, not an AI model — it cannot invent missing detail.", True),
            ("Scaling happens in small steps, which keeps edges cleaner than a single jump.", False),
            ("Output is PNG so no extra JPEG artefacts are added.", False),
            ("Very large results are limited by browser memory (about 40 megapixels).", True),
        ],
        "related": [("resize", "Resize IMAGE"), ("compress", "Compress IMAGE"), ("remove-background", "Remove background")],
        "body": FILE_ONE + """      <div class="field">
        <label for="factor">Scale factor</label>
        <select id="factor">
          <option value="2" selected>2× (double)</option>
          <option value="3">3×</option>
          <option value="4">4×</option>
        </select>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Upscale image</button></div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  const { img, url } = await imageFromFile(file);
  showPreview(url);
  imgSetStatus('info', 'Current size: ' + img.naturalWidth + ' × ' + img.naturalHeight + ' px.');
});
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { imgSetStatus('err', 'Please choose an image first.'); return; }
  const factor = parseInt(document.getElementById('factor').value, 10) || 2;
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Upscale image', 'Upscaling…');
  try {
    const { img, url } = await imageFromFile(file);
    URL.revokeObjectURL(url);
    if (img.naturalWidth * img.naturalHeight * factor * factor > 40000000) {
      throw new Error('That would be over 40 megapixels — try a smaller factor.');
    }
    let canvas = imageToCanvas(img);
    let step = 1;
    while (step < factor) {
      const next = newCanvas(canvas.width * 2, canvas.height * 2);
      const ctx = next.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, next.width, next.height);
      canvas = next;
      step *= 2;
    }
    if (step !== factor) {
      const exact = newCanvas(img.naturalWidth * factor, img.naturalHeight * factor);
      const ctx = exact.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, exact.width, exact.height);
      canvas = exact;
    }
    const blob = await canvasBlob(canvas, 'image/png');
    downloadBlob(blob, baseName(file.name) + '-' + factor + 'x.png');
    showPreview(canvas);
    imgSetStatus('ok', '✅ ' + img.naturalWidth + '×' + img.naturalHeight + ' → ' + canvas.width + '×' + canvas.height + ' px.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Upscale image');
  }
});""",
    },
    {
        "slug": "remove-background",
        "name": "Remove background",
        "icon": "🪄",
        "cat": "Optimize",
        "desc": "Delete a plain or near-solid background and save the subject as a transparent PNG.",
        "meta": "Remove an image background free. Flood-fill style removal for plain backgrounds, saved as transparent PNG.",
        "steps": [
            "Choose an image with a plain background (white, grey, a studio backdrop).",
            "Raise <strong>tolerance</strong> until the background disappears.",
            "Press <strong>Remove background</strong>.",
            "Download the transparent PNG.",
        ],
        "rules": [
            ("Works by colour matching from the four corners — perfect for plain backdrops, weak on busy photos.", True),
            ("There is no AI cut-out here; hair and soft edges keep some background colour.", True),
            ("Output is PNG with real transparency.", False),
            ("Images are scaled to at most 1600 px for speed.", False),
        ],
        "related": [("to-jpg", "Convert to JPG"), ("blur-face", "Blur face"), ("watermark", "Watermark IMAGE")],
        "body": FILE_ONE + """      <div class="field">
        <label for="tolerance">Colour tolerance</label>
        <input type="range" id="tolerance" min="8" max="140" value="42">
        <div class="hint">Higher removes more shades of the background.</div>
      </div>
      <div class="actions">
        <button class="btn" id="run" type="button">Remove background</button>
      </div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
let photo = null;
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const { img, url } = await imageFromFile(file);
    photo = img;
    URL.revokeObjectURL(url);
    showPreview(url);
    imgSetStatus('info', 'Image loaded. Raise the tolerance for a stronger cut-out.');
  } catch (err) { imgSetStatus('err', '❌ ' + err.message); }
});
runBtn.addEventListener('click', async () => {
  if (!photo) { imgSetStatus('err', 'Please choose an image first.'); return; }
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Remove background', 'Removing…');
  try {
    const tol = parseInt(document.getElementById('tolerance').value, 10) || 42;
    const canvas = imageToCanvas(photo, 1600);
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    const W = canvas.width;
    const H = canvas.height;
    const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]];
    const colors = corners.map(([x, y]) => {
      const i = (y * W + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    });
    const matches = (i) => {
      for (const c of colors) {
        if (Math.abs(px[i] - c[0]) + Math.abs(px[i + 1] - c[1]) + Math.abs(px[i + 2] - c[2]) <= tol) return true;
      }
      return false;
    };
    const seen = new Uint8Array(W * H);
    const stack = [];
    corners.forEach(([x, y]) => stack.push(y * W + x));
    let removed = 0;
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4;
      if (!matches(i)) continue;
      px[i + 3] = 0;
      removed++;
      const x = p % W;
      const y = (p - x) / W;
      if (x > 0) stack.push(p - 1);
      if (x < W - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - W);
      if (y < H - 1) stack.push(p + W);
    }
    ctx.putImageData(data, 0, 0);
    const blob = await canvasBlob(canvas, 'image/png');
    downloadBlob(blob, baseName(fileInput.files[0].name) + '-no-bg.png');
    showPreview(canvas);
    imgSetStatus('ok', '✅ Background removed from ' + Math.round((removed / (W * H)) * 100) + '% of the pixels.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Remove background');
  }
});""",
    },
    {
        "slug": "watermark",
        "name": "Watermark IMAGE",
        "icon": "💧",
        "cat": "Security",
        "desc": "Stamp your name, brand or site over a photo with adjustable size, colour and opacity.",
        "meta": "Watermark images free. Add text over a photo, choose opacity, colour and position or tile it across the image.",
        "steps": [
            "Choose a photo.",
            "Type the watermark text and set size and opacity.",
            "Pick a position, or <strong>Tile</strong> to repeat it diagonally.",
            "Press <strong>Add watermark</strong> and download.",
        ],
        "rules": [
            ("The watermark is burned into the exported image, not stored as a removable layer.", False),
            ("Tiled mode repeats a rotated watermark across the whole photo — good for proofs.", False),
            ("Keep opacity between 0.2 and 0.5 so the photo stays visible.", False),
            ("Maximum input size is 40 MB.", False),
        ],
        "related": [("photo-editor", "Photo editor"), ("meme", "Meme generator"), ("compress", "Compress IMAGE")],
        "body": FILE_ONE + """      <div class="row-3">
        <div class="field">
          <label for="text">Watermark text</label>
          <input type="text" id="text" value="vktechlearn.site">
        </div>
        <div class="field">
          <label for="size">Size (% of width)</label>
          <input type="number" id="size" value="6" min="1" max="40">
        </div>
        <div class="field">
          <label for="opacity">Opacity</label>
          <input type="range" id="opacity" min="5" max="100" value="30">
        </div>
        <div class="field">
          <label for="color">Colour</label>
          <select id="color">
            <option value="#ffffff" selected>White</option>
            <option value="#000000">Black</option>
            <option value="#fbbf24">Amber</option>
            <option value="#22d3ee">Cyan</option>
          </select>
        </div>
        <div class="field">
          <label for="position">Position</label>
          <select id="position">
            <option value="center" selected>Centre</option>
            <option value="br">Bottom right</option>
            <option value="bl">Bottom left</option>
            <option value="tr">Top right</option>
            <option value="tile">Tile diagonally</option>
          </select>
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Add watermark</button></div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  const { url } = await imageFromFile(file);
  showPreview(url);
});
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { imgSetStatus('err', 'Please choose an image first.'); return; }
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Add watermark', 'Adding…');
  try {
    const { img, url } = await imageFromFile(file);
    URL.revokeObjectURL(url);
    const canvas = imageToCanvas(img);
    const ctx = canvas.getContext('2d');
    const text = document.getElementById('text').value.trim() || 'vktechlearn.site';
    const size = Math.max(8, (parseFloat(document.getElementById('size').value) || 6) / 100 * canvas.width);
    const alpha = Math.max(0.05, (parseInt(document.getElementById('opacity').value, 10) || 30) / 100);
    const color = document.getElementById('color').value;
    const position = document.getElementById('position').value;
    ctx.font = 'bold ' + size + 'px Arial, Helvetica, sans-serif';
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color === '#000000' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = Math.max(2, size / 8);
    if (position === 'tile') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 6);
      const stepX = size * (ctx.measureText(text).width / size + 3);
      const stepY = size * 5;
      for (let y = -canvas.height; y < canvas.height; y += stepY) {
        for (let x = -canvas.width; x < canvas.width; x += stepX) ctx.fillText(text, x, y);
      }
      ctx.restore();
    } else {
      const margin = size * 0.8;
      ctx.textAlign = position === 'bl' ? 'left' : position === 'br' ? 'right' : position === 'tr' ? 'right' : 'center';
      ctx.textBaseline = position === 'tr' ? 'top' : position === 'center' ? 'middle' : 'bottom';
      const x = position === 'bl' ? margin : position === 'br' || position === 'tr' ? canvas.width - margin : canvas.width / 2;
      const y = position === 'tr' ? margin : position === 'center' ? canvas.height / 2 : canvas.height - margin;
      ctx.fillText(text, x, y);
    }
    ctx.globalAlpha = 1;
    const isPng = /\\.png$/i.test(file.name);
    const blob = await canvasBlob(canvas, isPng ? 'image/png' : 'image/jpeg', 0.92);
    downloadBlob(blob, baseName(file.name) + '-watermarked.' + (isPng ? 'png' : 'jpg'));
    showPreview(canvas);
    imgSetStatus('ok', '✅ Watermark added at ' + Math.round(alpha * 100) + '% opacity.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Add watermark');
  }
});""",
    },
    {
        "slug": "meme",
        "name": "Meme generator",
        "icon": "😂",
        "cat": "Create",
        "desc": "Add classic top and bottom captions to a picture and download the meme.",
        "meta": "Create memes free. Add top and bottom text to any photo with bold outlines and download a JPG instantly.",
        "steps": [
            "Choose a picture.",
            "Type the top and bottom captions.",
            "Adjust the text size if it is too long.",
            "Press <strong>Create meme</strong> and download.",
        ],
        "rules": [
            ("Captions are drawn in bold white with a black outline, like classic memes.", False),
            ("Long captions shrink automatically to fit the width.", False),
            ("Text is always uppercase unless you turn that off.", False),
            ("Maximum input size is 40 MB.", False),
        ],
        "related": [("photo-editor", "Photo editor"), ("watermark", "Watermark IMAGE"), ("crop", "Crop IMAGE")],
        "body": FILE_ONE + """      <div class="row">
        <div class="field">
          <label for="top">Top text</label>
          <input type="text" id="top" placeholder="WHEN THE CODE WORKS">
        </div>
        <div class="field">
          <label for="bottom">Bottom text</label>
          <input type="text" id="bottom" placeholder="ON THE FIRST TRY">
        </div>
      </div>
      <div class="row-3">
        <div class="field">
          <label for="size">Text size (% of width)</label>
          <input type="number" id="size" value="9" min="2" max="25">
        </div>
        <label class="check" style="align-self:end"><input type="checkbox" id="upper" checked> Uppercase</label>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Create meme</button></div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  const { url } = await imageFromFile(file);
  showPreview(url);
});
function drawCaption(ctx, text, x, y, size, baseline) {
  ctx.font = 'bold ' + size + 'px Impact, "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = baseline;
  ctx.lineWidth = Math.max(2, size / 9);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  let width = ctx.measureText(text).width;
  if (width > x * 2 - 20) {
    size = size * ((x * 2 - 20) / width);
    ctx.font = 'bold ' + size + 'px Impact, "Arial Black", Arial, sans-serif';
  }
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { imgSetStatus('err', 'Please choose a picture first.'); return; }
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Create meme', 'Drawing…');
  try {
    const { img, url } = await imageFromFile(file);
    URL.revokeObjectURL(url);
    const canvas = imageToCanvas(img, 1600);
    const ctx = canvas.getContext('2d');
    const upper = document.getElementById('upper').checked;
    const topText = document.getElementById('top').value.trim();
    const bottomText = document.getElementById('bottom').value.trim();
    const size = Math.max(10, (parseFloat(document.getElementById('size').value) || 9) / 100 * canvas.width);
    if (topText) drawCaption(ctx, upper ? topText.toUpperCase() : topText, canvas.width / 2, size * 0.6, size, 'top');
    if (bottomText) drawCaption(ctx, upper ? bottomText.toUpperCase() : bottomText, canvas.width / 2, canvas.height - size * 0.5, size, 'bottom');
    const blob = await canvasBlob(canvas, 'image/jpeg', 0.92);
    downloadBlob(blob, baseName(file.name) + '-meme.jpg');
    showPreview(canvas);
    imgSetStatus('ok', '✅ Meme ready (' + canvas.width + ' × ' + canvas.height + ' px).');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Create meme');
  }
});""",
    },
    {
        "slug": "rotate",
        "name": "Rotate IMAGE",
        "icon": "🔄",
        "cat": "Modify",
        "desc": "Turn photos 90°, 180° or 270°, or mirror them horizontally and vertically.",
        "meta": "Rotate or flip images free. Rotate JPG PNG WebP by 90/180/270 degrees or mirror them, in bulk.",
        "steps": [
            "Choose one or more images.",
            "Pick the rotation angle.",
            "Tick flip if you also want a mirror image.",
            "Press <strong>Rotate images</strong> and download.",
        ],
        "rules": [
            ("Only right-angle rotations are supported here; fine tilts need the photo editor.", True),
            ("Flip mirrors the image, which is handy for correcting selfies.", False),
            ("Output keeps each file's original format.", False),
            ("Maximum input size is 40 MB per image.", False),
        ],
        "related": [("crop", "Crop IMAGE"), ("resize", "Resize IMAGE"), ("photo-editor", "Photo editor")],
        "body": FILE_MANY + """      <div class="row-3">
        <div class="field">
          <label for="angle">Rotation</label>
          <select id="angle">
            <option value="90" selected>90° clockwise</option>
            <option value="180">180°</option>
            <option value="270">270° (90° left)</option>
          </select>
        </div>
        <label class="check" style="align-self:end"><input type="checkbox" id="flipH"> Flip horizontal</label>
        <label class="check" style="align-self:end"><input type="checkbox" id="flipV"> Flip vertical</label>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Rotate images</button></div>
""" + PREVIEW,
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  const { url } = await imageFromFile(file);
  showPreview(url);
});
runBtn.addEventListener('click', async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) { imgSetStatus('err', 'Please choose at least one image.'); return; }
  const angle = parseInt(document.getElementById('angle').value, 10) || 90;
  const flipH = document.getElementById('flipH').checked ? -1 : 1;
  const flipV = document.getElementById('flipV').checked ? -1 : 1;
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Rotate images', 'Rotating…');
  try {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      imgSetStatus('info', 'Rotating ' + (i + 1) + ' of ' + files.length + '…');
      const { img, url } = await imageFromFile(files[i]);
      URL.revokeObjectURL(url);
      const swap = angle === 90 || angle === 270;
      const canvas = newCanvas(swap ? img.naturalHeight : img.naturalWidth, swap ? img.naturalWidth : img.naturalHeight);
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.scale(flipH, flipV);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const isPng = /\\.png$/i.test(files[i].name);
      const blob = await canvasBlob(canvas, isPng ? 'image/png' : 'image/jpeg', 0.92);
      out.push({ name: baseName(files[i].name) + '-rotated.' + (isPng ? 'png' : 'jpg'), blob });
    }
    await deliverFiles(out, 'rotated-images.zip');
    imgSetStatus('ok', '✅ ' + files.length + ' image(s) rotated ' + angle + '°' + (flipH < 0 || flipV < 0 ? ' and flipped' : '') + '.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Rotate images');
  }
});""",
    },
    {
        "slug": "html-to-image",
        "name": "HTML to IMAGE",
        "icon": "🌐",
        "cat": "Convert",
        "desc": "Paste HTML — a card, invoice, quote or table — and save it as a crisp PNG.",
        "meta": "Convert HTML to an image free. Paste markup, choose the width, and download a PNG rendered in your browser.",
        "steps": [
            "Paste your HTML (with inline styles or a &lt;style&gt; block).",
            "Set the render width in pixels.",
            "Press <strong>Render to PNG</strong>.",
            "Download the image and check it.",
        ],
        "rules": [
            ("Scripts inside the pasted HTML are removed before rendering.", True),
            ("External images need CORS-enabled URLs, otherwise they appear blank.", True),
            ("Remote URLs are not fetched — paste the HTML itself.", True),
            ("Rendering is done by html2canvas, so some modern CSS (grid gaps, filters) may differ slightly.", False),
        ],
        "related": [("to-jpg", "Convert to JPG"), ("watermark", "Watermark IMAGE"), ("photo-editor", "Photo editor")],
        "body": """      <div class="field">
        <label for="html">HTML to render</label>
        <textarea id="html" rows="9">&lt;div style="padding:32px;font-family:Arial,Helvetica,sans-serif;background:#ffffff;color:#0f172a"&gt;
  &lt;h1 style="margin:0 0 8px;font-size:34px"&gt;VK Tech Learn&lt;/h1&gt;
  &lt;p style="margin:0;color:#475569"&gt;Paste any HTML here to turn it into a PNG.&lt;/p&gt;
&lt;/div&gt;</textarea>
      </div>
      <div class="row-3">
        <div class="field">
          <label for="width">Render width (px)</label>
          <input type="number" id="width" value="800" min="200" max="2000">
        </div>
        <div class="field">
          <label for="scale">Pixel density</label>
          <select id="scale">
            <option value="1">1× — normal</option>
            <option value="2" selected>2× — retina sharp</option>
            <option value="3">3× — very sharp</option>
          </select>
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Render to PNG</button></div>
      <div class="field" style="margin-top:1rem">
        <label>Preview</label>
        <div class="preview" id="preview">The rendered PNG will appear here.</div>
      </div>""",
        "script": """const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const html = document.getElementById('html').value.trim();
  if (!html) { imgSetStatus('err', 'Please paste some HTML first.'); return; }
  const width = Math.max(200, Math.min(2000, parseInt(document.getElementById('width').value, 10) || 800));
  const scale = parseInt(document.getElementById('scale').value, 10) || 2;
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Render to PNG', 'Rendering…');
  imgSetStatus('info', 'Loading the renderer…');
  try {
    await ensureHtml2Canvas();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + width + 'px;background:#ffffff;color:#0f172a;font:16px/1.5 Arial,Helvetica,sans-serif;';
    holder.innerHTML = html.replace(/<script[\\s\\S]*?<\\/script>/gi, '').replace(/ on\\w+="[^"]*"/gi, '');
    document.body.appendChild(holder);
    imgSetStatus('info', 'Rendering HTML…');
    const canvas = await html2canvas(holder, { backgroundColor: '#ffffff', scale, useCORS: true, logging: false });
    holder.remove();
    if (!canvas.width || !canvas.height) throw new Error('Nothing to render — check that your HTML has visible content.');
    const blob = await canvasBlob(canvas, 'image/png');
    downloadBlob(blob, 'html-image.png');
    showPreview(canvas);
    imgSetStatus('ok', '✅ Rendered ' + canvas.width + ' × ' + canvas.height + ' px PNG.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Render to PNG');
  }
});""",
    },
    {
        "slug": "blur-face",
        "name": "Blur face",
        "icon": "🫥",
        "cat": "Security",
        "desc": "Hide faces, number plates or anything private by blurring or pixelating selected areas.",
        "meta": "Blur part of an image free. Drag boxes over faces or plates, then pixelate or blur them and download.",
        "steps": [
            "Choose a photo.",
            "Drag one or more boxes over the areas to hide.",
            "Choose pixelate or blur, and the strength.",
            "Press <strong>Save hidden image</strong>.",
        ],
        "rules": [
            ("There is no automatic face detection — you choose the areas yourself.", True),
            ("Pixelate is stronger than blur: it destroys detail instead of softening it.", False),
            ("The effect is burned into the exported image.", False),
            ("Maximum input size is 40 MB.", False),
        ],
        "related": [("crop", "Crop IMAGE"), ("watermark", "Watermark IMAGE"), ("photo-editor", "Photo editor")],
        "body": FILE_ONE + """      <div class="row-3">
        <div class="field">
          <label for="mode">Effect</label>
          <select id="mode">
            <option value="pixelate" selected>Pixelate (strongest)</option>
            <option value="blur">Blur</option>
          </select>
        </div>
        <div class="field">
          <label for="strength">Strength</label>
          <select id="strength">
            <option value="8">Light</option>
            <option value="16" selected>Medium</option>
            <option value="28">Strong</option>
          </select>
        </div>
        <div class="field" style="display:flex;align-items:flex-end;gap:.5rem">
          <button class="btn secondary small" id="undo" type="button">Undo</button>
          <button class="btn secondary small" id="clear" type="button">Clear</button>
        </div>
      </div>
      <div class="field">
        <label>Drag over the areas to hide</label>
        <div class="redact-wrap">
          <canvas id="base"></canvas>
          <canvas id="overlay"></canvas>
        </div>
        <div class="hint" id="count">No areas selected yet.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Save hidden image</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const base = document.getElementById('base');
const overlay = document.getElementById('overlay');
const runBtn = document.getElementById('run');
let photo = null;
let boxes = [];
let drag = null;

function paint() {
  const ctx = overlay.getContext('2d');
  overlay.width = base.width;
  overlay.height = base.height;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  boxes.forEach((b) => {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.28)';
    ctx.fillRect(b.x * overlay.width, b.y * overlay.height, b.w * overlay.width, b.h * overlay.height);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = Math.max(2, overlay.width / 400);
    ctx.strokeRect(b.x * overlay.width, b.y * overlay.height, b.w * overlay.width, b.h * overlay.height);
  });
  if (drag) {
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.strokeRect(drag.x * overlay.width, drag.y * overlay.height, drag.w * overlay.width, drag.h * overlay.height);
  }
  document.getElementById('count').textContent = boxes.length ? boxes.length + ' area(s) selected.' : 'No areas selected yet.';
}

function point(e) {
  const r = overlay.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  return { x: clamp01((p.clientX - r.left) / r.width), y: clamp01((p.clientY - r.top) / r.height) };
}
function start(e) { const p = point(e); drag = { x: p.x, y: p.y, w: 0, h: 0 }; e.preventDefault(); }
function move(e) {
  if (!drag) return;
  const p = point(e);
  drag = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
  paint();
  e.preventDefault();
}
function end() {
  if (drag && drag.w > 0.01 && drag.h > 0.01) boxes.push(drag);
  drag = null;
  paint();
}
overlay.addEventListener('mousedown', start);
overlay.addEventListener('mousemove', move);
window.addEventListener('mouseup', end);
overlay.addEventListener('touchstart', start, { passive: false });
overlay.addEventListener('touchmove', move, { passive: false });
window.addEventListener('touchend', end);

fileInput.addEventListener('change', async () => {
  imgClearStatus();
  document.getElementById('output').innerHTML = '';
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const { img, url } = await imageFromFile(file);
    photo = img;
    URL.revokeObjectURL(url);
    const scale = Math.min(1, 900 / img.naturalWidth);
    base.width = Math.round(img.naturalWidth * scale);
    base.height = Math.round(img.naturalHeight * scale);
    base.getContext('2d').drawImage(img, 0, 0, base.width, base.height);
    boxes = [];
    paint();
    imgSetStatus('ok', '✅ Image loaded — drag boxes over the areas to hide.');
  } catch (err) { imgSetStatus('err', '❌ ' + err.message); }
});
document.getElementById('undo').addEventListener('click', () => { boxes.pop(); paint(); });
document.getElementById('clear').addEventListener('click', () => { boxes = []; paint(); });

runBtn.addEventListener('click', async () => {
  if (!photo) { imgSetStatus('err', 'Please choose an image first.'); return; }
  if (!boxes.length) { imgSetStatus('err', 'Please drag at least one box over the area to hide.'); return; }
  const mode = document.getElementById('mode').value;
  const strength = parseInt(document.getElementById('strength').value, 10) || 16;
  document.getElementById('output').innerHTML = '';
  imgBusy(runBtn, true, 'Save hidden image', 'Hiding…');
  try {
    const canvas = imageToCanvas(photo);
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    boxes.forEach((b) => {
      const sx = Math.round(b.x * W);
      const sy = Math.round(b.y * H);
      const sw = Math.max(2, Math.round(b.w * W));
      const sh = Math.max(2, Math.round(b.h * H));
      if (mode === 'blur') {
        const temp = newCanvas(sw, sh);
        const tctx = temp.getContext('2d');
        tctx.filter = 'blur(' + strength + 'px)';
        tctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        ctx.drawImage(temp, 0, 0, sw, sh, sx, sy, sw, sh);
      } else {
        const tiny = newCanvas(Math.max(2, sw / strength), Math.max(2, sh / strength));
        const tctx = tiny.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, tiny.width, tiny.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, sx, sy, sw, sh);
        ctx.imageSmoothingEnabled = true;
      }
    });
    const isPng = /\\.png$/i.test(fileInput.files[0].name);
    const blob = await canvasBlob(canvas, isPng ? 'image/png' : 'image/jpeg', 0.92);
    downloadBlob(blob, baseName(fileInput.files[0].name) + '-hidden.' + (isPng ? 'png' : 'jpg'));
    showPreview(canvas);
    imgSetStatus('ok', '✅ ' + boxes.length + ' area(s) ' + (mode === 'blur' ? 'blurred' : 'pixelated') + '.');
  } catch (err) {
    imgSetStatus('err', '❌ ' + err.message);
  } finally {
    imgBusy(runBtn, false, 'Save hidden image');
  }
});""",
    },
]

CATEGORIES = ["Optimize", "Modify", "Convert", "Create", "Security"]
ORDERED = [t for cat in CATEGORIES for t in TOOLS if t["cat"] == cat]


def filters_html():
    parts = ['    <button class="filter active" type="button" data-filter="all">All image tools</button>']
    for cat in CATEGORIES:
        n = sum(1 for t in TOOLS if t["cat"] == cat)
        parts.append(f'    <button class="filter" type="button" data-filter="{cat}">{cat} <span>{n}</span></button>')
    return "\n".join(parts)


def main():
    OUT.mkdir(exist_ok=True)
    for tool in TOOLS:
        (OUT / (tool["slug"] + ".html")).write_text(page(tool), encoding="utf-8")
    cards = "\n".join(hub_card(t) for t in ORDERED)
    html = (HUB
            .replace("{nav}", NAV)
            .replace("{filters}", filters_html())
            .replace("{count}", str(len(TOOLS)))
            .replace("{cards}", cards)
            .replace("{foot}", FOOT))
    (OUT / "index.html").write_text(html, encoding="utf-8")
    print(f"wrote image hub + {len(TOOLS)} tool pages into {OUT}")


if __name__ == "__main__":
    main()
