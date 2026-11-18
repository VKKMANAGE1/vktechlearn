#!/usr/bin/env node
/**
 * M06 — file support for the SHAVI AI deployment on top of LibreChat v0.8.9.
 *
 * LibreChat's built-in document parser (the only extractor available without a RAG API)
 * handles PDF, DOCX, XLS/XLSX and ODT/ODS. Two formats from the brief are missing:
 *
 *   .pptx  PowerPoint — slides are XML inside a ZIP, read here with yauzl (already a dep)
 *   .doc   Word 97-2003 binary — read with `word-extractor` (pure JS, no LibreOffice)
 *
 * The script also teaches the upload router that these two types have a text path, so a
 * PDF/PPTX/DOC gets extracted instead of being handed to the provider as raw bytes.
 *
 * Idempotent: re-running it is a no-op on already patched files. It only edits the
 * gitignored LibreChat clone, never the tracked site files.
 *
 *   node librechat-file-support/apply-file-support.mjs
 *   bash tools/start-librechat.sh --bg      # restart to load the rebuild
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LC = path.join(ROOT, 'librechat');
const MARKER = 'SHAVI-FILE-SUPPORT';

if (!fs.existsSync(LC)) {
  console.error('librechat/ clone not found — run: bash tools/setup-librechat.sh');
  process.exit(1);
}

const edits = [];
const patch = (rel, find, replace, label) => {
  const file = path.join(LC, rel);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(replace) || source.includes(MARKER)) {
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

/* 1. data-provider: the built-in parser handles two more types, and both have a text path. */
patch(
  'packages/data-provider/src/file-config.ts',
  `  /^application\\/vnd\\.oasis\\.opendocument\\.text$/,
];`,
  `  /^application\\/vnd\\.oasis\\.opendocument\\.text$/,
  /* ${MARKER}: PowerPoint + legacy Word 97-2003 binary are parsed by our patch below. */
  /^application\\/vnd\\.openxmlformats-officedocument\\.presentationml\\.presentation$/,
  /^application\\/msword$/,
];`,
  'documentParserMimeTypes',
);

patch(
  'packages/data-provider/src/resolve-llm-delivery-path.ts',
  `  /^application\\/vnd\\.oasis\\.opendocument\\.(text|spreadsheet)$/,`,
  `  /^application\\/vnd\\.oasis\\.opendocument\\.(text|spreadsheet)$/,
  /* ${MARKER}: presentations and legacy .doc have a parser, so they can become text. */
  /^application\\/vnd\\.openxmlformats-officedocument\\.presentationml\\.presentation$/,
  /^application\\/msword$/,`,
  'TEXT_RECOVERABLE_MIME_TYPES',
);

/* 2. packages/api: the two parsers themselves. */
patch(
  'packages/api/src/files/documents/crud.ts',
  `  if (mimetype === 'application/vnd.oasis.opendocument.text') {
    return odtToText;
  }
  return undefined;`,
  `  if (mimetype === 'application/vnd.oasis.opendocument.text') {
    return odtToText;
  }
  if (
    mimetype ===
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return pptxToText;
  }
  if (mimetype === 'application/msword') {
    return legacyWordDocToText;
  }
  return undefined;`,
  'getParserForMimeType',
);

patch(
  'packages/api/src/files/documents/crud.ts',
  `/**
 * Parses OpenDocument Text (.odt)`,
  `const PPTX_MAX_DECOMPRESSED_SIZE = 50 * megabyte;

/**
 * ${MARKER}: Parses PowerPoint (.pptx) by reading every ppt/slides/slideN.xml out of the
 * ZIP and collecting its <a:t> text runs, one block per slide. Speaker notes and images
 * are not included.
 */
async function pptxToText(file: Express.Multer.File): Promise<string> {
  const buffer = await fs.promises.readFile(file.path);
  await assertSafeZipSize(buffer, { name: file.originalname ?? 'pptx' });
  return new Promise((resolve, reject) => {
    yauzl.open(file.path, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        return reject(err);
      }
      if (!zipfile) {
        return reject(new Error('Failed to open PPTX file'));
      }
      const slides = new Map<number, string[]>();
      let settled = false;
      const finish = (error: Error | null, result?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        zipfile.close();
        if (error) {
          reject(error);
        } else {
          resolve(result as string);
        }
      };

      zipfile.on('entry', (entry: yauzl.Entry) => {
        const match = /^ppt\\/slides\\/slide(\\d+)\\.xml$/.exec(entry.fileName);
        if (!match) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) {
            return finish(streamErr);
          }
          if (!readStream) {
            return finish(new Error('Failed to open a PPTX slide stream'));
          }
          let totalBytes = 0;
          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => {
            totalBytes += chunk.byteLength;
            if (totalBytes > PPTX_MAX_DECOMPRESSED_SIZE) {
              readStream.destroy(
                new Error(
                  \`PPTX slide data exceeds the \${PPTX_MAX_DECOMPRESSED_SIZE / megabyte}MB decompressed limit\`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          readStream.on('end', () => {
            const xml = Buffer.concat(chunks).toString('utf8');
            const runs = [...xml.matchAll(/<a:t>([\\s\\S]*?)<\\/a:t>/g)].map((run) =>
              run[1]
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&amp;/g, '&'),
            );
            slides.set(Number(match[1]), runs);
            zipfile.readEntry();
          });
          readStream.on('error', (readErr: Error) => finish(readErr));
        });
      });

      zipfile.on('end', () => {
        const numbers = [...slides.keys()].sort((a, b) => a - b);
        if (numbers.length === 0) {
          return finish(new Error('PPTX file contains no slides'));
        }
        finish(
          null,
          numbers
            .map((number) => \`[Slide \${number}]\\n\${(slides.get(number) ?? []).join('\\n')}\`)
            .join('\\n\\n'),
        );
      });
      zipfile.on('error', (zipErr: Error) => finish(zipErr));
      zipfile.readEntry();
    });
  });
}

/**
 * ${MARKER}: Parses legacy Word 97-2003 (.doc) binary files with word-extractor, which
 * reads the OLE compound document directly (no LibreOffice/antiword on the host).
 */
async function legacyWordDocToText(file: Express.Multer.File): Promise<string> {
  const WordExtractor = (await import('word-extractor')).default;
  const extractor = new WordExtractor();
  const parsed = await extractor.extract(file.path);
  const body = parsed.getBody();
  const headers = [parsed.getHeaders?.(), parsed.getFooters?.()]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  return [body, ...headers].filter((part) => part.trim().length > 0).join('\\n');
}

/**
 * Parses OpenDocument Text (.odt)`,
  'pptx + legacy doc parsers',
);

/* 3. word-extractor lives at the workspace root so both api and packages/api resolve it. */
const hasDep = fs
  .readdirSync(path.join(LC, 'node_modules'))
  .some((name) => name === 'word-extractor');
if (hasDep) {
  edits.push('word-extractor: present');
} else {
  console.log('installing word-extractor…');
  execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', 'word-extractor'], {
    cwd: LC,
    stdio: 'inherit',
  });
  edits.push('word-extractor: installed');
}

/* 4. rebuild the two workspaces the API server loads from dist. */
for (const script of ['build:data-provider', 'build:api']) {
  console.log(`building ${script}…`);
  execFileSync('npm', ['run', script], { cwd: LC, stdio: 'inherit' });
  edits.push(`${script}: built`);
}

console.log(edits.map((line) => `  ${line}`).join('\n'));
console.log('restart the backend to load it: bash tools/start-librechat.sh --bg');
