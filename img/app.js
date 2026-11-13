/* Shared helpers for the image toolbox pages (no PDF engine is loaded here). */

const IMG_MAX_MB = 40;
const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp' };

function imgSetStatus(kind, text) {
  const el = document.getElementById('status');
  if (!el) return;
  el.className = 'status show ' + kind;
  el.innerHTML = text;
}

function imgClearStatus() {
  const el = document.getElementById('status');
  if (el) { el.className = 'status'; el.innerHTML = ''; }
}

function imgBusy(button, busy, idle, working) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? (working || 'Working…') : (idle || 'Run');
}

const imgBytes = (n) => {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
};

const imgSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

let zipPromise = null;
function ensureZip() {
  if (!zipPromise) {
    zipPromise = loadScriptOnce('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js')
      .catch((e) => { zipPromise = null; throw e; });
  }
  return zipPromise;
}

let h2cPromise = null;
function ensureHtml2Canvas() {
  if (!h2cPromise) {
    h2cPromise = loadScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js')
      .catch((e) => { h2cPromise = null; throw e; });
  }
  return h2cPromise;
}

function imageFromFile(file) {
  if (file.size > IMG_MAX_MB * 1024 * 1024) {
    return Promise.reject(new Error('“' + file.name + '” is ' + imgBytes(file.size) + '. The limit is ' + IMG_MAX_MB + ' MB per image.'));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('“' + file.name + '” could not be opened as an image.')); };
    img.src = url;
  });
}

function newCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

/* Draw an image into a canvas, shrinking it when it is larger than maxSide. */
function imageToCanvas(img, maxSide, fill) {
  const ratio = maxSide ? Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
  const canvas = newCanvas(img.naturalWidth * ratio, img.naturalHeight * ratio);
  const ctx = canvas.getContext('2d');
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const canvasBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type || 'image/png', quality));

function downloadBlob(blob, filename, label) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.className = 'dl';
  a.textContent = label || ('Download ' + filename);
  const out = document.getElementById('output');
  if (out) out.appendChild(a);
  return a;
}

function baseName(name) {
  return String(name).replace(/\.[^.]+$/, '') || 'image';
}

/* One file downloads directly, several are bundled into a ZIP. */
async function deliverFiles(files, zipName) {
  const out = document.getElementById('output');
  if (out) out.innerHTML = '';
  if (files.length === 1) {
    downloadBlob(files[0].blob, files[0].name, 'Download ' + files[0].name);
    return;
  }
  await ensureZip();
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.blob));
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, zipName, 'Download ' + zipName + ' (' + files.length + ' images)');
}

function showPreview(source, boxId) {
  const box = document.getElementById(boxId || 'preview');
  if (!box) return;
  box.innerHTML = '';
  if (!source) { box.textContent = 'No image selected yet.'; return; }
  const img = document.createElement('img');
  img.alt = 'Preview';
  img.style.cssText = 'max-width:100%;max-height:280px;display:block;margin:0 auto;border-radius:8px';
  if (source instanceof HTMLCanvasElement) {
    img.src = source.toDataURL('image/png');
  } else if (typeof source === 'string') {
    img.src = source;
  } else {
    img.src = source;
  }
  box.appendChild(img);
}

/* Grey out everything outside a normalised rectangle (x, y, w, h in 0..1). */
function drawSelectionStage(baseCanvas, overlay, rect, opts) {
  const ctx = overlay.getContext('2d');
  overlay.width = baseCanvas.width;
  overlay.height = baseCanvas.height;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!rect) return;
  const x = rect.x * overlay.width;
  const y = rect.y * overlay.height;
  const w = rect.w * overlay.width;
  const h = rect.h * overlay.height;
  if (!(opts && opts.noDim)) {
    ctx.fillStyle = 'rgba(6, 10, 20, 0.55)';
    ctx.fillRect(0, 0, overlay.width, y);
    ctx.fillRect(0, y + h, overlay.width, overlay.height - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, overlay.width - x - w, h);
  }
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = Math.max(2, overlay.width / 400);
  ctx.strokeRect(x, y, w, h);
}

function clamp01(n) { return Math.min(1, Math.max(0, n)); }
