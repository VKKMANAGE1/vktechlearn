#!/usr/bin/env node
/**
 * M07 — real OCR for scanned PDFs and images on top of LibreChat v0.8.9.
 *
 * LibreChat has no OCR engine unless a Mistral OCR key is configured: its built-in
 * document parser reads only a PDF's text layer, so a scanned page extracts to "". This
 * script adds a page-level OCR fallback that renders the page image and transcribes it
 * with the vision endpoint already used by SHAVI AI.
 *
 *   - copies librechat-ocr/files/shaviOcr.ts into packages/api (the OCR engine)
 *   - rewrites `pdfToText` to work page by page, OCR only pages without a text layer,
 *     and emit `[Page N]` markers (page references)
 *   - teaches the parser to OCR image uploads (imageToText)
 *   - registers image MIME types as parser-supported types in data-provider
 *   - installs `canvas` (needed to turn page pixels into a PNG) and rebuilds the packages
 *
 * Idempotent: re-running is a no-op on patched files. Only the gitignored LibreChat clone
 * is modified.
 *
 *   node librechat-ocr/apply-ocr-support.mjs
 *   bash tools/start-librechat.sh --bg
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LC = path.join(ROOT, 'librechat');
const MARKER = 'SHAVI-OCR';

if (!fs.existsSync(LC)) {
  console.error('librechat/ clone not found — run: bash tools/setup-librechat.sh');
  process.exit(1);
}

const edits = [];
const patch = (rel, find, replace, label) => {
  const file = path.join(LC, rel);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(replace)) {
    edits.push(`${label}: already applied`);
    return;
  }
  if (!source.includes(find)) {
    console.error(`!! ${label}: anchor not found in ${rel} — LibreChat version changed?`);
    process.exit(1);
  }
  fs.writeFileSync(file, source.replace(find, replace));
  edits.push(`${label}: patched`);
};

/* 1. the OCR engine module */
const engineSource = fs.readFileSync(path.join(ROOT, 'librechat-ocr/files/shaviOcr.ts'), 'utf8');
const engineTarget = path.join(LC, 'packages/api/src/files/documents/shaviOcr.ts');
if (fs.existsSync(engineTarget) && fs.readFileSync(engineTarget, 'utf8') === engineSource) {
  edits.push('shaviOcr.ts: present');
} else {
  fs.writeFileSync(engineTarget, engineSource);
  edits.push('shaviOcr.ts: written');
}

/* 2. crud.ts: imports + page-aware PDF parsing + image OCR */
patch(
  'packages/api/src/files/documents/crud.ts',
  `import { spreadsheetToText } from './spreadsheet';`,
  `import { logger } from '@librechat/data-schemas';
import { spreadsheetToText } from './spreadsheet';
/* ${MARKER}: page-level OCR for scanned PDFs and images */
import {
  MIN_PAGE_TEXT_CHARS,
  ocrConfigured,
  ocrImageBuffer,
  ocrMaxPages,
  pageImagePng,
} from './shaviOcr';`,
  'crud imports',
);

patch(
  'packages/api/src/files/documents/crud.ts',
  `  if (mimetype === 'application/msword') {
    return legacyWordDocToText;
  }`,
  `  if (mimetype === 'application/msword') {
    return legacyWordDocToText;
  }
  /* ${MARKER}: images are transcribed by the vision endpoint when OCR is configured. */
  if (/^image\\/(png|jpe?g|webp|gif)$/.test(mimetype)) {
    return imageToText;
  }`,
  'image parser registration',
);

patch(
  'packages/api/src/files/documents/crud.ts',
  `/** Parses PDF, returns text inside. */
async function pdfToText(file: Express.Multer.File): Promise<string> {
  // Imported inline so that Jest can test other routes without failing due to loading ESM
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(await fs.promises.readFile(file.path));
  const pdf = await getDocument({ data }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item): item is TextItem => !('type' in item))
      .map((item) => item.str)
      .join(' ');
    fullText += pageText + '\\n';
  }

  return fullText;
}`,
  `/**
 * Parses a PDF page by page and returns one \`[Page N]\` block per page, so answers can
 * cite pages. A page whose text layer is empty/too short (a scan) is OCR'd from its image
 * with the configured vision endpoint; a page with a real text layer is never OCR'd, which
 * keeps cost and latency to the pages that actually need it.
 */
async function pdfToText(file: Express.Multer.File): Promise<string> {
  // Imported inline so that Jest can test other routes without failing due to loading ESM
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(await fs.promises.readFile(file.path));
  const pdf = await getDocument({ data }).promise;
  const maxOcrPages = ocrMaxPages();
  let ocrPages = 0;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const extracted = textContent.items
      .filter((item): item is TextItem => !('type' in item))
      .map((item) => item.str)
      .join(' ')
      .trim();

    if (extracted.length >= MIN_PAGE_TEXT_CHARS) {
      pages.push(\`[Page \${i}]\\n\${extracted}\`);
      continue;
    }

    let ocrText = '';
    if (ocrConfigured() && ocrPages < maxOcrPages) {
      try {
        const image = await pageImagePng(
          page as unknown as Parameters<typeof pageImagePng>[0],
        );
        if (image) {
          ocrText = await ocrImageBuffer(image);
          ocrPages += 1;
        }
      } catch (error) {
        /* A page that cannot be OCR'd keeps its text layer; the upload still succeeds and
         * the failure is visible here rather than as an empty document. */
        logger.warn(\`[pdfToText] OCR failed for page \${i} of \${file.originalname}\`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    pages.push(\`[Page \${i}]\\n\${ocrText || extracted}\`.trimEnd());
  }

  return pages.join('\\n\\n');
}

/**
 * ${MARKER}: transcribes an uploaded image with the vision endpoint, so image uploads can
 * be read by text-only models and searched like any other document.
 */
async function imageToText(file: Express.Multer.File): Promise<string> {
  if (!ocrConfigured()) {
    throw new Error('Image OCR is not configured (SHAVI_OCR_API_KEY / SHAVI_AI_KEY missing)');
  }
  const buffer = await fs.promises.readFile(file.path);
  return ocrImageBuffer(buffer, file.mimetype);
}`,
  'page-aware pdfToText + imageToText',
);

/* 3. data-provider: images count as parser-eligible types */
patch(
  'packages/data-provider/src/file-config.ts',
  `export const documentParserMimeTypes = [
  excelMimeTypes,`,
  `export const documentParserMimeTypes = [
  /* ${MARKER}: images are transcribed by the OCR engine in the document parser. */
  imageMimeTypes,
  excelMimeTypes,`,
  'documentParserMimeTypes (images)',
);

/* 3b. upstream spec encodes the list this deployment extends: images are now parseable */
patch(
  'packages/data-provider/src/file-config.spec.ts',
  `    'application/vnd.oasis.opendocument.text',
  ])('matches natively parseable type: %s', (mimeType) => {`,
  `    'application/vnd.oasis.opendocument.text',
    /* ${MARKER}: images are transcribed by the OCR engine, so they are parser types here. */
    'image/png',
  ])('matches natively parseable type: %s', (mimeType) => {`,
  'file-config.spec: image matches',
);

patch(
  'packages/data-provider/src/file-config.spec.ts',
  `    'text/plain',
    'image/png',
  ])('does not match OCR-only or unsupported type: %s', (mimeType) => {`,
  `    'text/plain',
  ])('does not match OCR-only or unsupported type: %s', (mimeType) => {`,
  'file-config.spec: image no longer unsupported',
);

/* 4. canvas is what turns pdfjs page pixels into a PNG */
const hasCanvas = fs
  .readdirSync(path.join(LC, 'node_modules'))
  .some((name) => name === 'canvas');
if (hasCanvas) {
  edits.push('canvas: present');
} else {
  console.log('installing canvas…');
  execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', 'canvas'], {
    cwd: LC,
    stdio: 'inherit',
  });
  edits.push('canvas: installed');
}

/* 5. rebuild the workspaces the API server loads from dist */
for (const script of ['build:data-provider', 'build:api']) {
  console.log(`building ${script}…`);
  execFileSync('npm', ['run', script], { cwd: LC, stdio: 'inherit' });
  edits.push(`${script}: built`);
}

console.log(edits.map((line) => `  ${line}`).join('\n'));
console.log('restart the backend to load it: bash tools/start-librechat.sh --bg');
