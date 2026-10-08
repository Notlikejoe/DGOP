/// <reference lib="es2022.intl" />
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import bidiFactory from 'bidi-js';

export type ReportFormat = 'json' | 'csv' | 'pdf';

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportRow {
  [key: string]: string | number | boolean | null;
}

export interface ReportResult {
  id: string;
  title: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: Record<string, string | number | boolean | null>;
}

export interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  tower: string;
  requiredAnyPermissions: string[];
  supportedFormats: ReportFormat[];
  filters: { key: string; label: string; type: 'date' | 'text' | 'select'; options?: string[] }[];
  scheduledPlaceholder: boolean;
}

function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@\t\r\n]|\s+[=+\-@]/u.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? neutralizeSpreadsheetFormula(value) : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(result: ReportResult): string {
  const header = result.columns.map((column) => csvCell(column.label)).join(',');
  const rows = result.rows.map((row) =>
    result.columns.map((column) => csvCell(row[column.key])).join(','),
  );
  return [header, ...rows].join('\r\n');
}

/** Complete, wrapping, multi-page PDF with an embedded EN/AR font. */
export async function toSimplePdf(result: ReportResult): Promise<Buffer> {
  const fontPath = resolve(__dirname, '../resources/fonts/NotoSansArabic.ttf');
  const font = readFileSync(fontPath);
  if (createHash('sha256').update(font).digest('hex') !== '63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e') throw new Error('Report font checksum mismatch');
  const document = new PDFDocument({ size: 'A4', margin: 42, compress: false, info: { Title: result.title, Subject: 'Complete DGOP report: ' + result.rows.length + ' rows' } });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((done, fail) => {
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => done(Buffer.concat(chunks)));
    document.on('error', fail);
  });
  const bidi = bidiFactory();
  document.font(font);
  // Shape each logical direction run as a whole. PDFKit's word wrapper places
  // Arabic words left-to-right; Unicode bidi ordering must precede positioning.
  const runs = (line: string, direction?: 'ltr' | 'rtl') => {
    const embedding = bidi.getEmbeddingLevels(line, direction);
    const order = bidi.getReorderedIndices(line, embedding);
    const chunks: string[] = [];
    for (let start = 0; start < order.length;) {
      const first = order[start], level = embedding.levels[first], step = level % 2 ? -1 : 1;
      let end = start + 1;
      while (end < order.length && embedding.levels[order[end]] === level && order[end] === order[end - 1] + step) end++;
      const low = Math.min(first, order[end - 1]), high = Math.max(first, order[end - 1]);
      chunks.push(line.slice(low, high + 1));
      start = end;
    }
    return { chunks, rtl: (embedding.paragraphs[0]?.level ?? 0) % 2 === 1 };
  };
  const width = document.page.width - document.page.margins.left - document.page.margins.right;
  const measureRun = (chunk: string) => document.widthOfString(chunk, { features: [] });
  const measure = (line: string, direction?: 'ltr' | 'rtl') => runs(line, direction).chunks.reduce((sum, chunk) => sum + measureRun(chunk), 0);
  const paragraph = (text: string, size = 10) => {
    document.fontSize(size);
    const height = Math.max(size * 1.7, document.currentLineHeight(true));
    const draw = (line: string, direction: 'ltr' | 'rtl') => {
      if (document.y + height > document.page.height - document.page.margins.bottom) document.addPage();
      const y = document.y, { chunks, rtl } = runs(line, direction);
      let x = document.page.margins.left + (rtl ? Math.max(0, width - measure(line, direction)) : 0);
      document.markContent('Span', { actual: line });
      for (const chunk of chunks) { document.text(chunk, x, y, { lineBreak: false, features: [] }); x += measureRun(chunk); }
      document.endMarkedContent();
      document.x = document.page.margins.left;
      document.y = y + height;
    };
    for (const sourceLine of text.split(/\r?\n/)) {
      const direction = runs(sourceLine).rtl ? 'rtl' : 'ltr';
      let line = '';
      for (const word of sourceLine.split(/\s+/u).filter(Boolean)) {
        const candidate = line ? line + ' ' + word : word;
        if (measure(candidate, direction) <= width) { line = candidate; continue; }
        if (line) draw(line, direction);
        line = '';
        // Long identifiers must also wrap without losing any characters.
        for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)) {
          if (line && measure(line + segment, direction) > width) { draw(line, direction); line = ''; }
          line += segment;
        }
      }
      draw(line, direction);
    }
  };
  paragraph(result.title, 16);
  paragraph('Generated: ' + result.generatedAt, 9);
  paragraph('Complete rows: ' + result.rows.length, 9);
  for (const [key, value] of Object.entries(result.summary)) paragraph(key + ': ' + (value ?? '-'), 9);
  document.moveDown();
  for (let index = 0; index < result.rows.length; index++) {
    paragraph('Record ' + (index + 1));
    for (const column of result.columns) {
      paragraph(column.label + ':', 8);
      const value = String(result.rows[index][column.key] ?? '-');
      paragraph(value);
    }
    document.moveDown(0.5);
  }
  // The companion CSV preserves exact values for downstream reconciliation.
  document.file(Buffer.from(toCsv(result), 'utf8'), { name: result.id + '.csv', description: 'Complete machine-readable report rows' });
  // PDFKit 0.20.2 emits invalid empty ToUnicode entries for fontkit's Arabic
  // decoration glyphs. Map those glyphs to an invisible separator. ActualText
  // and the UTF-8 attachment retain the exact logical text for accessibility.
  const embedded = document as unknown as { _fontFamilies: Record<string, { unicode?: number[][] }> };
  for (const item of Object.values(embedded._fontFamilies)) if (item.unicode) item.unicode = item.unicode.map((points) => points.length ? points : [0x200b]);
  document.end();
  return complete;
}

export function filterDefinitions(
  definitions: ReportDefinition[],
  granted: string[],
  hasPermission: (granted: string[], permission: string) => boolean,
): ReportDefinition[] {
  return definitions.filter((definition) =>
    definition.requiredAnyPermissions.some((permission) => hasPermission(granted, permission)),
  );
}
