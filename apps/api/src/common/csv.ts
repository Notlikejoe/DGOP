/**
 * Minimal RFC-4180-ish CSV parser: supports quoted fields, escaped quotes ("")
 * and CRLF/LF line endings. Returns rows keyed by lower-cased header names.
 *
 * Shared by the data-asset and NDI specification importers.
 */
export function parseCsv(input: string): Record<string, string>[] {
  const text = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.some((c) => c.trim() !== '')) records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    if (record.some((c) => c.trim() !== '')) records.push(record);
  }
  if (records.length === 0) return [];
  const headers = records[0].map((h) => h.trim().toLowerCase());
  return records.slice(1).map((cols) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = cols[idx] ?? ''));
    return obj;
  });
}
