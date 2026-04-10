import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const FONT_SIZE = 11;
const LINE_HEIGHT = 16;
const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2;

export async function buildResearchPdf(title: string, markdown: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const writeLine = (text: string, options?: { bold?: boolean; size?: number }): void => {
    const size = options?.size ?? FONT_SIZE;
    const selectedFont = options?.bold ? bold : font;
    const wrapped = wrapText(text, selectedFont, size, MAX_WIDTH);
    for (const line of wrapped) {
      if (y < MARGIN + LINE_HEIGHT) {
        page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, {
        x: MARGIN,
        y,
        size,
        font: selectedFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= options?.size ? LINE_HEIGHT + 2 : LINE_HEIGHT;
    }
  };

  writeLine(sanitizePdfText(title), { bold: true, size: 18 });
  y -= 8;
  for (const rawLine of markdown.split('\n')) {
    const line = sanitizePdfText(rawLine.replace(/\r/g, '')).trimEnd();
    if (!line.trim()) {
      y -= LINE_HEIGHT / 2;
      continue;
    }
    if (line.startsWith('# ')) {
      writeLine(line.replace(/^#\s+/, ''), { bold: true, size: 16 });
      y -= 2;
      continue;
    }
    if (line.startsWith('## ')) {
      writeLine(line.replace(/^##\s+/, ''), { bold: true, size: 14 });
      y -= 2;
      continue;
    }
    writeLine(stripMarkdown(line));
  }

  return Buffer.from(await pdf.save());
}

function wrapText(text: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function stripMarkdown(value: string): string {
  return value
    .replace(/^[-*]\s+/, '• ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function sanitizePdfText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ');
}
