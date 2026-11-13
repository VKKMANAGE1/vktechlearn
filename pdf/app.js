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

/* ---------- optional engines: loaded only by the pages that need them ---------- */
const EXTRA_LIBS = {
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  pptx: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
};
const extraPromises = {};
function ensureExtra(key) {
  if (!extraPromises[key]) {
    extraPromises[key] = loadScript(EXTRA_LIBS[key]).catch((err) => { delete extraPromises[key]; throw err; });
  }
  return extraPromises[key];
}
const ensureJSZip = () => ensureExtra('jszip');
const ensureXLSX = () => ensureExtra('xlsx');
const ensurePPTX = () => ensureExtra('pptx');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addFileDownload(blob, filename, label) {
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

async function addZipDownload(files, zipName) {
  await ensureJSZip();
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.data));
  const blob = await zip.generateAsync({ type: 'blob' });
  return addFileDownload(blob, zipName, 'Download ' + zipName + ' (' + files.length + ' files)');
}

/* Load a PDF with pdf-lib, optionally with a password (the fork can decrypt). */
async function openPdf(bytes, options) {
  await ensureLibs();
  return PDFLib.PDFDocument.load(bytes, Object.assign({ updateMetadata: false }, options || {}));
}

/* Plain text of every page, as a list of lines per page. */
async function extractTextPages(source, onPage) {
  await ensureLibs();
  const bytes = source instanceof Blob ? await readFileBytes(source) : source;
  const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let line = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.trim());
        line = '';
      } else {
        line += ' ';
      }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines);
    if (onPage) onPage(i, pdf.numPages);
  }
  return pages;
}

async function openPdfJs(source) {
  await ensureLibs();
  const bytes = source instanceof Blob ? await readFileBytes(source) : source;
  return window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
}

async function renderPageCanvas(pdf, pageNum, scale) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

const canvasToJpeg = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality || 0.85));

const blobToBytes = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(new Uint8Array(fr.result));
  fr.onerror = () => reject(fr.error);
  fr.readAsArrayBuffer(blob);
});

/* Wrap text to a width, using a pdf-lib font metric. */
function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/* Build an A4 portrait PDF from lines of text. */
async function textPdf(pagesLines, options) {
  const opts = Object.assign({ size: 11, leading: 16, margin: 56, title: '', author: 'Vïnâý Kúshwâhâ' }, options || {});
  await ensureLibs();
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  for (const lines of pagesLines) {
    let page = doc.addPage(PDFLib.PageSizes.A4);
    let y = page.getHeight() - opts.margin;
    const maxWidth = page.getWidth() - opts.margin * 2;
    for (const raw of lines) {
      const wrapped = wrapText(raw, font, opts.size, maxWidth);
      for (const ln of wrapped) {
        if (y < opts.margin) {
          page = doc.addPage(PDFLib.PageSizes.A4);
          y = page.getHeight() - opts.margin;
        }
        page.drawText(ln, { x: opts.margin, y, size: opts.size, font, color: PDFLib.rgb(0.1, 0.12, 0.16) });
        y -= opts.leading;
      }
    }
  }
  if (doc.getPageCount() === 0) doc.addPage(PDFLib.PageSizes.A4);
  if (opts.title) doc.setTitle(opts.title);
  doc.setProducer('VK PDF Toolbox');
  doc.setAuthor(opts.author);
  return doc.save();
}

const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

async function buildDocx(pagesLines) {
  await ensureJSZip();
  const body = [];
  pagesLines.forEach((lines, pi) => {
    for (const line of lines) {
      body.push('<w:p><w:r><w:t xml:space="preserve">' + xmlEscape(line) + '</w:t></w:r></w:p>');
    }
    if (pi < pagesLines.length - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  });
  if (!body.length) body.push('<w:p/>');
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
    '</w:body></w:document>';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/document.xml', document);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function readDocxParagraphs(file) {
  await ensureJSZip();
  const zip = await JSZip.loadAsync(await readFileBytes(file));
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('This file is not a .docx document (word/document.xml is missing).');
  const xml = await part.async('string');
  const paragraphs = [];
  for (const chunk of xml.split(/<w:p[\s>]/).slice(1)) {
    const texts = [...chunk.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    const text = texts.join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    if (text.trim()) paragraphs.push(text);
  }
  return paragraphs;
}

async function readPptxSlides(file) {
  await ensureJSZip();
  const zip = await JSZip.loadAsync(await readFileBytes(file));
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10));
  if (!names.length) throw new Error('This file is not a .pptx presentation (no slides were found).');
  const slides = [];
  for (const name of names) {
    const xml = await zip.file(name).async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))
      .filter((t) => t.trim());
    slides.push(texts);
  }
  return slides;
}

async function readXlsxSheets(file) {
  await ensureXLSX();
  const wb = XLSX.read(new Uint8Array(await readFileBytes(file)), { type: 'array' });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' })
  }));
}

/* Warm the engine up after the first paint so the first click is instant. */
const warm = () => ensureLibs().catch(() => {});
if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2500 });
else setTimeout(warm, 1200);

document.addEventListener('click', (e) => {
  const back = e.target.closest('[data-go-back]');
  if (back) { e.preventDefault(); history.back(); }
});
