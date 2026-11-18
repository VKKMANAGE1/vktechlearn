/**
 * SHAVI OCR — page-level text recognition for scanned PDFs and images.
 *
 * LibreChat v0.8.9 ships no OCR engine of its own: its `mistral_ocr` strategies need a
 * Mistral OCR key and its built-in document parser only reads a PDF's text layer, so a
 * scanned page comes back empty. This module fills that gap with the vision endpoint we
 * already pay for (NVIDIA NIM, OpenAI-compatible) and renders each scanned page to a PNG
 * in-process, so no Docker / Tesseract / LibreOffice install is required.
 *
 * Configuration comes from the environment only, never from a file:
 *   SHAVI_OCR_API_KEY   key for the vision endpoint (falls back to SHAVI_AI_KEY)
 *   SHAVI_OCR_BASE_URL  default https://integrate.api.nvidia.com/v1
 *   SHAVI_OCR_MODEL     default nvidia/nemotron-3.5-super-vl-120b-a12b
 *   SHAVI_OCR_MAX_PAGES default 12 pages OCR'd per document
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

/** A page whose text layer is shorter than this is treated as scanned. */
export const MIN_PAGE_TEXT_CHARS = 24;
const OCR_TIMEOUT_MS = 180_000;

export const OCR_PROMPT = [
  'Transcribe ALL text in this page image exactly as it appears.',
  'Keep the original language and script: Hindi stays Devanagari, English stays English.',
  'Keep line order and numbers exactly as printed; never correct or summarise.',
  'Render every table as a GitHub markdown pipe table, keeping every row and cell value.',
  'Output only the transcription. If the page has no text, output exactly: (no text)',
].join(' ');

export function ocrConfigured(): boolean {
  return Boolean(process.env.SHAVI_OCR_API_KEY || process.env.SHAVI_AI_KEY);
}

export function ocrMaxPages(): number {
  const raw = Number(process.env.SHAVI_OCR_MAX_PAGES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12;
}

function ocrEndpoint(): { url: string; key: string; model: string } {
  const base = (process.env.SHAVI_OCR_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(
    /\/$/,
    '',
  );
  return {
    url: `${base}/chat/completions`,
    key: process.env.SHAVI_OCR_API_KEY || process.env.SHAVI_AI_KEY || '',
    model: process.env.SHAVI_OCR_MODEL || 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  };
}

/** Runs one vision completion over an image and returns the transcribed text. */
export async function ocrImageBuffer(buffer: Buffer, mimeType = 'image/png'): Promise<string> {
  if (!ocrConfigured()) {
    throw new Error('OCR is not configured: set SHAVI_OCR_API_KEY or SHAVI_AI_KEY');
  }
  const { url, key, model } = ocrEndpoint();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OCR request failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = payload.choices?.[0]?.message?.content ?? '';
  if (text.trim() === '(no text)') {
    return '';
  }
  return text.trim();
}

/** Text layer of a PDF page, joined the way the built-in parser does it. */
export function pageText(items: Array<TextItem | { type: string }>): string {
  return items
    .filter((item): item is TextItem => !('type' in item))
    .map((item) => item.str)
    .join(' ')
    .trim();
}

/**
 * Writes a pdfjs image object (kind 1 = 1bpp, 2 = RGB, 3 = RGBA) into a PNG buffer.
 * A scanned PDF page is a single image XObject, so this recovers the page pixels without
 * pdfjs having to paint them — `page.render()` cannot draw pdfjs's decoded images onto a
 * node-canvas context, while `putImageData` needs no image decoding at all.
 */
export async function imageObjectToPng(image: {
  width: number;
  height: number;
  kind: number;
  data: Uint8ClampedArray | Uint8Array;
}): Promise<Buffer> {
  const { createCanvas } = await import('canvas');
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  const rgba = ctx.createImageData(image.width, image.height);
  const pixels = image.width * image.height;

  if (image.kind === 3) {
    rgba.data.set(image.data);
  } else if (image.kind === 2) {
    for (let i = 0; i < pixels; i++) {
      rgba.data[i * 4] = image.data[i * 3];
      rgba.data[i * 4 + 1] = image.data[i * 3 + 1];
      rgba.data[i * 4 + 2] = image.data[i * 3 + 2];
      rgba.data[i * 4 + 3] = 255;
    }
  } else if (image.kind === 1) {
    /* 1 bit per pixel, rows padded to a byte boundary. 0 is black, 1 is white. */
    const rowBytes = Math.ceil(image.width / 8);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const bit = (image.data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const value = bit === 0 ? 0 : 255;
        const offset = (y * image.width + x) * 4;
        rgba.data[offset] = value;
        rgba.data[offset + 1] = value;
        rgba.data[offset + 2] = value;
        rgba.data[offset + 3] = 255;
      }
    }
  } else {
    throw new Error(`Unsupported PDF image kind: ${image.kind}`);
  }

  ctx.putImageData(rgba, 0, 0);
  return canvas.toBuffer('image/png');
}

/**
 * Largest image painted on a PDF page, as a PNG. Returns null when the page has no image
 * (a vector-only page), in which case the caller keeps whatever text it found.
 */
export async function pageImagePng(page: {
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get: (id: string) => unknown };
}): Promise<Buffer | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = (pdfjs as unknown as { OPS: Record<string, number> }).OPS;
  const { fnArray, argsArray } = await page.getOperatorList();
  const imageNames: string[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] === OPS.paintImageXObject) {
      const name = argsArray[i]?.[0];
      if (typeof name === 'string') {
        imageNames.push(name);
      }
    }
  }
  let best: { width: number; height: number; kind: number; data: Uint8ClampedArray } | null = null;
  for (const name of imageNames) {
    const candidate = page.objs.get(name) as typeof best;
    if (!candidate?.data || !candidate.width || !candidate.height) {
      continue;
    }
    if (!best || candidate.width * candidate.height > best.width * best.height) {
      best = candidate;
    }
  }
  if (!best) {
    return null;
  }
  return imageObjectToPng(best);
}
