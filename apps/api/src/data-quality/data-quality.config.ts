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
  emptyCsv: 'CSV has no data rows',
} as const;
export const DATA_QUALITY_IMPORT_SAMPLE_CSV = `title,description,severity,priority,dimension,assetCode,dueDate
Missing supplier tax number,Required tax number is empty for a subset of supplier invoices,high,P2,completeness,AST-FIN-INVOICES,`;

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
  };
}

export function isAcceptedDataQualityImportFile(originalName = '', mimeType = ''): boolean {
  const lowerName = originalName.toLowerCase();
  return (
    DATA_QUALITY_IMPORT_EXTENSIONS.some((extension) => lowerName.endsWith(extension)) ||
    DATA_QUALITY_IMPORT_MIME_TYPES.includes(mimeType as (typeof DATA_QUALITY_IMPORT_MIME_TYPES)[number])
  );
}
