import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";

export type ExportFormat = "pdf" | "docx" | "xlsx" | "pptx";

const clean = (line: string) =>
  line
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => clean(cell));

function tables(text: string): string[][][] {
  const found: string[][][] = [];
  let current: string[][] = [];
  for (const line of text.split("\n")) {
    if (isTableRow(line)) {
      if (!isDivider(line)) current.push(cells(line));
    } else if (current.length) {
      found.push(current);
      current = [];
    }
  }
  if (current.length) found.push(current);
  return found.filter((table) => table.length > 1);
}

function filename(title: string, format: ExportFormat) {
  const slug = title
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `shavi-ai-${slug || "document"}.${format}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Canvas par seedha text likhkar PDF banate hain — Devanagari bhi theek dikhta hai. */
async function makePdf(text: string, title: string) {
  const width = 1240;
  const height = 1754;
  const margin = 80;
  const lineHeight = 44;
  const font = "28px 'Noto Sans Devanagari', 'Noto Sans', system-ui, sans-serif";
  const maxWidth = width - margin * 2;

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("canvas unavailable");
  measure.font = font;

  const lines: string[] = [];
  const pushWrapped = (raw: string) => {
    const words = raw.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  };

  pushWrapped(title);
  lines.push("");
  for (const raw of text.replace(/```[a-z]*\n?/gi, "").split("\n")) {
    const clean_line = raw.replace(/^#{1,6}\s*/, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]*)`/g, "$1").trimEnd();
    if (!clean_line.trim()) lines.push("");
    else pushWrapped(clean_line);
  }

  const perPage = Math.floor((height - margin * 2) / lineHeight);
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let start = 0, page = 0; start < lines.length; start += perPage, page += 1) {
    const chunk = lines.slice(start, start + perPage);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#111111";
    context.font = font;
    context.textBaseline = "top";
    chunk.forEach((line, index) => {
      const isTitle = page === 0 && index === 0;
      if (isTitle) {
        context.font = "bold 34px 'Noto Sans Devanagari', 'Noto Sans', system-ui, sans-serif";
        context.fillText(line, margin, margin + index * lineHeight, maxWidth);
        context.font = font;
      } else {
        context.fillText(line, margin, margin + index * lineHeight, maxWidth);
      }
    });
    if (page > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, pageWidth, pageHeight);
  }
  pdf.save(filename(title, "pdf"));
}

async function makeDocx(text: string, title: string) {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
  ];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      paragraphs.push(
        new Paragraph({ text: clean(line.replace(/^#{1,3}\s/, "")), heading: HeadingLevel.HEADING_2 }),
      );
    } else if (/^[-*]\s/.test(line)) {
      paragraphs.push(new Paragraph({ text: clean(line.replace(/^[-*]\s/, "")), bullet: { level: 0 } }));
    } else {
      paragraphs.push(new Paragraph({ children: [new TextRun(clean(line))] }));
    }
  }
  const doc = new Document({ sections: [{ children: paragraphs }] });
  download(await Packer.toBlob(doc), filename(title, "docx"));
}

function makeXlsx(text: string, title: string) {
  const workbook = XLSX.utils.book_new();
  const found = tables(text);
  if (found.length) {
    found.slice(0, 5).forEach((table, index) => {
      const sheet = XLSX.utils.aoa_to_sheet(table);
      XLSX.utils.book_append_sheet(workbook, sheet, `तालिका ${index + 1}`.slice(0, 28));
    });
  } else {
    const rows = text.split("\n").map((line) => [clean(line)]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["विवरण"], ...rows]), "सामग्री");
  }
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename(title, "xlsx"));
}

async function makePptx(text: string, title: string) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.title = title;

  const slide = deck.addSlide();
  slide.addText(title, { x: 0.6, y: 2.1, w: 12, h: 1.4, fontSize: 32, bold: true, color: "1B1B2F" });
  slide.addText("Shavi AI · by Vinay Kushwaha", { x: 0.6, y: 3.6, w: 10, h: 0.5, fontSize: 14, color: "6B7280" });

  const blocks = text
    .split(/\n(?=#{1,3}\s)/)
    .map((block) => block.trim())
    .filter(Boolean);
  const groups = blocks.length > 1 ? blocks : text.match(/[\s\S]{1,700}(?:\n|$)/g) || [];

  for (const group of groups.slice(0, 12)) {
    const heading = group.match(/^#{1,3}\s+(.+)$/m)?.[1];
    const body = clean(group.replace(/^#{1,3}\s+.*$/gm, "")).slice(0, 1200);
    const page = deck.addSlide();
    page.addText((heading || title).slice(0, 90), { x: 0.6, y: 0.5, w: 12, h: 0.9, fontSize: 24, bold: true, color: "1B1B2F" });
    page.addText(body || "(खाली)", { x: 0.6, y: 1.5, w: 12, h: 5.3, fontSize: 13, color: "333333", valign: "top" });
  }

  await deck.writeFile({ fileName: filename(title, "pptx") });
}

export async function saveAs(text: string, title: string, format: ExportFormat) {
  if (!text.trim()) throw new Error("दस्तावेज़ खाली है");
  if (format === "pdf") return makePdf(text, title);
  if (format === "docx") return makeDocx(text, title);
  if (format === "xlsx") return makeXlsx(text, title);
  return makePptx(text, title);
}
