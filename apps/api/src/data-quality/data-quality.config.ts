import {
  DQ_DIMENSIONS,
  DQ_PRIORITIES,
  DQ_SEVERITIES,
  DQ_STATUSES,
} from './data-quality.dto';

export const DATA_QUALITY_IMPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const DATA_QUALITY_IMPORT_MAX_FILE_SIZE_LABEL = '10 MB';
export const DATA_QUALITY_IMPORT_EXTENSIONS = ['.csv'] as const;
export const DATA_QUALITY_IMPORT_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
] as const;
const GENERIC_UPLOAD_MIME_TYPES = new Set(['', 'application/octet-stream']);
export const DATA_QUALITY_IMPORT_COLUMNS = [
  'code',
  'title',
  'description',
  'severity',
  'priority',
  'dimension',
  'assetCode',
  'dueDate',
] as const;
export const DATA_QUALITY_IMPORT_REQUIRED_COLUMNS = ['title'] as const;
export const DATA_QUALITY_IMPORT_DEFAULTS = {
  source: 'csv',
  severity: 'medium',
  priority: 'P3',
  dimension: 'completeness',
} as const;
export const DATA_QUALITY_IMPORT_ROW_KEYS = {
  code: 'code',
  title: 'title',
  description: 'description',
  severity: 'severity',
  priority: 'priority',
  dimension: 'dimension',
  assetCode: 'assetcode',
  dueDate: 'duedate',
} as const;
export const DATA_QUALITY_IMPORT_API_MESSAGES = {
  fileRequired: 'CSV file is required',
  unsupportedFile: 'Only CSV files are supported',
  invalidText: 'CSV file must be UTF-8 text',
  emptyCsv: 'CSV has no data rows',
} as const;
export const DATA_QUALITY_IMPORT_SAMPLE_CSV = `title,description,severity,priority,dimension,assetCode,dueDate
Missing supplier tax number,Required tax number is empty for a subset of supplier invoices,high,P2,completeness,AST-FIN-INVOICES,`;
export const DATA_QUALITY_PROFILE_SAMPLE_CSV = `patient_id,national_id,episode_date,amount,status
P-001,1234567890,2026-01-01,120.5,approved
P-002,,2026-01-02,140.0,approved
P-003,1234567890,2099-01-01,999999,pending
P-004,bad-id,2026-01-04,130.0,approved`;

export type DataQualityImportErrorCode =
  | 'missing_title'
  | 'asset_unavailable'
  | 'row_rejected';

export interface DataQualityImportRowError {
  row: number;
  code: DataQualityImportErrorCode;
  params?: Record<string, string>;
}

export function dataQualityImportConfig() {
  return {
    maxFileSizeBytes: DATA_QUALITY_IMPORT_MAX_FILE_SIZE_BYTES,
    maxFileSizeLabel: DATA_QUALITY_IMPORT_MAX_FILE_SIZE_LABEL,
    acceptedExtensions: [...DATA_QUALITY_IMPORT_EXTENSIONS],
    acceptedMimeTypes: [...DATA_QUALITY_IMPORT_MIME_TYPES],
    columns: [...DATA_QUALITY_IMPORT_COLUMNS],
    requiredColumns: [...DATA_QUALITY_IMPORT_REQUIRED_COLUMNS],
    defaults: DATA_QUALITY_IMPORT_DEFAULTS,
    sampleCsv: DATA_QUALITY_IMPORT_SAMPLE_CSV,
  };
}

export function dataQualityProfileConfig() {
  return {
    maxFileSizeBytes: DATA_QUALITY_IMPORT_MAX_FILE_SIZE_BYTES,
    maxFileSizeLabel: DATA_QUALITY_IMPORT_MAX_FILE_SIZE_LABEL,
    acceptedExtensions: [...DATA_QUALITY_IMPORT_EXTENSIONS],
    acceptedMimeTypes: [...DATA_QUALITY_IMPORT_MIME_TYPES],
    sampleCsv: DATA_QUALITY_PROFILE_SAMPLE_CSV,
  };
}

export function dataQualityPageConfig() {
  return {
    statuses: [...DQ_STATUSES],
    severities: [...DQ_SEVERITIES],
    priorities: [...DQ_PRIORITIES],
    dimensions: [...DQ_DIMENSIONS],
    defaults: {
      severity: DATA_QUALITY_IMPORT_DEFAULTS.severity,
      priority: DATA_QUALITY_IMPORT_DEFAULTS.priority,
      dimension: DATA_QUALITY_IMPORT_DEFAULTS.dimension,
    },
    import: dataQualityImportConfig(),
    profiling: dataQualityProfileConfig(),
  };
}

export function isAcceptedDataQualityImportFile(originalName = '', mimeType = ''): boolean {
  const lowerName = originalName.toLowerCase();
  const hasCsvExtension = DATA_QUALITY_IMPORT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  const normalizedMime = mimeType.toLowerCase().trim();
  const hasAcceptedMime =
    DATA_QUALITY_IMPORT_MIME_TYPES.includes(normalizedMime as (typeof DATA_QUALITY_IMPORT_MIME_TYPES)[number]) ||
    GENERIC_UPLOAD_MIME_TYPES.has(normalizedMime);
  return hasCsvExtension && hasAcceptedMime;
}

export function isSafeDataQualityImportContent(buffer: Buffer): boolean {
  if (!buffer.length) return true;
  if (buffer.includes(0)) return false;
  return !buffer.toString('utf8').includes('\uFFFD');
}
