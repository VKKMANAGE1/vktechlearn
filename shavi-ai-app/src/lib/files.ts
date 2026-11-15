import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type AttachmentInput = { name: string; type: string; url: string };

export type ParsedFile = {
  label: string;
  text: string;
  images: string[];
  note?: string;
};

const MAX_TEXT = 24000;
const MAX_OCR_PAGES = 6;

/** blob: URL wali image ko chhoti JPEG data URL me badalta hai. */
export async function imageToDataUrl(blobUrl: string, max = 1400): Promise<string> {
  const blob = await (await fetch(blobUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

async function pageToImage(page: pdfjs.PDFPageProxy): Promise<string | null> {
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const rendered = page
    .render({ canvas, viewport })
    .promise.then(() => true)
    .catch((error) => {
      console.warn("shavi-pdf-render", error);
      return false;
    });
  const done = await Promise.race([
    rendered,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15000)),
  ]);
  if (!done) return null;
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function ocr(api: string, images: string[]): Promise<string[]> {
  if (!images.length) return [];
  try {
    const response = await fetch(`${api}/api/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: images.slice(0, MAX_OCR_PAGES) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "OCR नहीं चला");
    return Array.isArray(data.texts) ? data.texts : [];
  } catch {
    return [];
  }
}

async function readPdf(api: string, blobUrl: string, label: string): Promise<ParsedFile> {
  const data = await (await fetch(blobUrl)).arrayBuffer();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: { number: number; text: string }[] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
    pages.push({ number, text });
  }

  const scanned = pages.filter((page) => page.text.length < 40).slice(0, MAX_OCR_PAGES);
  if (scanned.length) {
    const images: string[] = [];
    for (const page of scanned) {
      try {
        const image = await pageToImage(await doc.getPage(page.number));
        if (image) images.push(image);
      } catch {
        /* is page ko chhod dete hain */
      }
    }
    const texts = await ocr(api, images);
    texts.forEach((text, index) => {
      const target = pages.find((page) => page.number === scanned[index]?.number);
      if (target && text.trim()) target.text = text.replace(/\s+/g, " ").trim();
    });
  }

  const body = pages
    .map((page) => `[पेज ${page.number}]\n${page.text || "(खाली पेज)"}`)
    .join("\n\n")
    .slice(0, MAX_TEXT);

  return {
    label: `${label} (${doc.numPages} पेज)`,
    text: `📄 ${label} — ${doc.numPages} पेज${scanned.length ? ", स्कैन पेज OCR से पढ़े गए" : ""}\n\n${body}`,
    images: [],
    note: scanned.length ? `${scanned.length} स्कैन पेज OCR किए गए` : undefined,
  };
}

async function readDocx(blobUrl: string, label: string): Promise<ParsedFile> {
  const buffer = await (await fetch(blobUrl)).arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
  return { label, text: `📄 ${label} (Word दस्तावेज़)\n\n${text}`, images: [] };
}

async function readSheet(blobUrl: string, label: string, isCsv: boolean): Promise<ParsedFile> {
  const buffer = await (await fetch(blobUrl)).arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const parts: string[] = [];
  for (const name of workbook.SheetNames.slice(0, 6)) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const limited = rows.slice(0, 120).map((row) => row.map((cell) => (cell === undefined || cell === null ? "" : String(cell))));
    if (!limited.length) continue;
    const table = limited
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n");
    parts.push(`[शीट: ${name}] — ${rows.length} पंक्तियाँ\n${table}`);
  }
  const text = parts.join("\n\n").slice(0, MAX_TEXT);
  return {
    label,
    text: `📊 ${label} (${isCsv ? "CSV" : "Excel"})\n\n${text}`,
    images: [],
  };
}

async function readPptx(blobUrl: string, label: string): Promise<ParsedFile> {
  const buffer = await (await fetch(blobUrl)).arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)?.[1]) - Number(b.match(/slide(\d+)\.xml/)?.[1]));
  const slides: string[] = [];
  for (const [index, name] of slideNames.entries()) {
    const xml = await zip.files[name].async("string");
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1].replace(/&amp;/g, "&").trim());
    slides.push(`[स्लाइड ${index + 1}]\n${texts.filter(Boolean).join(" · ")}`);
  }
  return {
    label,
    text: `📽️ ${label} (${slideNames.length} स्लाइड)\n\n${slides.join("\n\n").slice(0, MAX_TEXT)}`,
    images: [],
  };
}

export async function readAttachment(api: string, file: AttachmentInput): Promise<ParsedFile> {
  const name = file.name || "file";
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const type = file.type || "";

  if (type.startsWith("image/")) {
    return { label: name, text: "", images: [await imageToDataUrl(file.url)], note: "इमेज मॉडल को भेजी गई" };
  }
  if (type === "application/pdf" || extension === "pdf") return readPdf(api, file.url, name);
  if (type.includes("wordprocessingml") || extension === "docx") return readDocx(file.url, name);
  if (type.includes("spreadsheetml") || type === "text/csv" || extension === "xlsx" || extension === "xls" || extension === "csv") {
    return readSheet(file.url, name, extension === "csv" || type === "text/csv");
  }
  if (type.includes("presentationml") || extension === "pptx") return readPptx(file.url, name);
  if (type.startsWith("text/") || ["txt", "md", "json", "html"].includes(extension)) {
    const raw = await (await fetch(file.url)).text();
    return { label: name, text: `📄 ${name}\n\n${raw.slice(0, MAX_TEXT)}`, images: [] };
  }
  throw new Error(`${name}: यह फ़ॉर्मेट नहीं चलता (PDF, DOCX, XLSX, PPTX, CSV, TXT, इमेज)`);
}

/** Lambe document me se sawal se sabse milte-julte hisse chunta hai. */
export function buildDocumentContext(question: string, docs: ParsedFile[], limit = 14000): string {
  const total = docs.reduce((sum, doc) => sum + doc.text.length, 0);
  if (total <= limit) return docs.map((doc) => doc.text).filter(Boolean).join("\n\n");

  const keywords = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);

  const chunks: { text: string; score: number }[] = [];
  for (const doc of docs) {
    const pieces = doc.text.split(/\n{2,}/).filter((piece) => piece.trim());
    for (const piece of pieces) {
      const haystack = piece.toLowerCase();
      const score = keywords.reduce((sum, word) => (haystack.includes(word) ? sum + 1 : sum), 0);
      chunks.push({ text: piece, score });
    }
  }

  chunks.sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  let used = 0;
  for (const chunk of chunks) {
    if (used + chunk.text.length > limit) continue;
    picked.push(chunk.text);
    used += chunk.text.length;
    if (used > limit * 0.95) break;
  }
  return `(दस्तावेज़ बड़ा है — सवाल से जुड़े हिस्से चुने गए हैं)\n\n${picked.join("\n\n")}`;
}
