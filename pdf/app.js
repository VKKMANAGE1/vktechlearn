/* Shared helpers for every VK PDF tool page.
   The PDF engine (pdf-lib + pdf.js, ~2 MB) is only fetched after the page paints. */

const LIBS = {
  pdflib: 'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.11.1/dist/pdf-lib.min.js',
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
};

let libsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

function ensureLibs() {
  if (libsPromise) return libsPromise;
  libsPromise = Promise.all([loadScript(LIBS.pdflib), loadScript(LIBS.pdfjs)])
    .then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.worker; })
    .catch((err) => { libsPromise = null; throw err; });
  return libsPromise;
}

const MAX_MB = 50;

const formatBytes = (n) => {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
};

const readArrayBuffer = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsArrayBuffer(file);
});

const readFileBytes = async (file) => {
  if (file.size > MAX_MB * 1024 * 1024) {
    throw new Error(`This file is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB per file.`);
  }
  return readArrayBuffer(file);
};

const dataUrlToBytes = (dataUrl) => {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

function friendlyError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/encrypted/i.test(msg)) return 'this PDF is password protected. Remove its password first, then try again here.';
  if (/password/i.test(msg) && /incorrect|invalid/i.test(msg)) return 'the password you entered for this PDF is not correct.';
  if (/Invalid PDF|Failed to parse|No PDF header|InvalidPDF/i.test(msg)) return 'this file does not look like a valid PDF.';
  if (/range/i.test(msg)) return msg;
  return msg;
}

function setStatus(kind, text) {
  const el = document.getElementById('status');
  if (!el) return;
  el.className = 'status show ' + kind;
  el.innerHTML = text;
}

function clearStatus() {
  const el = document.getElementById('status');
  if (el) { el.className = 'status'; el.innerHTML = ''; }
}

function addDownload(bytes, filename, label) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' });
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

function setBusy(button, busy, labelIdle, labelBusy) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? (labelBusy || 'Working…') : (labelIdle || 'Run');
}

/* Render preview thumbnails of the first pages of a PDF into a container. */
async function renderPreview(file, containerId, maxPages) {
  const box = document.getElementById(containerId);
  if (!box || !file) return;
  box.innerHTML = 'Loading preview…';
  try {
    await ensureLibs();
    const data = await readArrayBuffer(file);
    const pdf = await window.pdfjsLib.getDocument({ data: data.slice(0) }).promise;
    const pages = Math.min(pdf.numPages, maxPages || 2);
    box.innerHTML = '';
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.45 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const caption = document.createElement('div');
      caption.className = 'pg';
      caption.textContent = 'Page ' + i;
      box.appendChild(caption);
      box.appendChild(canvas);
    }
    if (pdf.numPages > pages) {
      const more = document.createElement('div');
      more.className = 'pg';
      more.textContent = `+ ${pdf.numPages - pages} more page(s)`;
      box.appendChild(more);
    }
  } catch (err) {
    box.innerHTML = '<span style="color:#fecdd3">Preview failed: ' + friendlyError(err) + '</span>';
  }
}

/* Parse "1-3,5,7" into zero-based page indices. */
function parsePageRange(input, totalPages) {
  const cleaned = (input || '').trim();
  if (!cleaned) return Array.from({ length: totalPages }, (_, i) => i);
  const pages = new Set();
  for (const part of cleaned.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map((s) => s.trim());
      const start = a ? parseInt(a, 10) : 1;
      const end = b ? parseInt(b, 10) : totalPages;
      if (Number.isNaN(start) || Number.isNaN(end)) throw new Error('Use page numbers like 1-3,5,7');
      if (start < 1 || end > totalPages || start > end) {
        throw new Error(`Page range "${part}" is outside this document (1-${totalPages}).`);
      }
      for (let i = start; i <= end; i++) pages.add(i - 1);
    } else {
      const n = parseInt(part, 10);
      if (Number.isNaN(n)) throw new Error('Use page numbers like 1-3,5,7');
      if (n < 1 || n > totalPages) throw new Error(`Page ${n} does not exist — this document has ${totalPages} pages.`);
      pages.add(n - 1);
    }
  }
  if (!pages.size) throw new Error('No valid pages were selected.');
  return Array.from(pages).sort((a, b) => a - b);
}

/* Warm the engine up after the first paint so the first click is instant. */
const warm = () => ensureLibs().catch(() => {});
if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2500 });
else setTimeout(warm, 1200);

document.addEventListener('click', (e) => {
  const back = e.target.closest('[data-go-back]');
  if (back) { e.preventDefault(); history.back(); }
});
