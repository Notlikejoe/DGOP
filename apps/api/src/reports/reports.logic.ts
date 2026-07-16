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

function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
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

function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function toSimplePdf(result: ReportResult): Buffer {
  const lines = [
    result.title,
    `Generated: ${result.generatedAt}`,
    ...Object.entries(result.summary).map(([key, value]) => `${key}: ${value ?? '-'}`),
    '',
    result.columns.map((column) => column.label).join(' | '),
    ...result.rows.slice(0, 40).map((row) => result.columns.map((column) => row[column.key] ?? '-').join(' | ')),
  ].slice(0, 48);
  const content = [
    'BT',
    '/F1 10 Tf',
    '40 780 Td',
    ...lines.flatMap((line, index) => [
      index === 0 ? '/F1 14 Tf' : '/F1 10 Tf',
      `(${pdfEscape(String(line).slice(0, 120))}) Tj`,
      '0 -16 Td',
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(content, 'utf8')} >> stream\n${content}\nendstream endobj`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${object}\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
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
