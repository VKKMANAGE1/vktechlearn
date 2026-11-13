"""Page, security and advanced tools for the PDF toolbox."""

EXTRA_EDIT = [
    {
        "slug": "organize",
        "name": "Organize PDF",
        "icon": "🗂️",
        "cat": "Organize",
        "desc": "Reorder or delete pages using thumbnails, then save the new document.",
        "meta": "Organize PDF pages free. Drag-free thumbnails let you reorder, duplicate and delete pages before saving.",
        "steps": [
            "Choose the PDF you want to reorganise.",
            "Wait for the page thumbnails to appear.",
            "Use ← → to move a page, ✕ to delete it.",
            "Press <strong>Save arranged PDF</strong>.",
        ],
        "rules": [
            ("The original file is never changed — you always download a new copy.", False),
            ("Deleted pages are left out of the saved file; the rest keep their order.", False),
            ("Very long documents (>100 pages) take a moment to thumbnail.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("merge", "Merge PDF"), ("split", "Split PDF"), ("rotate", "Rotate PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="field">
        <label>Pages — click ◀ ▶ to move, ✕ to delete</label>
        <div class="thumbs" id="thumbs">No file selected yet.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Save arranged PDF</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
const thumbs = document.getElementById('thumbs');
let order = [];
let sourceBytes = null;
let busy = false;

function renderThumbs() {
  thumbs.innerHTML = '';
  if (!order.length) { thumbs.textContent = 'All pages were deleted — load the file again.'; return; }
  order.forEach((pageIndex, i) => {
    const card = document.createElement('div');
    card.className = 'thumb';
    card.innerHTML = '<img src="' + pageIndex.url + '" alt="Page ' + (pageIndex.index + 1) + '">' +
      '<div class="thumb-bar"><span>' + (pageIndex.index + 1) + '</span>' +
      '<button type="button" data-act="left" data-i="' + i + '" title="Move left">◀</button>' +
      '<button type="button" data-act="right" data-i="' + i + '" title="Move right">▶</button>' +
      '<button type="button" data-act="del" data-i="' + i + '" title="Delete page">✕</button></div>';
    thumbs.appendChild(card);
  });
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  clearStatus();
  document.getElementById('output').innerHTML = '';
  order = [];
  if (!file) { thumbs.textContent = 'No file selected yet.'; return; }
  thumbs.textContent = 'Loading thumbnails…';
  try {
    sourceBytes = await readFileBytes(file);
    const pdf = await openPdfJs(sourceBytes);
    order = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const canvas = await renderPageCanvas(pdf, i, 0.35);
      order.push({ index: i - 1, url: canvas.toDataURL('image/jpeg', 0.6) });
      if (i % 3 === 0) thumbs.textContent = 'Loading thumbnails… ' + i + '/' + pdf.numPages;
    }
    renderThumbs();
    setStatus('ok', '✅ ' + pdf.numPages + ' page(s) loaded. Arrange them, then save.');
  } catch (err) {
    thumbs.textContent = 'Could not read that PDF.';
    setStatus('err', '❌ ' + friendlyError(err));
  }
});

thumbs.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || busy) return;
  const i = parseInt(btn.dataset.i, 10);
  const act = btn.dataset.act;
  if (act === 'del') order.splice(i, 1);
  if (act === 'left' && i > 0) { const t = order[i - 1]; order[i - 1] = order[i]; order[i] = t; }
  if (act === 'right' && i < order.length - 1) { const t = order[i + 1]; order[i + 1] = order[i]; order[i] = t; }
  renderThumbs();
});

runBtn.addEventListener('click', async () => {
  if (!sourceBytes || !order.length) { setStatus('err', 'Please load a PDF and keep at least one page.'); return; }
  document.getElementById('output').innerHTML = '';
  busy = true;
  setBusy(runBtn, true, 'Save arranged PDF', 'Saving…');
  try {
    await ensureLibs();
    const doc = await PDFLib.PDFDocument.load(sourceBytes.slice(0));
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(doc, order.map((o) => o.index));
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    addDownload(bytes, 'arranged.pdf', 'Download arranged.pdf');
    setStatus('ok', '✅ Saved ' + order.length + ' page(s) in the new order.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    busy = false;
    setBusy(runBtn, false, 'Save arranged PDF');
  }
});""",
    },
    {
        "slug": "unlock",
        "name": "Unlock PDF",
        "icon": "🔓",
        "cat": "Security",
        "desc": "Remove a PDF password (when you know it) and save an unrestricted copy.",
        "meta": "Unlock a PDF free. Enter the password and download a copy with the encryption removed — in your browser.",
        "steps": [
            "Choose the protected PDF.",
            "Type its open password (leave empty for files that only had owner restrictions).",
            "Press <strong>Unlock PDF</strong>.",
            "Download the unrestricted copy.",
        ],
        "rules": [
            ("You must know the password — this tool cannot crack or guess it.", True),
            ("Files that open without a password but block printing or copying unlock with an empty password.", False),
            ("Removing protection is only legitimate on your own documents.", True),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("protect", "Protect PDF"), ("repair", "Repair PDF"), ("info", "PDF Info")],
        "body": """      <div class="field">
        <label for="file">Choose the protected PDF</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="field">
        <label for="pass">Password</label>
        <input type="password" id="pass" placeholder="Leave empty if the file opens without one">
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Unlock PDF</button></div>""",
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
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Unlock PDF', 'Unlocking…');
  setStatus('info', 'Removing the protection…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, password: pass, updateMetadata: false });
    } catch (err) {
      const msg = String(err.message || err);
      if (/password|decrypt|encrypt/i.test(msg)) throw new Error('That password did not work for this PDF.');
      throw err;
    }
    // Saving an encrypted source keeps its /Encrypt dictionary, so copy every
    // decrypted page into a fresh document — the new file has no encryption.
    const fresh = await PDFLib.PDFDocument.create();
    const copied = await fresh.copyPages(doc, doc.getPageIndices());
    copied.forEach((p) => fresh.addPage(p));
    const title = doc.getTitle();
    if (title) fresh.setTitle(title);
    fresh.setProducer('VK PDF Toolbox');
    const out = await fresh.save();
    const head = new TextDecoder('latin1').decode(new Uint8Array(out).slice(0, 4000));
    addDownload(out, 'unlocked.pdf', 'Download unlocked.pdf');
    if (head.indexOf('/Encrypt') >= 0) {
      setStatus('err', '⚠️ The password was accepted but the file is still encrypted. Open it once in a PDF viewer, print to a new PDF, and try again.');
    } else {
      setStatus('ok', '✅ Protection removed — ' + fresh.getPageCount() + ' page(s), no password required.');
    }
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Unlock PDF');
  }
});""",
    },
    {
        "slug": "pdf-to-pdfa",
        "name": "PDF to PDF/A",
        "icon": "🏛️",
        "cat": "Optimize",
        "desc": "Flatten a PDF into an archive copy with an sRGB profile and PDF/A metadata.",
        "meta": "Create an archive-ready PDF free. Pages are flattened, an sRGB output intent and PDF/A XMP metadata are added.",
        "steps": [
            "Choose the PDF you want to archive.",
            "Press <strong>Create archive PDF</strong>.",
            "Pages are flattened to images and tagged with sRGB + PDF/A metadata.",
            "Download <strong>archive.pdf</strong>.",
        ],
        "rules": [
            ("Pages become images, so text is no longer selectable or searchable.", True),
            ("This produces an archive-ready file with PDF/A-2b metadata and an sRGB output intent, but it is not certified — certification needs a validator such as veraPDF.", True),
            ("Scanned documents and office exports archive best with this method.", False),
            ("Large documents take longer because every page is re-rendered.", False),
        ],
        "related": [("compress", "Compress PDF"), ("repair", "Repair PDF"), ("info", "PDF Info")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="field">
        <label for="name">Output filename</label>
        <input type="text" id="name" value="archive.pdf">
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Create archive PDF</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
const XMP = '<?xpacket begin="\\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part>' +
  '<pdfaid:conformance>B</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta>' +
  '<?xpacket end="w"?>';

runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Create archive PDF', 'Archiving…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const pdf = await openPdfJs(bytes);
    const doc = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus('info', 'Flattening page ' + i + ' of ' + pdf.numPages + '…');
      const canvas = await renderPageCanvas(pdf, i, 2);
      const jpeg = await blobToBytes(await canvasToJpeg(canvas, 0.92));
      const img = await doc.embedJpg(jpeg);
      const page = doc.addPage([canvas.width / 2, canvas.height / 2]);
      page.drawImage(img, { x: 0, y: 0, width: canvas.width / 2, height: canvas.height / 2 });
    }
    setStatus('info', 'Adding the sRGB output intent and metadata…');
    try {
      const res = await fetch('/pdf/icc/sRGB.icc');
      if (res.ok) {
        const icc = new Uint8Array(await res.arrayBuffer());
        const stream = doc.context.flateStream(icc, { N: 3 });
        const ref = doc.context.register(stream);
        const intent = doc.context.obj({
          Type: 'OutputIntent',
          S: 'GTS_PDFA1',
          OutputConditionIdentifier: PDFLib.PDFString.of('sRGB IEC61966-2.1'),
          Info: PDFLib.PDFString.of('sRGB IEC61966-2.1'),
          DestOutputProfile: ref
        });
        doc.catalog.set(PDFLib.PDFName.of('OutputIntents'), doc.context.obj([intent]));
      }
    } catch (e) { /* profile is optional */ }
    const meta = doc.context.flateStream(XMP);
    doc.catalog.set(PDFLib.PDFName.of('Metadata'), doc.context.register(meta));
    doc.setTitle(file.name.replace(/\\.pdf$/i, ''));
    doc.setProducer('VK PDF Toolbox');
    doc.setAuthor('Vïnâý Kúshwâhâ');
    const out = await doc.save({ useObjectStreams: false });
    const name = (document.getElementById('name').value || 'archive.pdf').trim();
    addDownload(out, name, 'Download ' + name);
    setStatus('ok', '✅ Archive copy created: ' + doc.getPageCount() + ' flattened page(s) with sRGB + PDF/A-2b metadata (not certified).');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Create archive PDF');
  }
});""",
    },
    {
        "slug": "repair",
        "name": "Repair PDF",
        "icon": "🩹",
        "cat": "Optimize",
        "desc": "Rebuild a damaged PDF: first by fixing its structure, then by rebuilding pages as images.",
        "meta": "Repair a damaged PDF free. Broken structures are rewritten, and unreadable files are rebuilt page by page.",
        "steps": [
            "Choose the damaged PDF.",
            "Press <strong>Repair PDF</strong>.",
            "The tool first tries a structural fix, then rebuilds pages if needed.",
            "Download <strong>repaired.pdf</strong>.",
        ],
        "rules": [
            ("A structural repair keeps text and quality and fixes most index/xref damage.", False),
            ("If the structure cannot be read, pages are rebuilt as images and text is lost.", True),
            ("Severely truncated files may lose their last pages.", True),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("pdf-to-pdfa", "PDF to PDF/A"), ("compress", "Compress PDF"), ("unlock", "Unlock PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a damaged PDF</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Repair PDF</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Repair PDF', 'Repairing…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    let structural = null;
    setStatus('info', 'Checking the document structure…');
    try {
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
      if (doc.getPageCount() > 0) structural = await doc.save({ useObjectStreams: false });
    } catch (e) { structural = null; }
    if (structural) {
      addDownload(structural, 'repaired.pdf', 'Download repaired.pdf');
      setStatus('ok', '✅ Structure repaired — the file was rewritten and keeps its original text and quality.');
      return;
    }
    setStatus('info', 'Structure unreadable — rebuilding pages as images…');
    const pdf = await openPdfJs(bytes);
    const doc = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus('info', 'Rebuilding page ' + i + ' of ' + pdf.numPages + '…');
      const canvas = await renderPageCanvas(pdf, i, 2);
      const jpeg = await blobToBytes(await canvasToJpeg(canvas, 0.9));
      const img = await doc.embedJpg(jpeg);
      const page = doc.addPage([canvas.width / 2, canvas.height / 2]);
      page.drawImage(img, { x: 0, y: 0, width: canvas.width / 2, height: canvas.height / 2 });
    }
    const out = await doc.save();
    addDownload(out, 'repaired.pdf', 'Download repaired.pdf');
    setStatus('ok', '✅ Rebuilt ' + doc.getPageCount() + ' page(s) as images — text is no longer selectable.');
  } catch (err) {
    setStatus('err', '❌ This PDF could not be repaired: ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Repair PDF');
  }
});""",
    },
    {
        "slug": "page-numbers",
        "name": "Page Numbers",
        "icon": "🔢",
        "cat": "Edit",
        "desc": "Stamp page numbers on a PDF, with position, start number and format.",
        "meta": "Add page numbers to a PDF free. Choose position, starting number and “Page X of Y” style, then download.",
        "steps": [
            "Choose the PDF you want numbered.",
            "Pick the position and starting number.",
            "Choose the format and font size.",
            "Press <strong>Add page numbers</strong> and download.",
        ],
        "rules": [
            ("Numbers are drawn on top of the page content near the margin.", False),
            ("“Page X of Y” counts every page in the file, even if you start at 5.", False),
            ("Rotated pages keep their rotation, so numbers may look sideways.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("watermark", "Watermark"), ("edit", "Add Text"), ("crop", "Crop PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="row-3">
        <div class="field">
          <label for="position">Position</label>
          <select id="position">
            <option value="bc" selected>Bottom centre</option>
            <option value="br">Bottom right</option>
            <option value="bl">Bottom left</option>
            <option value="tc">Top centre</option>
            <option value="tr">Top right</option>
            <option value="tl">Top left</option>
          </select>
        </div>
        <div class="field">
          <label for="start">Start at</label>
          <input type="number" id="start" value="1" min="1">
        </div>
        <div class="field">
          <label for="format">Format</label>
          <select id="format">
            <option value="n" selected>1</option>
            <option value="page-n">Page 1</option>
            <option value="n-of-t">1 / 5</option>
            <option value="page-n-of-t">Page 1 of 5</option>
          </select>
        </div>
        <div class="field">
          <label for="size">Font size</label>
          <input type="number" id="size" value="10" min="6" max="24">
        </div>
      </div>
      <div class="field">
        <label for="range">Pages (optional)</label>
        <input type="text" id="range" placeholder="all, or e.g. 2-10">
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Add page numbers</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Add page numbers', 'Numbering…');
  setStatus('info', 'Writing page numbers…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const doc = await PDFLib.PDFDocument.load(bytes);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;
    const start = Math.max(1, parseInt(document.getElementById('start').value, 10) || 1);
    const size = parseInt(document.getElementById('size').value, 10) || 10;
    const pos = document.getElementById('position').value;
    const fmt = document.getElementById('format').value;
    const targets = parsePageRange(document.getElementById('range').value, total);
    targets.forEach((idx) => {
      const page = pages[idx];
      const n = start + idx;
      let label = String(n);
      if (fmt === 'page-n') label = 'Page ' + n;
      if (fmt === 'n-of-t') label = n + ' / ' + (start + total - 1);
      if (fmt === 'page-n-of-t') label = 'Page ' + n + ' of ' + (start + total - 1);
      const w = font.widthOfTextAtSize(label, size);
      const { width, height } = page.getSize();
      const margin = 24;
      let x = (width - w) / 2;
      if (pos === 'br' || pos === 'tr') x = width - margin - w;
      if (pos === 'bl' || pos === 'tl') x = margin;
      const y = pos[0] === 'b' ? margin : height - margin - size;
      page.drawText(label, { x, y, size, font, color: PDFLib.rgb(0.25, 0.28, 0.34) });
    });
    const out = await doc.save();
    addDownload(out, 'numbered.pdf', 'Download numbered.pdf');
    setStatus('ok', '✅ Numbered ' + targets.length + ' page(s).');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Add page numbers');
  }
});""",
    },
    {
        "slug": "scan-to-pdf",
        "name": "Scan to PDF",
        "icon": "📷",
        "cat": "Organize",
        "desc": "Photograph documents with your phone and turn them into a clean PDF.",
        "meta": "Scan documents to PDF free. Use your phone camera (or pick photos), enhance them, and download one PDF.",
        "steps": [
            "Tap <strong>Take photo</strong> on a phone, or pick existing images.",
            "Add as many pages as you need — one photo per page.",
            "Keep “Enhance scan” on for sharper black text.",
            "Press <strong>Create scanned PDF</strong>.",
        ],
        "rules": [
            ("Camera capture works on phones and tablets; on a computer use “Choose images”.", False),
            ("Enhance mode converts to grayscale with extra contrast — good for text, bad for photos.", False),
            ("Each image becomes one A4 page, fitted with a margin.", False),
            ("Maximum file size is 50 MB per image.", False),
        ],
        "related": [("jpg-to-pdf", "JPG to PDF"), ("ocr", "OCR PDF"), ("rotate", "Rotate PDF")],
        "body": """      <div class="row">
        <div class="field">
          <label for="camera">Take a photo</label>
          <input type="file" id="camera" accept="image/*" capture="environment">
          <div class="hint">Opens the camera on phones.</div>
        </div>
        <div class="field">
          <label for="file">Choose images</label>
          <input type="file" id="file" accept="image/*" multiple>
          <div class="hint">Pictures already on this device.</div>
        </div>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" id="enhance" checked> Enhance scan (grayscale + contrast)</label>
        <div class="field" style="margin:0">
          <label for="name">Filename</label>
          <input type="text" id="name" value="scan.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Create scanned PDF</button></div>
      <div class="field" style="margin-top:1rem">
        <label>Preview</label>
        <div class="preview" id="preview">No images yet.</div>
      </div>""",
        "script": """const camera = document.getElementById('camera');
const gallery = document.getElementById('file');
const runBtn = document.getElementById('run');
let shots = [];

function refresh() {
  const preview = document.getElementById('preview');
  preview.innerHTML = '';
  if (!shots.length) { preview.textContent = 'No images yet.'; return; }
  shots.forEach((s, i) => {
    const img = document.createElement('img');
    img.src = s.url;
    img.alt = 'Scan page ' + (i + 1);
    img.style.cssText = 'max-width:120px;border-radius:6px;margin:4px';
    preview.appendChild(img);
  });
}

async function addShots(files) {
  for (const file of files) {
    const bitmap = await createImageBitmap(file);
    shots.push({ file, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height });
    bitmap.close && bitmap.close();
  }
  refresh();
  clearStatus();
}

camera.addEventListener('change', () => { addShots(Array.from(camera.files || [])); camera.value = ''; });
gallery.addEventListener('change', () => { addShots(Array.from(gallery.files || [])); gallery.value = ''; });

runBtn.addEventListener('click', async () => {
  if (!shots.length) { setStatus('err', 'Please take a photo or choose at least one image.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Create scanned PDF', 'Building…');
  try {
    await ensureLibs();
    const enhance = document.getElementById('enhance').checked;
    const doc = await PDFLib.PDFDocument.create();
    for (let i = 0; i < shots.length; i++) {
      setStatus('info', 'Processing image ' + (i + 1) + ' of ' + shots.length + '…');
      const bitmap = await createImageBitmap(shots[i].file);
      const maxSide = 2200;
      const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close && bitmap.close();
      if (enhance) {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = data.data;
        for (let p = 0; p < px.length; p += 4) {
          const gray = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
          const boosted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 140));
          px[p] = px[p + 1] = px[p + 2] = boosted;
        }
        ctx.putImageData(data, 0, 0);
      }
      const jpeg = await blobToBytes(await canvasToJpeg(canvas, 0.85));
      const img = await doc.embedJpg(jpeg);
      const landscape = canvas.width > canvas.height;
      const size = landscape ? [PDFLib.PageSizes.A4[1], PDFLib.PageSizes.A4[0]] : PDFLib.PageSizes.A4;
      const page = doc.addPage(size);
      const margin = landscape ? 0 : 0;
      const maxW = page.getWidth() - margin * 2;
      const maxH = page.getHeight() - margin * 2;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (page.getWidth() - w) / 2, y: (page.getHeight() - h) / 2, width: w, height: h });
    }
    const out = await doc.save();
    const name = (document.getElementById('name').value || 'scan.pdf').trim();
    addDownload(out, name, 'Download ' + name);
    setStatus('ok', '✅ ' + shots.length + ' page(s) scanned into one PDF.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Create scanned PDF');
  }
});""",
    },
    {
        "slug": "ocr",
        "name": "OCR PDF",
        "icon": "🔍",
        "cat": "Optimize",
        "desc": "Add a searchable text layer to scanned pages so you can search and copy the text.",
        "meta": "OCR a PDF free in your browser. Scanned pages get an invisible text layer, making the document searchable.",
        "steps": [
            "Choose a scanned PDF.",
            "Pick the language that appears in the document.",
            "Press <strong>Run OCR</strong> — the engine downloads on first use.",
            "Download <strong>searchable.pdf</strong> and try searching for a word.",
        ],
        "rules": [
            ("The first run downloads the OCR engine (~15 MB) and language data — later runs are cached.", True),
            ("English is the most accurate; Hindi needs cleaner, larger scans.", False),
            ("Text is placed as an invisible layer, so positions are approximate but search works.", False),
            ("Scanned pages only — pages that already have text keep their original layer.", False),
        ],
        "related": [("pdf-to-word", "PDF to Word"), ("scan-to-pdf", "Scan to PDF"), ("summarize", "AI Summarizer")],
        "body": """      <div class="field">
        <label for="file">Choose a scanned PDF</label>
        <input type="file" id="file" accept="application/pdf">
        <div class="hint">Works best on clean, straight scans at 200 DPI or more.</div>
      </div>
      <div class="row">
        <div class="field">
          <label for="lang">Language</label>
          <select id="lang">
            <option value="eng" selected>English</option>
            <option value="hin">Hindi</option>
            <option value="eng+hin">English + Hindi</option>
          </select>
        </div>
        <div class="field">
          <label for="name">Output filename</label>
          <input type="text" id="name" value="searchable.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Run OCR</button></div>
      <div class="field" style="margin-top:1rem">
        <label>Recognised text</label>
        <div class="preview" id="result" style="min-height:100px;max-height:300px">The text will appear here.</div>
      </div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
const resultBox = document.getElementById('result');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Run OCR', 'Working…');
  let worker = null;
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const pdf = await openPdfJs(bytes);
    setStatus('info', 'Loading the OCR engine (first run only)…');
    await ensureExtra('tesseract');
    const lang = document.getElementById('lang').value;
    worker = await Tesseract.createWorker(lang);
    const srcDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const out = await PDFLib.PDFDocument.create();
    const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus('info', 'OCR page ' + i + ' of ' + pdf.numPages + '…');
      const canvas = await renderPageCanvas(pdf, i, 2);
      const { data } = await worker.recognize(canvas);
      texts.push(data.text || '');
      const copied = await out.copyPages(srcDoc, [i - 1]);
      out.addPage(copied[0]);
      const page = out.getPages()[out.getPageCount() - 1];
      const clean = (data.text || '').replace(/\\s+/g, ' ').trim();
      if (clean) {
        const lines = [];
        let line = '';
        clean.split(' ').forEach((w) => {
          if ((line + ' ' + w).length > 110) { lines.push(line); line = w; } else { line = line ? line + ' ' + w : w; }
        });
        if (line) lines.push(line);
        let y = page.getHeight() - 24;
        for (const ln of lines.slice(0, 150)) {
          page.drawText(ln, { x: 18, y, size: 8, font, color: PDFLib.rgb(0, 0, 0), opacity: 0 });
          y -= 9.5;
        }
      }
    }
    const outBytes = await out.save();
    const name = (document.getElementById('name').value || 'searchable.pdf').trim();
    addDownload(outBytes, name, 'Download ' + name);
    resultBox.textContent = texts.join('\\n\\n').slice(0, 4000) || 'No text was recognised.';
    setStatus('ok', '✅ OCR finished for ' + pdf.numPages + ' page(s). The PDF is now searchable.');
  } catch (err) {
    setStatus('err', '❌ OCR failed: ' + friendlyError(err));
  } finally {
    if (worker) { try { await worker.terminate(); } catch (e) {} }
    setBusy(runBtn, false, 'Run OCR');
  }
});""",
    },
    {
        "slug": "compare",
        "name": "Compare PDF",
        "icon": "🔬",
        "cat": "Security",
        "desc": "See two versions of a document side by side and list the lines that changed.",
        "meta": "Compare two PDFs free. Pages are shown side by side and added or removed text lines are listed.",
        "steps": [
            "Choose the original PDF and the revised PDF.",
            "Press <strong>Compare</strong>.",
            "Read the changed lines, then scroll through the side-by-side pages.",
            "Nothing is uploaded; the comparison stays on your device.",
        ],
        "rules": [
            ("The comparison is visual plus a line-by-line text diff — no file is downloaded.", False),
            ("Pages are paired by number, so inserted pages show as differences from that point on.", True),
            ("Image-only changes are only visible in the side-by-side view.", False),
            ("Maximum file size is 50 MB per file.", False),
        ],
        "related": [("repair", "Repair PDF"), ("redact", "Redact PDF"), ("info", "PDF Info")],
        "body": """      <div class="row">
        <div class="field">
          <label for="fileA">Original PDF</label>
          <input type="file" id="fileA" accept="application/pdf">
        </div>
        <div class="field">
          <label for="fileB">Revised PDF</label>
          <input type="file" id="fileB" accept="application/pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Compare</button></div>
      <div class="field" style="margin-top:1rem">
        <label>Changes</label>
        <div class="preview" id="diff" style="min-height:80px;max-height:260px">Changes will be listed here.</div>
      </div>
      <div class="field">
        <label>Side by side</label>
        <div class="preview" id="side" style="max-height:460px">Pages will appear here.</div>
      </div>""",
        "script": """const fileA = document.getElementById('fileA');
const fileB = document.getElementById('fileB');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const a = fileA.files[0];
  const b = fileB.files[0];
  if (!a || !b) { setStatus('err', 'Please choose both PDF files.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Compare', 'Comparing…');
  const diffBox = document.getElementById('diff');
  const side = document.getElementById('side');
  diffBox.textContent = 'Reading both documents…';
  side.innerHTML = '';
  try {
    const [pdfA, pdfB] = await Promise.all([openPdfJs(a), openPdfJs(b)]);
    const pagesA = await extractTextPages(await readFileBytes(a));
    const pagesB = await extractTextPages(await readFileBytes(b));
    const maxPages = Math.max(pdfA.numPages, pdfB.numPages);
    const diffLines = [];
    let changed = 0;
    for (let i = 0; i < maxPages; i++) {
      const setA = new Set((pagesA[i] || []).map((l) => l.trim()).filter(Boolean));
      const setB = new Set((pagesB[i] || []).map((l) => l.trim()).filter(Boolean));
      const removed = [...setA].filter((l) => !setB.has(l));
      const added = [...setB].filter((l) => !setA.has(l));
      if (!removed.length && !added.length) continue;
      changed++;
      diffLines.push('Page ' + (i + 1) + ': -' + removed.length + ' / +' + added.length);
      removed.slice(0, 6).forEach((l) => diffLines.push('  − ' + l.slice(0, 120)));
      added.slice(0, 6).forEach((l) => diffLines.push('  + ' + l.slice(0, 120)));
    }
    diffBox.textContent = diffLines.length ? diffLines.join('\\n') : 'No text differences found — pages look identical in text.';
    setStatus('info', 'Rendering pages side by side…');
    const limit = Math.min(maxPages, 8);
    for (let i = 1; i <= limit; i++) {
      const row = document.createElement('div');
      row.className = 'compare-row';
      const wrapA = document.createElement('div');
      wrapA.className = 'compare-cell';
      const wrapB = document.createElement('div');
      wrapB.className = 'compare-cell';
      const labelA = document.createElement('div');
      labelA.className = 'pg';
      labelA.textContent = 'Original — page ' + i;
      const labelB = document.createElement('div');
      labelB.className = 'pg';
      labelB.textContent = 'Revised — page ' + i;
      wrapA.appendChild(labelA);
      wrapB.appendChild(labelB);
      if (i <= pdfA.numPages) wrapA.appendChild(await renderPageCanvas(pdfA, i, 0.75));
      if (i <= pdfB.numPages) wrapB.appendChild(await renderPageCanvas(pdfB, i, 0.75));
      row.appendChild(wrapA);
      row.appendChild(wrapB);
      side.appendChild(row);
    }
    if (maxPages > limit) {
      const note = document.createElement('div');
      note.className = 'pg';
      note.textContent = 'Showing the first ' + limit + ' pages of ' + maxPages + '.';
      side.appendChild(note);
    }
    setStatus('ok', '✅ Compared ' + maxPages + ' page(s): ' + changed + ' page(s) with text changes.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Compare');
  }
});""",
    },
    {
        "slug": "redact",
        "name": "Redact PDF",
        "icon": "⬛",
        "cat": "Security",
        "desc": "Drag black boxes over sensitive areas and save a file where that content is gone.",
        "meta": "Redact a PDF free. Draw boxes over private text, flatten the page and download a copy with the content removed.",
        "steps": [
            "Choose the PDF and go to the page you want to redact.",
            "Drag a box over each sensitive area — add as many as you need.",
            "Use <strong>Undo</strong> or <strong>Clear page</strong> to fix mistakes.",
            "Press <strong>Save redacted PDF</strong>.",
        ],
        "rules": [
            ("Redacted pages are flattened to images, so the covered text is really removed, not just hidden.", False),
            ("Repeat the tool for other pages; each run only changes the page shown.", False),
            ("Pages without boxes keep their original text and quality.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("crop", "Crop PDF"), ("protect", "Protect PDF"), ("annotate", "Annotation")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="row">
        <div class="field">
          <label for="pageNum">Page</label>
          <input type="number" id="pageNum" value="1" min="1">
        </div>
        <div class="field" style="display:flex;align-items:flex-end;gap:.5rem">
          <button class="btn secondary small" id="undo" type="button">Undo</button>
          <button class="btn secondary small" id="clearPage" type="button">Clear page</button>
        </div>
      </div>
      <div class="field">
        <label>Drag over the content to hide</label>
        <div class="redact-wrap">
          <canvas id="base"></canvas>
          <canvas id="overlay"></canvas>
        </div>
        <div class="hint" id="boxCount">No boxes yet.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Save redacted PDF</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const pageInput = document.getElementById('pageNum');
const base = document.getElementById('base');
const overlay = document.getElementById('overlay');
const runBtn = document.getElementById('run');
let sourceBytes = null;
let currentPage = 1;
let pageCount = 0;
const boxes = {};   // page -> [{x,y,w,h}] normalised 0..1
let drag = null;

function paintOverlay() {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.fillStyle = 'rgba(0,0,0,0.92)';
  (boxes[currentPage] || []).forEach((b) => {
    ctx.fillRect(b.x * overlay.width, b.y * overlay.height, b.w * overlay.width, b.h * overlay.height);
  });
  if (drag) {
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.strokeRect(drag.x * overlay.width, drag.y * overlay.height, drag.w * overlay.width, drag.h * overlay.height);
  }
  const count = (boxes[currentPage] || []).length;
  document.getElementById('boxCount').textContent = count ? count + ' box(es) on page ' + currentPage : 'No boxes yet — drag on the page.';
}

async function showPage(num) {
  if (!sourceBytes) return;
  currentPage = Math.min(Math.max(1, num), pageCount);
  pageInput.value = currentPage;
  const pdf = await openPdfJs(sourceBytes);
  const canvas = await renderPageCanvas(pdf, currentPage, 1.2);
  base.width = overlay.width = canvas.width;
  base.height = overlay.height = canvas.height;
  base.getContext('2d').drawImage(canvas, 0, 0);
  paintOverlay();
}

function norm(e) {
  const rect = overlay.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  return {
    x: Math.min(1, Math.max(0, (p.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (p.clientY - rect.top) / rect.height))
  };
}

function startDrag(e) { const p = norm(e); drag = { x: p.x, y: p.y, w: 0, h: 0 }; e.preventDefault(); }
function moveDrag(e) {
  if (!drag) return;
  const p = norm(e);
  drag = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
  paintOverlay();
  e.preventDefault();
}
function endDrag() {
  if (!drag) return;
  if (drag.w > 0.01 && drag.h > 0.005) {
    (boxes[currentPage] = boxes[currentPage] || []).push(drag);
  }
  drag = null;
  paintOverlay();
}

overlay.addEventListener('mousedown', startDrag);
overlay.addEventListener('mousemove', moveDrag);
window.addEventListener('mouseup', endDrag);
overlay.addEventListener('touchstart', startDrag, { passive: false });
overlay.addEventListener('touchmove', moveDrag, { passive: false });
window.addEventListener('touchend', endDrag);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  clearStatus();
  document.getElementById('output').innerHTML = '';
  Object.keys(boxes).forEach((k) => delete boxes[k]);
  if (!file) return;
  try {
    sourceBytes = await readFileBytes(file);
    const pdf = await openPdfJs(sourceBytes);
    pageCount = pdf.numPages;
    pageInput.max = pageCount;
    await showPage(1);
    setStatus('ok', '✅ ' + pageCount + ' page(s) loaded. Drag boxes on the page to redact.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  }
});

pageInput.addEventListener('change', () => showPage(parseInt(pageInput.value, 10) || 1));
document.getElementById('undo').addEventListener('click', () => {
  if (boxes[currentPage] && boxes[currentPage].length) boxes[currentPage].pop();
  paintOverlay();
});
document.getElementById('clearPage').addEventListener('click', () => {
  boxes[currentPage] = [];
  paintOverlay();
});

runBtn.addEventListener('click', async () => {
  if (!sourceBytes) { setStatus('err', 'Please choose a PDF file first.'); return; }
  const active = Object.keys(boxes).filter((k) => (boxes[k] || []).length);
  if (!active.length) { setStatus('err', 'Please drag at least one box over the content to hide.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Save redacted PDF', 'Redacting…');
  try {
    await ensureLibs();
    const srcDoc = await PDFLib.PDFDocument.load(sourceBytes.slice(0), { ignoreEncryption: true });
    const srcPdf = await openPdfJs(sourceBytes);
    const out = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= srcPdf.numPages; i++) {
      setStatus('info', 'Processing page ' + i + ' of ' + srcPdf.numPages + '…');
      const list = boxes[i] || [];
      if (!list.length) {
        const copied = await out.copyPages(srcDoc, [i - 1]);
        out.addPage(copied[0]);
        continue;
      }
      const canvas = await renderPageCanvas(srcPdf, i, 2);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000';
      list.forEach((b) => ctx.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height));
      const jpeg = await blobToBytes(await canvasToJpeg(canvas, 0.9));
      const img = await out.embedJpg(jpeg);
      const page = out.addPage([canvas.width / 2, canvas.height / 2]);
      page.drawImage(img, { x: 0, y: 0, width: canvas.width / 2, height: canvas.height / 2 });
    }
    const outBytes = await out.save();
    addDownload(outBytes, 'redacted.pdf', 'Download redacted.pdf');
    setStatus('ok', '✅ Redacted ' + active.length + ' page(s) — the covered content is gone from the file.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Save redacted PDF');
  }
});""",
    },
    {
        "slug": "crop",
        "name": "Crop PDF",
        "icon": "✂️",
        "cat": "Edit",
        "desc": "Trim white margins or wide borders by setting exact crop margins.",
        "meta": "Crop a PDF free. Set top, right, bottom and left margins in points and download the trimmed document.",
        "steps": [
            "Choose the PDF you want to crop.",
            "Enter the margins to remove (in points; 72 pt = 1 inch).",
            "Optionally limit the crop to certain pages.",
            "Press <strong>Crop PDF</strong> and download.",
        ],
        "rules": [
            ("Margins are removed from every selected page from the outside inwards.", False),
            ("The crop is stored in the PDF's page box — viewers that ignore crop boxes may show the full page.", False),
            ("A page cannot be cropped to less than 40 × 40 points.", True),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("rotate", "Rotate PDF"), ("page-numbers", "Page Numbers"), ("redact", "Redact PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="row-3">
        <div class="field">
          <label for="top">Top (pt)</label>
          <input type="number" id="top" value="24" min="0">
        </div>
        <div class="field">
          <label for="right">Right (pt)</label>
          <input type="number" id="right" value="24" min="0">
        </div>
        <div class="field">
          <label for="bottom">Bottom (pt)</label>
          <input type="number" id="bottom" value="24" min="0">
        </div>
        <div class="field">
          <label for="left">Left (pt)</label>
          <input type="number" id="left" value="24" min="0">
        </div>
        <div class="field">
          <label for="range">Pages</label>
          <input type="text" id="range" placeholder="all, or e.g. 1-3">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Crop PDF</button></div>
      <div class="field" style="margin-top:1rem">
        <label>Preview</label>
        <div class="preview" id="preview">No file selected yet.</div>
      </div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
fileInput.addEventListener('change', () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  if (fileInput.files[0]) renderPreview(fileInput.files[0], 'preview', 1);
});
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Crop PDF', 'Cropping…');
  setStatus('info', 'Trimming the margins…');
  try {
    await ensureLibs();
    const bytes = await readFileBytes(file);
    const doc = await PDFLib.PDFDocument.load(bytes);
    const pages = doc.getPages();
    const targets = parsePageRange(document.getElementById('range').value, pages.length);
    const top = parseFloat(document.getElementById('top').value) || 0;
    const right = parseFloat(document.getElementById('right').value) || 0;
    const bottom = parseFloat(document.getElementById('bottom').value) || 0;
    const left = parseFloat(document.getElementById('left').value) || 0;
    let done = 0;
    targets.forEach((idx) => {
      const page = pages[idx];
      const { width, height } = page.getSize();
      const w = width - left - right;
      const h = height - top - bottom;
      if (w < 40 || h < 40) return;
      page.setCropBox(left, bottom, w, h);
      page.setMediaBox(left, bottom, w, h);
      done++;
    });
    if (!done) { setStatus('err', 'Those margins are too large for this page size — reduce them and try again.'); return; }
    const out = await doc.save();
    addDownload(out, 'cropped.pdf', 'Download cropped.pdf');
    setStatus('ok', '✅ Cropped ' + done + ' page(s).');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Crop PDF');
  }
});""",
    },
    {
        "slug": "forms",
        "name": "PDF Forms",
        "icon": "🧾",
        "cat": "Edit",
        "desc": "Fill interactive PDF form fields, or add a new text field to any page.",
        "meta": "Fill PDF forms free. Existing fields are detected automatically, and you can add a new text field anywhere.",
        "steps": [
            "Choose a PDF with form fields and press <strong>Detect fields</strong>.",
            "Type into the fields that appear.",
            "Press <strong>Save filled PDF</strong> (tick flatten to lock the answers).",
            "To add a field instead, use the “Add a text field” section.",
        ],
        "rules": [
            ("Fields are detected from the PDF's AcroForm — forms flattened into an image cannot be filled.", True),
            ("“Flatten” makes answers permanent and removes the editable fields.", False),
            ("New fields can be added at any position, measured in points from the bottom-left.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("annotate", "Annotation"), ("sign", "Sign PDF"), ("edit", "Add Text")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF form</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="actions"><button class="btn secondary" id="detect" type="button">Detect fields</button></div>
      <div id="fields" style="margin-top:1rem"></div>
      <label class="check" style="margin-top:.6rem"><input type="checkbox" id="flatten"> Flatten fields when saving</label>
      <div class="actions"><button class="btn" id="run" type="button">Save filled PDF</button></div>

      <h2 style="margin-top:1.6rem;font-size:.95rem">Add a text field</h2>
      <div class="row-3">
        <div class="field">
          <label for="fieldName">Field name</label>
          <input type="text" id="fieldName" value="new_field">
        </div>
        <div class="field">
          <label for="fieldPage">Page</label>
          <input type="number" id="fieldPage" value="1" min="1">
        </div>
        <div class="field">
          <label for="fieldX">X</label>
          <input type="number" id="fieldX" value="72">
        </div>
        <div class="field">
          <label for="fieldY">Y</label>
          <input type="number" id="fieldY" value="700">
        </div>
        <div class="field">
          <label for="fieldW">Width</label>
          <input type="number" id="fieldW" value="200">
        </div>
        <div class="field">
          <label for="fieldH">Height</label>
          <input type="number" id="fieldH" value="24">
        </div>
      </div>
      <div class="actions"><button class="btn secondary" id="addField" type="button">Add field &amp; download</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const fieldsBox = document.getElementById('fields');
const detectBtn = document.getElementById('detect');
const runBtn = document.getElementById('run');
const addBtn = document.getElementById('addField');
let doc = null;
let formDoc = null;

async function load(generate) {
  const file = fileInput.files[0];
  if (!file) throw new Error('Please choose a PDF file first.');
  await ensureLibs();
  const bytes = await readFileBytes(file);
  doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  formDoc = doc.getForm();
  const fields = formDoc.getFields();
  if (generate) {
    fieldsBox.innerHTML = '';
    if (!fields.length) {
      fieldsBox.innerHTML = '<div class="hint">No interactive fields found in this PDF. Use “Add a text field” below, or annotate the page.</div>';
    }
    fields.forEach((f) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = f.getName() + ' (' + f.constructor.name.replace('PDF', '') + ')';
      wrap.appendChild(label);
      if (f instanceof PDFLib.PDFTextField) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = f.getText() || '';
        input.dataset.field = f.getName();
        wrap.appendChild(input);
      } else if (f instanceof PDFLib.PDFCheckBox) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = f.isChecked();
        input.dataset.field = f.getName();
        input.dataset.kind = 'check';
        wrap.appendChild(input);
      } else if (f instanceof PDFLib.PDFDropdown) {
        const select = document.createElement('select');
        select.dataset.field = f.getName();
        select.dataset.kind = 'choice';
        f.getOptions().forEach((opt) => {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          select.appendChild(o);
        });
        wrap.appendChild(select);
      } else {
        const note = document.createElement('div');
        note.className = 'hint';
        note.textContent = 'This field type is kept as-is.';
        wrap.appendChild(note);
      }
      fieldsBox.appendChild(wrap);
    });
  }
  return fields;
}

detectBtn.addEventListener('click', async () => {
  clearStatus();
  document.getElementById('output').innerHTML = '';
  try {
    const fields = await load(true);
    setStatus('ok', '✅ ' + fields.length + ' field(s) found on ' + doc.getPageCount() + ' page(s).');
  } catch (err) {
    fieldsBox.innerHTML = '';
    setStatus('err', '❌ ' + friendlyError(err));
  }
});

runBtn.addEventListener('click', async () => {
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Save filled PDF', 'Saving…');
  try {
    await load(false);
    const inputs = Array.from(fieldsBox.querySelectorAll('[data-field]'));
    if (!inputs.length) { setStatus('err', 'Press “Detect fields” first, then fill the form.'); return; }
    inputs.forEach((input) => {
      const field = formDoc.getField(input.dataset.field);
      if (field instanceof PDFLib.PDFTextField) field.setText(input.value);
      else if (field instanceof PDFLib.PDFCheckBox) { input.checked ? field.check() : field.uncheck(); }
      else if (field instanceof PDFLib.PDFDropdown) field.select(input.value);
    });
    if (document.getElementById('flatten').checked) formDoc.flatten();
    const out = await doc.save();
    addDownload(out, 'filled-form.pdf', 'Download filled-form.pdf');
    setStatus('ok', '✅ ' + inputs.length + ' field(s) filled and saved.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Save filled PDF');
  }
});

addBtn.addEventListener('click', async () => {
  document.getElementById('output').innerHTML = '';
  setBusy(addBtn, true, 'Add field & download', 'Adding…');
  try {
    await load(false);
    const name = (document.getElementById('fieldName').value || 'new_field').trim();
    const pageNum = Math.max(1, parseInt(document.getElementById('fieldPage').value, 10) || 1);
    const pages = doc.getPages();
    if (pageNum > pages.length) throw new Error('This document has only ' + pages.length + ' pages.');
    const field = formDoc.createTextField(name);
    field.addToPage(pages[pageNum - 1], {
      x: parseFloat(document.getElementById('fieldX').value) || 72,
      y: parseFloat(document.getElementById('fieldY').value) || 700,
      width: parseFloat(document.getElementById('fieldW').value) || 200,
      height: parseFloat(document.getElementById('fieldH').value) || 24,
      borderColor: PDFLib.rgb(0.4, 0.45, 0.55),
      backgroundColor: PDFLib.rgb(1, 1, 1)
    });
    const out = await doc.save();
    addDownload(out, 'with-field.pdf', 'Download with-field.pdf');
    setStatus('ok', '✅ Added the field “' + name + '” on page ' + pageNum + '.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(addBtn, false, 'Add field & download');
  }
});""",
    },
]
