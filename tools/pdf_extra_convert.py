"""Conversion + intelligence tools for the PDF toolbox."""

EXTRA_CONVERT = [
    {
        "slug": "pdf-to-word",
        "name": "PDF to Word",
        "icon": "📝",
        "cat": "Convert",
        "desc": "Extract the text of a PDF into an editable Word (.docx) document.",
        "meta": "Convert PDF to Word free in your browser. Text is extracted into a .docx file you can edit in Word, Docs or LibreOffice.",
        "steps": [
            "Choose the PDF you want to convert.",
            "Press <strong>Convert to Word</strong> — text is read page by page.",
            "Wait for the green message with the paragraph count.",
            "Download <strong>converted.docx</strong> and open it in Word or Google Docs.",
        ],
        "rules": [
            ("Only selectable text is exported — layout, images and columns are not recreated.", True),
            ("Scanned PDFs have no text layer; run OCR PDF first.", True),
            ("Each PDF page starts on a new Word page.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("pdf-to-excel", "PDF to Excel"), ("pdf-to-markdown", "PDF to Markdown"), ("ocr", "OCR PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
        <div class="hint">Text-based PDFs work best. Scans need OCR first.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to Word</button></div>
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
  setBusy(runBtn, true, 'Convert to Word', 'Converting…');
  setStatus('info', 'Reading the document…');
  try {
    const pages = await extractTextPages(file, (i, n) => setStatus('info', 'Reading page ' + i + ' of ' + n + '…'));
    const paragraphs = pages.reduce((sum, p) => sum + p.length, 0);
    if (!paragraphs) { setStatus('err', 'This PDF has no selectable text. It looks like a scan — use the OCR PDF tool first.'); return; }
    const blob = await buildDocx(pages);
    addFileDownload(blob, 'converted.docx', 'Download converted.docx');
    setStatus('ok', '✅ ' + paragraphs + ' paragraphs from ' + pages.length + ' page(s) saved as DOCX.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Convert to Word');
  }
});""",
    },
    {
        "slug": "pdf-to-powerpoint",
        "name": "PDF to PowerPoint",
        "icon": "📊",
        "cat": "Convert",
        "desc": "Turn every PDF page into a slide in a .pptx presentation.",
        "meta": "Convert PDF to PowerPoint free. Each page becomes a 16:9 slide with its text — open the .pptx in PowerPoint or Slides.",
        "steps": [
            "Choose the PDF you want to turn into slides.",
            "Press <strong>Convert to PowerPoint</strong>.",
            "Each page becomes one 16:9 slide, first line as the title.",
            "Download <strong>converted.pptx</strong>.",
        ],
        "rules": [
            ("Slides contain text only — images and exact positions are not transferred.", True),
            ("Long pages are split into a title plus body text, capped per slide.", False),
            ("Scanned PDFs need OCR PDF first, otherwise slides come out empty.", True),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("pdf-to-word", "PDF to Word"), ("pdf-to-excel", "PDF to Excel"), ("jpg-to-pdf", "JPG to PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
        <div class="hint">One PDF page = one slide.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to PowerPoint</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Convert to PowerPoint', 'Converting…');
  setStatus('info', 'Collecting text…');
  try {
    const pages = await extractTextPages(file, (i, n) => setStatus('info', 'Reading page ' + i + ' of ' + n + '…'));
    const withText = pages.filter((p) => p.length);
    if (!withText.length) { setStatus('err', 'This PDF has no selectable text. Run OCR PDF first.'); return; }
    await ensurePPTX();
    setStatus('info', 'Building ' + pages.length + ' slide(s)…');
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pages.forEach((lines, i) => {
      const slide = pptx.addSlide();
      const title = (lines[0] || 'Page ' + (i + 1)).slice(0, 90);
      slide.addText(title, { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 24, bold: true, color: '1F2937' });
      const bodyText = lines.slice(1, 18).join('\\n');
      if (bodyText) slide.addText(bodyText, { x: 0.5, y: 1.25, w: 9, h: 3.8, fontSize: 12, color: '374151', valign: 'top' });
    });
    const data = await pptx.write({ outputType: 'blob' });
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    addFileDownload(blob, 'converted.pptx', 'Download converted.pptx');
    setStatus('ok', '✅ ' + pages.length + ' slide(s) created.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Convert to PowerPoint');
  }
});""",
    },
    {
        "slug": "pdf-to-excel",
        "name": "PDF to Excel",
        "icon": "📈",
        "cat": "Convert",
        "desc": "Pull every line of text out of a PDF into an Excel (.xlsx) sheet.",
        "meta": "Convert PDF to Excel free. Each page's lines land in a spreadsheet column, ready to clean up and calculate.",
        "steps": [
            "Choose the PDF you want as a spreadsheet.",
            "Press <strong>Convert to Excel</strong>.",
            "Text is read page by page and written row by row.",
            "Download <strong>converted.xlsx</strong> and open it in Excel.",
        ],
        "rules": [
            ("Text is exported as rows (page number + line) — tables are not rebuilt cell by cell.", True),
            ("Scanned PDFs need OCR PDF first.", True),
            ("Merged cells and styling are not preserved.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("pdf-to-word", "PDF to Word"), ("excel-to-pdf", "Excel to PDF"), ("pdf-to-markdown", "PDF to Markdown")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
        <div class="hint">Every text line becomes one spreadsheet row.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to Excel</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Convert to Excel', 'Converting…');
  setStatus('info', 'Reading text…');
  try {
    const pages = await extractTextPages(file, (i, n) => setStatus('info', 'Reading page ' + i + ' of ' + n + '…'));
    const rows = [['Page', 'Text']];
    pages.forEach((lines, i) => lines.forEach((line) => rows.push([i + 1, line])));
    if (rows.length < 2) { setStatus('err', 'This PDF has no selectable text. Run OCR PDF first.'); return; }
    await ensureXLSX();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 8 }, { wch: 110 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PDF text');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    addFileDownload(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'converted.xlsx', 'Download converted.xlsx');
    setStatus('ok', '✅ ' + (rows.length - 1) + ' text line(s) from ' + pages.length + ' page(s) written to the sheet.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Convert to Excel');
  }
});""",
    },
    {
        "slug": "word-to-pdf",
        "name": "Word to PDF",
        "icon": "📄",
        "cat": "Convert",
        "desc": "Convert a .docx document into a clean, readable PDF.",
        "meta": "Convert Word to PDF free in your browser. Pick a .docx file and get a tidy A4 PDF with the document text.",
        "steps": [
            "Choose a <strong>.docx</strong> file (Word 2007 or newer).",
            "Press <strong>Convert to PDF</strong>.",
            "Paragraphs are laid out on A4 pages automatically.",
            "Download <strong>converted.pdf</strong>.",
        ],
        "rules": [
            ("Text and paragraph breaks are kept; images, tables and colours are not.", True),
            ("Only .docx is supported — old .doc files must be saved as .docx in Word first.", True),
            ("Long paragraphs wrap automatically across pages.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("powerpoint-to-pdf", "PowerPoint to PDF"), ("excel-to-pdf", "Excel to PDF"), ("html-to-pdf", "HTML to PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a Word document</label>
        <input type="file" id="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        <div class="hint">Only .docx files (Word 2007+).</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to PDF</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a .docx file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Convert to PDF', 'Converting…');
  setStatus('info', 'Reading the document…');
  try {
    const paragraphs = await readDocxParagraphs(file);
    if (!paragraphs.length) { setStatus('err', 'No text was found in this document — is it empty?'); return; }
    setStatus('info', 'Laying out ' + paragraphs.length + ' paragraph(s)…');
    const bytes = await textPdf([paragraphs], { size: 11, leading: 17, title: file.name });
    addDownload(bytes, 'converted.pdf', 'Download converted.pdf');
    setStatus('ok', '✅ ' + paragraphs.length + ' paragraph(s) written to PDF.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Convert to PDF');
  }
});""",
    },
    {
        "slug": "powerpoint-to-pdf",
        "name": "PowerPoint to PDF",
        "icon": "📽️",
        "cat": "Convert",
        "desc": "Turn a .pptx deck into a landscape PDF, one slide per page.",
        "meta": "Convert PowerPoint to PDF free. Every slide becomes a landscape page with its text, straight from your browser.",
        "steps": [
            "Choose a <strong>.pptx</strong> presentation.",
            "Press <strong>Convert to PDF</strong>.",
            "Each slide becomes one landscape A4 page.",
            "Download <strong>slides.pdf</strong>.",
        ],
        "rules": [
            ("Slide text is reproduced; images, shapes and animations are not.", True),
            ("Only .pptx is supported — save old .ppt files as .pptx first.", True),
            ("Very long slides are cut off at the bottom of the page.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("word-to-pdf", "Word to PDF"), ("excel-to-pdf", "Excel to PDF"), ("pdf-to-powerpoint", "PDF to PowerPoint")],
        "body": """      <div class="field">
        <label for="file">Choose a presentation</label>
        <input type="file" id="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation">
        <div class="hint">Only .pptx files (PowerPoint 2007+).</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to PDF</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a .pptx file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Convert to PDF', 'Converting…');
  setStatus('info', 'Reading the slides…');
  try {
    const slides = await readPptxSlides(file);
    await ensureLibs();
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    slides.forEach((texts, i) => {
      const page = doc.addPage([842, 595]);
      let y = 535;
      const title = texts[0] || 'Slide ' + (i + 1);
      for (const line of wrapText(title, bold, 22, 760)) {
        page.drawText(line, { x: 40, y, size: 22, font: bold, color: PDFLib.rgb(0.1, 0.12, 0.18) });
        y -= 28;
      }
      y -= 10;
      for (const raw of texts.slice(1)) {
        for (const line of wrapText(raw, font, 13, 760)) {
          if (y < 40) return;
          page.drawText(line, { x: 40, y, size: 13, font, color: PDFLib.rgb(0.2, 0.23, 0.29) });
          y -= 18;
        }
      }
    });
    doc.setTitle(file.name);
    doc.setProducer('VK PDF Toolbox');
    const bytes = await doc.save();
    addDownload(bytes, 'slides.pdf', 'Download slides.pdf');
    setStatus('ok', '✅ ' + slides.length + ' slide(s) converted to PDF pages.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Convert to PDF');
  }
});""",
    },
    {
        "slug": "excel-to-pdf",
        "name": "Excel to PDF",
        "icon": "📑",
        "cat": "Convert",
        "desc": "Print a spreadsheet as a tidy PDF table, sheets one after another.",
        "meta": "Convert Excel to PDF free. Every sheet becomes a landscape PDF table with borders and wrapped cells.",
        "steps": [
            "Choose an <strong>.xlsx</strong> spreadsheet.",
            "Press <strong>Convert to PDF</strong>.",
            "Each sheet becomes a landscape table; the header row repeats on every page.",
            "Download <strong>spreadsheet.pdf</strong>.",
        ],
        "rules": [
            ("Cell values are printed as plain text; formulas are not evaluated and styles are lost.", True),
            ("Very wide sheets are squeezed — keep print areas narrow for best results.", False),
            ("Only .xlsx is supported (not .xls).", True),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("word-to-pdf", "Word to PDF"), ("pdf-to-excel", "PDF to Excel"), ("powerpoint-to-pdf", "PowerPoint to PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a spreadsheet</label>
        <input type="file" id="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        <div class="hint">Only .xlsx files.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to PDF</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a .xlsx file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Convert to PDF', 'Converting…');
  setStatus('info', 'Reading the workbook…');
  try {
    const sheets = await readXlsxSheets(file);
    await ensureLibs();
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const PAGE_W = 842, PAGE_H = 595, M = 32, SIZE = 9, LINE = 11;
    let pages = 0;
    for (const sheet of sheets) {
      const rows = sheet.rows.filter((r) => r.some((c) => String(c).trim() !== ''));
      if (!rows.length) continue;
      const cols = Math.max.apply(null, rows.map((r) => r.length));
      const widths = [];
      for (let c = 0; c < cols; c++) {
        const maxChars = Math.max.apply(null, rows.map((r) => String(r[c] == null ? '' : r[c]).length));
        widths.push(Math.min(160, Math.max(48, maxChars * SIZE * 0.55 + 8)));
      }
      const total = widths.reduce((a, b) => a + b, 0);
      const scale = total > (PAGE_W - M * 2) ? (PAGE_W - M * 2) / total : 1;
      const finalWidths = widths.map((w) => w * scale);
      let page = doc.addPage([PAGE_W, PAGE_H]);
      pages++;
      let y = PAGE_H - M;
      page.drawText(sheet.name, { x: M, y: y + 8, size: 12, font: bold, color: PDFLib.rgb(0.1, 0.12, 0.18) });
      y -= 16;
      let header = rows[0];
      let body = rows.slice(1);
      const drawRow = (cells, isHeader) => {
        const linesPer = cells.map((cell, c) => wrapText(String(cell == null ? '' : cell), isHeader ? bold : font, SIZE, finalWidths[c] - 6));
        const height = Math.max.apply(null, linesPer.map((l) => l.length)) * LINE + 4;
        if (y - height < M) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          pages++;
          y = PAGE_H - M;
          drawRow(header, true);
        }
        let x = M;
        cells.forEach((cell, c) => {
          const w = finalWidths[c];
          page.drawRectangle({ x, y: y - height, width: w, height, borderColor: PDFLib.rgb(0.75, 0.78, 0.82), borderWidth: 0.5, color: isHeader ? PDFLib.rgb(0.93, 0.95, 0.98) : undefined });
          linesPer[c].forEach((ln, li) => {
            page.drawText(ln, { x: x + 3, y: y - 12 - li * LINE, size: SIZE, font: isHeader ? bold : font, color: PDFLib.rgb(0.12, 0.14, 0.18) });
          });
          x += w;
        });
        y -= height;
      };
      drawRow(header, true);
      for (const row of body) {
        if (y < M + 20) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          pages++;
          y = PAGE_H - M;
          drawRow(header, true);
        }
        drawRow(row, false);
      }
    }
    if (!pages) { setStatus('err', 'This workbook has no readable cells.'); return; }
    doc.setTitle(file.name);
    doc.setProducer('VK PDF Toolbox');
    const bytes = await doc.save();
    addDownload(bytes, 'spreadsheet.pdf', 'Download spreadsheet.pdf');
    setStatus('ok', '✅ ' + sheets.length + ' sheet(s) printed on ' + pages + ' page(s).');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Convert to PDF');
  }
});""",
    },
    {
        "slug": "pdf-to-jpg",
        "name": "PDF to JPG",
        "icon": "🖼️",
        "cat": "Convert",
        "desc": "Save every PDF page as a JPG image, in one ZIP when there are several.",
        "meta": "Convert PDF to JPG free. Choose the resolution and download page images — a single JPG or a ZIP.",
        "steps": [
            "Choose the PDF you want as images.",
            "Pick a resolution (150 DPI is good for screens).",
            "Press <strong>Convert to JPG</strong>.",
            "Download the single JPG, or the ZIP for a multi-page file.",
        ],
        "rules": [
            ("One JPG per page; multi-page files arrive as a ZIP.", False),
            ("Higher DPI gives sharper images but bigger files.", False),
            ("Very large documents take longer — keep the tab open.", False),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("jpg-to-pdf", "JPG to PDF"), ("pdf-to-word", "PDF to Word"), ("compress", "Compress PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="row">
        <div class="field">
          <label for="dpi">Resolution</label>
          <select id="dpi">
            <option value="1.4">150 DPI — small, good for screen</option>
            <option value="2" selected>200 DPI — balanced</option>
            <option value="2.8">300 DPI — print quality</option>
          </select>
        </div>
        <div class="field">
          <label for="quality">JPG quality</label>
          <select id="quality">
            <option value="0.75">Good (smaller)</option>
            <option value="0.88" selected>High</option>
            <option value="0.95">Maximum</option>
          </select>
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to JPG</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Convert to JPG', 'Rendering…');
  try {
    const scale = parseFloat(document.getElementById('dpi').value) || 2;
    const quality = parseFloat(document.getElementById('quality').value) || 0.88;
    const pdf = await openPdfJs(file);
    const files = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus('info', 'Rendering page ' + i + ' of ' + pdf.numPages + '…');
      const canvas = await renderPageCanvas(pdf, i, scale);
      const blob = await canvasToJpeg(canvas, quality);
      files.push({ name: 'page-' + i + '.jpg', data: await blobToBytes(blob) });
    }
    if (files.length === 1) {
      addFileDownload(new Blob([files[0].data], { type: 'image/jpeg' }), files[0].name, 'Download page-1.jpg');
    } else {
      await addZipDownload(files, 'pdf-pages.zip');
    }
    setStatus('ok', '✅ ' + files.length + ' JPG image(s) ready.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Convert to JPG');
  }
});""",
    },
    {
        "slug": "jpg-to-pdf",
        "name": "JPG to PDF",
        "icon": "🖼️",
        "cat": "Convert",
        "desc": "Combine JPG or PNG images into one PDF, one image per page.",
        "meta": "Convert JPG to PDF free. Add photos or scans, choose page size and margins, and download one PDF.",
        "steps": [
            "Choose one or more JPG or PNG images.",
            "Pick the page size and margin.",
            "Press <strong>Create PDF</strong>.",
            "Download <strong>images.pdf</strong>.",
        ],
        "rules": [
            ("Supported formats: JPG and PNG (not WebP, HEIC or GIF).", True),
            ("One image per page, in the order you select them.", False),
            ("“Fit A4” keeps the whole image with margins; “Image size” uses the exact pixels.", False),
            ("Maximum file size is 50 MB per image.", False),
        ],
        "related": [("pdf-to-jpg", "PDF to JPG"), ("scan-to-pdf", "Scan to PDF"), ("merge", "Merge PDF")],
        "body": """      <div class="field">
        <label for="file">Choose images</label>
        <input type="file" id="file" accept="image/jpeg,image/png" multiple>
        <div class="hint">JPG or PNG, one page per image.</div>
      </div>
      <div class="row-3">
        <div class="field">
          <label for="size">Page size</label>
          <select id="size">
            <option value="a4" selected>Fit A4</option>
            <option value="image">Image size</option>
          </select>
        </div>
        <div class="field">
          <label for="margin">Margin</label>
          <select id="margin">
            <option value="0">None</option>
            <option value="24" selected>24 pt</option>
            <option value="48">48 pt</option>
          </select>
        </div>
        <div class="field">
          <label for="name">Filename</label>
          <input type="text" id="name" value="images.pdf">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Create PDF</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) { setStatus('err', 'Please choose at least one JPG or PNG image.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Create PDF', 'Building…');
  setStatus('info', 'Embedding ' + files.length + ' image(s)…');
  try {
    await ensureLibs();
    const doc = await PDFLib.PDFDocument.create();
    const mode = document.getElementById('size').value;
    const margin = parseFloat(document.getElementById('margin').value) || 0;
    for (const file of files) {
      const bytes = await readFileBytes(file);
      const isPng = /png/i.test(file.type) || /\\.png$/i.test(file.name);
      let image;
      try {
        image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      } catch (e) {
        throw new Error('“' + file.name + '” is not a JPG or PNG image. Convert it first.');
      }
      if (mode === 'image') {
        const page = doc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      } else {
        const portrait = image.height >= image.width;
        const pageSize = portrait ? PDFLib.PageSizes.A4 : [PDFLib.PageSizes.A4[1], PDFLib.PageSizes.A4[0]];
        const page = doc.addPage(pageSize);
        const maxW = page.getWidth() - margin * 2;
        const maxH = page.getHeight() - margin * 2;
        const ratio = Math.min(maxW / image.width, maxH / image.height);
        const w = image.width * ratio;
        const h = image.height * ratio;
        page.drawImage(image, { x: (page.getWidth() - w) / 2, y: (page.getHeight() - h) / 2, width: w, height: h });
      }
    }
    const out = await doc.save();
    const name = (document.getElementById('name').value || 'images.pdf').trim();
    addDownload(out, name, 'Download ' + name);
    setStatus('ok', '✅ ' + files.length + ' image(s) placed on ' + doc.getPageCount() + ' page(s).');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Create PDF');
  }
});""",
    },
    {
        "slug": "html-to-pdf",
        "name": "HTML to PDF",
        "icon": "🌐",
        "cat": "Convert",
        "desc": "Paste HTML (or text) and save it as a PDF through your browser's own print dialog.",
        "meta": "Convert HTML to PDF free. Paste your markup, open the print view and choose Save as PDF — formatting stays intact.",
        "steps": [
            "Paste your HTML or plain text into the box.",
            "Press <strong>Open print view</strong> — a new tab opens with your content.",
            "In the print dialog choose <strong>Destination → Save as PDF</strong>.",
            "Save the file — headings, lists, tables and links keep their formatting.",
        ],
        "rules": [
            ("The PDF is created by your browser's print engine, so this page must be allowed to open pop-ups.", True),
            ("Scripts and external stylesheets inside the pasted code are ignored for safety.", True),
            ("Remote URLs cannot be fetched here — paste the HTML, or open the URL and use your browser's Print.", True),
            ("Images must be reachable by your browser (full https URLs or inline data).", False),
        ],
        "related": [("word-to-pdf", "Word to PDF"), ("pdf-to-markdown", "PDF to Markdown"), ("blank", "Blank PDF")],
        "body": """      <div class="field">
        <label for="html">HTML or text</label>
        <textarea id="html" rows="10" placeholder="<h1>Invoice</h1><p>Hello world…</p>">&lt;h1&gt;My document&lt;/h1&gt;
&lt;p&gt;Paste any HTML here — headings, lists, tables and links keep their formatting.&lt;/p&gt;</textarea>
        <div class="hint">Tip: keep CSS inline or in a &lt;style&gt; tag inside the pasted HTML.</div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Open print view</button></div>""",
        "script": """const runBtn = document.getElementById('run');
const area = document.getElementById('html');
runBtn.addEventListener('click', () => {
  const html = area.value.trim();
  if (!html) { setStatus('err', 'Please paste some HTML or text first.'); return; }
  const win = window.open('', '_blank');
  if (!win) { setStatus('err', 'Your browser blocked the new tab. Allow pop-ups for this site and try again.'); return; }
  const stripped = html.replace(/<script[\\s\\S]*?<\\/script>/gi, '').replace(/ on\\w+="[^"]*"/gi, '');
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print to PDF — VK PDF Toolbox</title>' +
    '<style>body{font:15px/1.6 Arial,Helvetica,sans-serif;color:#111;margin:32px;max-width:820px}' +
    'table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px 8px;text-align:left}' +
    'img{max-width:100%}h1,h2,h3{line-height:1.25}code,pre{background:#f4f4f5;padding:2px 4px;border-radius:4px}</style>' +
    '</head><body>' + stripped + '</body></html>');
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 400);
  setStatus('ok', '✅ Print view opened. Choose “Save as PDF” as the destination to get your PDF.');
});""",
    },
    {
        "slug": "pdf-to-markdown",
        "name": "PDF to Markdown",
        "icon": "📋",
        "cat": "Convert",
        "desc": "Turn a PDF into clean Markdown with headings and lists, ready for notes or LLMs.",
        "meta": "Convert PDF to Markdown free. Headings and bullets are detected from text size, and the .md downloads instantly.",
        "steps": [
            "Choose the PDF you want as Markdown.",
            "Press <strong>Convert to Markdown</strong>.",
            "Large lines become headings (#, ##), bullet characters become list items.",
            "Download <strong>document.md</strong>.",
        ],
        "rules": [
            ("Heading levels come from font size, so documents without size differences stay plain paragraphs.", False),
            ("Images, tables and bold/italic styling are not converted.", True),
            ("Scanned PDFs need OCR PDF first.", True),
            ("Maximum file size is 50 MB.", False),
        ],
        "related": [("pdf-to-word", "PDF to Word"), ("summarize", "AI Summarizer"), ("pdf-to-excel", "PDF to Excel")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Convert to Markdown</button></div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Convert to Markdown', 'Converting…');
  setStatus('info', 'Reading the document…');
  try {
    const pdf = await openPdfJs(file);
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus('info', 'Reading page ' + i + ' of ' + pdf.numPages + '…');
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const lines = [];
      let cur = '';
      let size = 0;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        cur += item.str;
        size = Math.max(size, item.height || 0);
        if (item.hasEOL) {
          if (cur.trim()) lines.push({ text: cur.trim(), size });
          cur = '';
          size = 0;
        } else {
          cur += ' ';
        }
      }
      if (cur.trim()) lines.push({ text: cur.trim(), size });
      for (const line of lines) {
        const bullet = /^[•·‣▪\\-*]\\s+/.test(line.text);
        if (bullet) out.push('- ' + line.text.replace(/^[•·‣▪\\-*]\\s+/, ''));
        else if (line.size >= 18) out.push('\\n# ' + line.text);
        else if (line.size >= 14) out.push('\\n## ' + line.text);
        else if (line.size >= 11.5) out.push('\\n### ' + line.text);
        else out.push(line.text);
      }
      out.push('');
    }
    const md = out.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
    if (!md) { setStatus('err', 'This PDF has no selectable text. Run OCR PDF first.'); return; }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    addFileDownload(blob, 'document.md', 'Download document.md');
    setStatus('ok', '✅ Markdown ready (' + md.length + ' characters from ' + pdf.numPages + ' page(s)).');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Convert to Markdown');
  }
});""",
    },
    {
        "slug": "summarize",
        "name": "AI Summarizer",
        "icon": "✨",
        "cat": "Intelligence",
        "desc": "Get a short, readable summary of a long PDF in seconds — computed on your device.",
        "meta": "Summarize a PDF free. Key sentences are picked offline in your browser and saved as text or PDF.",
        "steps": [
            "Choose the PDF you want summarised.",
            "Set how many sentences you want (3–15).",
            "Press <strong>Summarise</strong>.",
            "Read it on the page, or download it as TXT or PDF.",
        ],
        "rules": [
            ("The summary is extractive: it picks the most important existing sentences, it does not rewrite them.", True),
            ("Nothing is sent to an AI service — the text never leaves your browser.", False),
            ("Scanned PDFs have no text to summarise; run OCR PDF first.", True),
            ("Short documents (under ~5 sentences) come back almost unchanged.", False),
        ],
        "related": [("translate", "Translate PDF"), ("pdf-to-markdown", "PDF to Markdown"), ("ocr", "OCR PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="row">
        <div class="field">
          <label for="count">Summary length</label>
          <select id="count">
            <option value="3">3 sentences — quick gist</option>
            <option value="5" selected>5 sentences — short</option>
            <option value="8">8 sentences — medium</option>
            <option value="12">12 sentences — detailed</option>
          </select>
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Summarise</button></div>
      <div class="field" style="margin-top:1rem">
        <label>Summary</label>
        <div class="preview" id="result" style="min-height:120px;max-height:360px">The summary will appear here.</div>
      </div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
const resultBox = document.getElementById('result');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Summarise', 'Reading…');
  setStatus('info', 'Reading the document…');
  try {
    const pages = await extractTextPages(file, (i, n) => setStatus('info', 'Reading page ' + i + ' of ' + n + '…'));
    const text = pages.map((p) => p.join(' ')).join(' ').replace(/\\s+/g, ' ').trim();
    if (text.length < 80) { setStatus('err', 'Not enough text to summarise. If this is a scan, run OCR PDF first.'); return; }
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const stop = new Set('the a an and or but of to in on for with is are was were be been this that these those it its as at by from not no can will would could should have has had do does did which who whom what when where how than then so if into over under more most other some such only own same very just about after before also'.split(' '));
    const freq = {};
    text.toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').split(/\\s+/).forEach((w) => {
      if (w.length > 3 && !stop.has(w)) freq[w] = (freq[w] || 0) + 1;
    });
    const scored = sentences.map((s, i) => {
      const words = s.toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').split(/\\s+/);
      let score = 0;
      words.forEach((w) => { if (freq[w]) score += freq[w]; });
      return { i, s: s.trim(), score: score / Math.sqrt(words.length || 1) };
    });
    const want = Math.min(parseInt(document.getElementById('count').value, 10) || 5, sentences.length);
    const picked = scored.slice().sort((a, b) => b.score - a.score).slice(0, want).sort((a, b) => a.i - b.i);
    const summary = picked.map((p) => p.s).join(' ');
    resultBox.textContent = summary;
    const blob = new Blob([summary + '\\n\\n— Summary of ' + file.name + ' (VK PDF Toolbox)'], { type: 'text/plain;charset=utf-8' });
    addFileDownload(blob, 'summary.txt', 'Download summary.txt');
    const pdfLines = [];
    let line = '';
    summary.split(/\\s+/).forEach((w) => {
      if ((line + ' ' + w).length > 95) { pdfLines.push(line); line = w; } else { line = line ? line + ' ' + w : w; }
    });
    if (line) pdfLines.push(line);
    const bytes = await textPdf([[file.name, ''].concat(pdfLines), []], { size: 12, leading: 18, title: 'Summary' });
    addDownload(bytes, 'summary.pdf', 'Download summary.pdf');
    setStatus('ok', '✅ ' + want + ' key sentence(s) picked from ' + sentences.length + '.');
  } catch (err) {
    setStatus('err', '❌ ' + friendlyError(err));
  } finally {
    setBusy(runBtn, false, 'Summarise');
  }
});""",
    },
    {
        "slug": "translate",
        "name": "Translate PDF",
        "icon": "🌍",
        "cat": "Intelligence",
        "desc": "Translate the text of a PDF into another language and save it as text or PDF.",
        "meta": "Translate PDF text free. Pick a language pair, translate page by page and download the result as TXT or PDF.",
        "steps": [
            "Choose the PDF you want translated.",
            "Pick the source and target languages.",
            "Press <strong>Translate</strong> — long files are sent in small chunks.",
            "Read the translation on the page, or download TXT / PDF.",
        ],
        "rules": [
            ("Text is translated, not layout — the translated PDF is plain text in reading order.", True),
            ("The extracted text is sent to the free MyMemory translation API, so avoid confidential documents.", True),
            ("The free service allows roughly 5,000 characters per day — split very long PDFs.", True),
            ("Scanned PDFs need OCR PDF first.", True),
        ],
        "related": [("summarize", "AI Summarizer"), ("pdf-to-word", "PDF to Word"), ("ocr", "OCR PDF")],
        "body": """      <div class="field">
        <label for="file">Choose a PDF file</label>
        <input type="file" id="file" accept="application/pdf">
      </div>
      <div class="row-3">
        <div class="field">
          <label for="from">From</label>
          <select id="from">
            <option value="en" selected>English</option>
            <option value="hi">Hindi</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="ar">Arabic</option>
            <option value="bn">Bengali</option>
            <option value="ta">Tamil</option>
            <option value="te">Telugu</option>
            <option value="zh-CN">Chinese</option>
            <option value="ja">Japanese</option>
            <option value="ru">Russian</option>
            <option value="pt">Portuguese</option>
          </select>
        </div>
        <div class="field">
          <label for="to">To</label>
          <select id="to">
            <option value="hi" selected>Hindi</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="ar">Arabic</option>
            <option value="bn">Bengali</option>
            <option value="ta">Tamil</option>
            <option value="te">Telugu</option>
            <option value="zh-CN">Chinese</option>
            <option value="ja">Japanese</option>
            <option value="ru">Russian</option>
            <option value="pt">Portuguese</option>
          </select>
        </div>
        <div class="field">
          <label for="pages">Pages</label>
          <input type="text" id="pages" placeholder="all, or e.g. 1-3">
        </div>
      </div>
      <div class="actions"><button class="btn" id="run" type="button">Translate</button></div>
      <div class="field" style="margin-top:1rem">
        <label>Translation</label>
        <div class="preview" id="result" style="min-height:120px;max-height:360px">The translation will appear here.</div>
      </div>""",
        "script": """const fileInput = document.getElementById('file');
const runBtn = document.getElementById('run');
const resultBox = document.getElementById('result');
runBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) { setStatus('err', 'Please choose a PDF file first.'); return; }
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  if (from === to) { setStatus('err', 'Please choose two different languages.'); return; }
  document.getElementById('output').innerHTML = '';
  setBusy(runBtn, true, 'Translate', 'Reading…');
  try {
    const pdf = await openPdfJs(file);
    const wanted = parsePageRange(document.getElementById('pages').value, pdf.numPages);
    const parts = [];
    for (const idx of wanted) {
      setStatus('info', 'Reading page ' + (idx + 1) + '…');
      const page = await pdf.getPage(idx + 1);
      const content = await page.getTextContent();
      const text = content.items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' ').replace(/\\s+/g, ' ').trim();
      if (text) parts.push(text);
    }
    const full = parts.join('\\n\\n');
    if (!full) { setStatus('err', 'No selectable text found. Run OCR PDF first.'); return; }
    const chunks = [];
    let chunk = '';
    full.split(/\\s+/).forEach((word) => {
      if ((chunk + ' ' + word).length > 420) { chunks.push(chunk); chunk = word; } else { chunk = chunk ? chunk + ' ' + word : word; }
    });
    if (chunk) chunks.push(chunk);
    if (chunks.length > 40) { setStatus('err', 'This document is too long for the free service (' + chunks.length + ' chunks). Translate fewer pages.'); return; }
    const outParts = [];
    for (let i = 0; i < chunks.length; i++) {
      setStatus('info', 'Translating part ' + (i + 1) + ' of ' + chunks.length + '…');
      const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(chunks[i]) + '&langpair=' + from + '|' + to;
      const res = await fetch(url);
      if (!res.ok) throw new Error('The translation service returned HTTP ' + res.status + '.');
      const json = await res.json();
      if (!json.responseData || !json.responseData.translatedText) throw new Error('The translation service did not return text (daily quota may be used up).');
      outParts.push(json.responseData.translatedText);
      await sleep(220);
    }
    const translated = outParts.join('\\n\\n');
    resultBox.textContent = translated;
    addFileDownload(new Blob([translated], { type: 'text/plain;charset=utf-8' }), 'translation.txt', 'Download translation.txt');
    setStatus('ok', '✅ Translated ' + parts.length + ' page(s) into ' + to + '.');
  } catch (err) {
    const msg = /fetch|network|Failed/i.test(err.message) ? 'Could not reach the translation service. Check your connection or try again later.' : err.message;
    setStatus('err', '❌ ' + msg);
  } finally {
    setBusy(runBtn, false, 'Translate');
  }
});""",
    },
]
