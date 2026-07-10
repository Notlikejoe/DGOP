import { DataAssetCatalogSyncStatus } from '@prisma/client';

export const CATALOG_REQUIRED_FIELDS = ['code', 'nameEn', 'nameAr'] as const;
export const CATALOG_FIELD_MAPPINGS = [
  { target: 'externalId', required: false, headers: ['externalid', 'external_id', 'catalogid', 'catalog_id', 'id'] },
  { target: 'code', required: true, headers: ['code', 'assetcode', 'asset_code'] },
  { target: 'nameEn', required: true, headers: ['nameen', 'name_en', 'name', 'assetname', 'asset_name'] },
  { target: 'nameAr', required: true, headers: ['namear', 'name_ar', 'arabicname', 'arabic_name'] },
  { target: 'description', required: false, headers: ['description', 'desc'] },
  { target: 'lifecycleStatus', required: false, headers: ['lifecyclestatus', 'lifecycle_status', 'status'] },
  { target: 'ownerName', required: false, headers: ['ownername', 'owner_name', 'owner'] },
  { target: 'governanceStatus', required: false, headers: ['governancestatus', 'governance_status'] },
  { target: 'domainCode', required: false, headers: ['domaincode', 'domain_code', 'domain'] },
  { target: 'orgUnitCode', required: false, headers: ['orgunitcode', 'org_unit_code', 'orgunit', 'org_unit'] },
  { target: 'systemCode', required: false, headers: ['systemcode', 'system_code', 'system'] },
  { target: 'capabilityCode', required: false, headers: ['capabilitycode', 'capability_code', 'capability'] },
  { target: 'classificationCode', required: false, headers: ['classificationcode', 'classification_code', 'classification'] },
] as const;

const LIFECYCLE_STATUSES = new Set(['draft', 'active', 'deprecated', 'retired']);

export interface CatalogRowIssue {
  row: number;
  code: 'missing_required' | 'invalid_lifecycle' | 'row_rejected';
  field?: string;
  message: string;
  params?: Record<string, string>;
}

export interface NormalizedCatalogAsset {
  externalId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  lifecycleStatus: string;
  ownerName: string | null;
  governanceStatus: string | null;
  domainCode: string | null;
  orgUnitCode: string | null;
  systemCode: string | null;
  capabilityCode: string | null;
  classificationCode: string | null;
  raw: Record<string, string>;
}

export interface CatalogMappingPreview {
  totalRows: number;
  fields: {
    target: string;
    source: string | null;
    required: boolean;
    status: 'mapped' | 'missing';
  }[];
  sampleRows: Record<string, string | null>[];
  issues: CatalogRowIssue[];
}

function rowValue(row: Record<string, string>, target: string): string {
  const mapping = CATALOG_FIELD_MAPPINGS.find((field) => field.target === target);
  if (!mapping) return '';
  for (const header of mapping.headers) {
    const value = row[header];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

export function normalizeCatalogAssetRow(
  row: Record<string, string>,
  rowNumber: number,
): { asset: NormalizedCatalogAsset | null; issues: CatalogRowIssue[] } {
  const code = rowValue(row, 'code');
  const nameEn = rowValue(row, 'nameEn');
  const nameAr = rowValue(row, 'nameAr');
  const issues: CatalogRowIssue[] = [];
  for (const [field, value] of Object.entries({ code, nameEn, nameAr })) {
    if (!value) {
      issues.push({
        row: rowNumber,
        code: 'missing_required',
        field,
        message: `Missing required catalog field: ${field}`,
        params: { field },
      });
    }
  }
  const lifecycle = rowValue(row, 'lifecycleStatus') || 'active';
  if (lifecycle && !LIFECYCLE_STATUSES.has(lifecycle)) {
    issues.push({
      row: rowNumber,
      code: 'invalid_lifecycle',
      field: 'lifecycleStatus',
      message: `Invalid lifecycle status: ${lifecycle}`,
      params: { value: lifecycle },
    });
  }
  if (issues.length) {
    return { asset: null, issues };
  }
  return {
    asset: {
      externalId: rowValue(row, 'externalId') || code,
      code,
      nameEn,
      nameAr,
      description: rowValue(row, 'description') || null,
      lifecycleStatus: lifecycle,
      ownerName: rowValue(row, 'ownerName') || null,
      governanceStatus: rowValue(row, 'governanceStatus') || null,
      domainCode: rowValue(row, 'domainCode') || null,
      orgUnitCode: rowValue(row, 'orgUnitCode') || null,
      systemCode: rowValue(row, 'systemCode') || null,
      capabilityCode: rowValue(row, 'capabilityCode') || null,
      classificationCode: rowValue(row, 'classificationCode') || null,
      raw: row,
    },
    issues: [],
  };
}

export function catalogMappingPreview(rows: Record<string, string>[], sampleLimit = 5): CatalogMappingPreview {
  const headers = Object.keys(rows[0] ?? {});
  const fields = CATALOG_FIELD_MAPPINGS.map((field) => {
    const source = field.headers.find((header) => headers.includes(header)) ?? null;
    return {
      target: field.target,
      source,
      required: field.required,
      status: source ? ('mapped' as const) : ('missing' as const),
    };
  });
  const sampleRows = rows.slice(0, sampleLimit).map((row, index) => {
    const normalized = normalizeCatalogAssetRow(row, index + 2).asset;
    return {
      externalId: (normalized?.externalId ?? rowValue(row, 'externalId')) || null,
      code: (normalized?.code ?? rowValue(row, 'code')) || null,
      nameEn: (normalized?.nameEn ?? rowValue(row, 'nameEn')) || null,
      nameAr: (normalized?.nameAr ?? rowValue(row, 'nameAr')) || null,
      domainCode: (normalized?.domainCode ?? rowValue(row, 'domainCode')) || null,
      classificationCode: (normalized?.classificationCode ?? rowValue(row, 'classificationCode')) || null,
    };
  });
  const issues = rows
    .slice(0, 20)
    .flatMap((row, index) => normalizeCatalogAssetRow(row, index + 2).issues);
  return { totalRows: rows.length, fields, sampleRows, issues };
}

export function hasBusinessAssetChanges(
  existing: Record<string, unknown> | null,
  next: Record<string, unknown>,
): boolean {
  if (!existing) return true;
  const keys = [
    'code',
    'nameEn',
    'nameAr',
    'description',
    'lifecycleStatus',
    'ownerName',
    'ownerStatus',
    'domainId',
    'orgUnitId',
    'systemId',
    'capabilityId',
    'classificationId',
  ];
  return keys.some((key) => (existing[key] ?? null) !== (next[key] ?? null));
}

export function catalogStatusAfterImport(errorRows: number): DataAssetCatalogSyncStatus {
  return errorRows > 0
    ? DataAssetCatalogSyncStatus.error
    : DataAssetCatalogSyncStatus.synced;
}

export function buildCatalogWritebackPayload(asset: {
  code: string;
  ownerName?: string | null;
  ownerStatus?: string | null;
  lifecycleStatus?: string | null;
  catalogSyncStatus?: string | null;
  domain?: { code: string } | null;
  classification?: { code: string } | null;
}) {
  return {
    assetCode: asset.code,
    certifiedOwner: asset.ownerName ?? null,
    certifiedSteward: asset.ownerStatus === 'assigned' ? asset.ownerName ?? null : null,
    governanceStatus: asset.lifecycleStatus ?? 'draft',
    syncStatus: asset.catalogSyncStatus ?? DataAssetCatalogSyncStatus.not_synced,
    domainCode: asset.domain?.code ?? null,
    classificationCode: asset.classification?.code ?? null,
  };
}

export const MOCK_CATALOG_ROWS: Record<string, string>[] = [
  {
    externalid: 'CAT-CUSTOMER-360',
    code: 'AST-CAT-CUSTOMER360',
    nameen: 'Customer 360 Profile',
    namear: 'Customer 360 Profile',
    description: 'Customer profile mastered in the enterprise catalog.',
    lifecyclestatus: 'active',
    ownername: 'Catalog Owner',
    domaincode: 'finance',
    classificationcode: 'restricted',
  },
  {
    externalid: 'CAT-SUPPLIER-RISK',
    code: 'AST-CAT-SUPPLIER-RISK',
    nameen: 'Supplier Risk Register',
    namear: 'Supplier Risk Register',
    description: 'Supplier risk scoring data received through the mock catalog adapter.',
    lifecyclestatus: 'active',
    ownername: 'Procurement Steward',
    domaincode: 'finance',
    classificationcode: 'internal',
  },
];
