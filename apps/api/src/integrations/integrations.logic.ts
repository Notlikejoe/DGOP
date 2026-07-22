import { isIP } from 'node:net';
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

export type IntegrationAdapterKey =
  | 'catalog_csv'
  | 'mock_rest'
  | 'webhook_json'
  | 'mock_data_quality'
  | 'mock_dlp'
  | 'mock_open_data'
  | 'mock_foi'
  | 'mock_lms'
  | 'mock_siem'
  | 'mock_iam_sso';

export type IntegrationConnectorKey =
  | 'catalog'
  | 'lineage'
  | 'data_quality'
  | 'dlp'
  | 'pdp'
  | 'ndi'
  | 'risk'
  | 'profiling'
  | 'training'
  | 'open_data'
  | 'foi'
  | 'lms'
  | 'siem'
  | 'iam_sso'
  | 'masking'
  | 'abac';

export interface DefaultIntegrationConnectorDefinition {
  code: string;
  nameEn: string;
  nameAr: string;
  description: string;
  type: IntegrationConnectorKey;
  adapterType: IntegrationAdapterKey;
  defaultEventType: string;
  sourceName: string;
}

const ADAPTERS_BY_CONNECTOR_TYPE: Record<IntegrationConnectorKey, readonly IntegrationAdapterKey[]> = {
  catalog: ['catalog_csv', 'mock_rest', 'webhook_json'],
  lineage: ['webhook_json'],
  data_quality: ['mock_data_quality', 'webhook_json'],
  dlp: ['mock_dlp', 'webhook_json'],
  pdp: ['webhook_json'],
  ndi: ['webhook_json'],
  risk: ['webhook_json'],
  profiling: ['webhook_json'],
  training: ['mock_lms', 'webhook_json'],
  open_data: ['mock_open_data', 'webhook_json'],
  foi: ['mock_foi', 'webhook_json'],
  lms: ['mock_lms', 'webhook_json'],
  siem: ['mock_siem', 'webhook_json'],
  iam_sso: ['mock_iam_sso', 'webhook_json'],
  masking: ['webhook_json'],
  abac: ['webhook_json'],
};

export function compatibleAdaptersForConnectorType(
  connectorType: IntegrationConnectorKey,
): readonly IntegrationAdapterKey[] {
  return ADAPTERS_BY_CONNECTOR_TYPE[connectorType] ?? ['webhook_json'];
}

export function adapterMatchesConnectorType(
  connectorType: IntegrationConnectorKey,
  adapterType: IntegrationAdapterKey,
): boolean {
  return compatibleAdaptersForConnectorType(connectorType).includes(adapterType);
}

export function defaultAdapterForConnectorType(connectorType: IntegrationConnectorKey): IntegrationAdapterKey {
  return connectorType === 'catalog' ? 'catalog_csv' : 'webhook_json';
}

export const DEFAULT_INTEGRATION_CONNECTORS: DefaultIntegrationConnectorDefinition[] = [
  {
    code: 'DQ-MOCK',
    nameEn: 'Data Quality Engine',
    nameAr: 'Data Quality Engine',
    description: 'Receives rule runs, profiling alerts, and data quality score events.',
    type: 'data_quality',
    adapterType: 'mock_data_quality',
    defaultEventType: 'dq.issue.detected',
    sourceName: 'Mock DQ engine',
  },
  {
    code: 'DLP-MOCK',
    nameEn: 'DLP Monitor',
    nameAr: 'DLP Monitor',
    description: 'Receives data loss prevention incidents and policy alerts.',
    type: 'dlp',
    adapterType: 'mock_dlp',
    defaultEventType: 'dlp.incident.opened',
    sourceName: 'Mock DLP monitor',
  },
  {
    code: 'OPEN-DATA-MOCK',
    nameEn: 'Open Data Portal',
    nameAr: 'Open Data Portal',
    description: 'Tracks publication package status, portal acknowledgements, and release errors.',
    type: 'open_data',
    adapterType: 'mock_open_data',
    defaultEventType: 'open_data.package.status',
    sourceName: 'Mock Open Data portal',
  },
  {
    code: 'FOI-MOCK',
    nameEn: 'FOI Channel',
    nameAr: 'FOI Channel',
    description: 'Receives public request events, response due dates, and closure signals.',
    type: 'foi',
    adapterType: 'mock_foi',
    defaultEventType: 'foi.request.received',
    sourceName: 'Mock FOI channel',
  },
  {
    code: 'LMS-MOCK',
    nameEn: 'Awareness LMS',
    nameAr: 'Awareness LMS',
    description: 'Receives training completion and awareness campaign signals.',
    type: 'lms',
    adapterType: 'mock_lms',
    defaultEventType: 'training.completion.updated',
    sourceName: 'Mock LMS',
  },
  {
    code: 'SIEM-MOCK',
    nameEn: 'Security SIEM',
    nameAr: 'Security SIEM',
    description: 'Receives sensitive access, privileged activity, and security monitoring events.',
    type: 'siem',
    adapterType: 'mock_siem',
    defaultEventType: 'security.sensitive_access.detected',
    sourceName: 'Mock SIEM',
  },
  {
    code: 'IAM-SSO-MOCK',
    nameEn: 'IAM and SSO',
    nameAr: 'IAM and SSO',
    description: 'Receives identity, role, and access lifecycle signals from IAM/SSO systems.',
    type: 'iam_sso',
    adapterType: 'mock_iam_sso',
    defaultEventType: 'iam.role.changed',
    sourceName: 'Mock IAM/SSO',
  },
];

export interface IntegrationAdapterProfile {
  adapterType: IntegrationAdapterKey;
  family: string;
  defaultEventType: string;
  supportsRetry: boolean;
  requiredPayloadFields: string[];
}

export type EnterpriseConnectorEndpoint = 'pull' | 'writeback' | 'health';

export interface EnterpriseConnectorConfig {
  baseUrl: string | null;
  pullUrl: string | null;
  writebackUrl: string | null;
  healthUrl: string | null;
  authHeaderName: string | null;
  authHeaderValueEnv: string | null;
  timeoutMs: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
  headers: Record<string, string>;
}

export interface EnterpriseConnectorRuntime {
  mode: 'file' | 'simulated' | 'external_http' | 'webhook_only';
  canPull: boolean;
  canWriteback: boolean;
  canHealthCheck: boolean;
  configuredEndpoints: EnterpriseConnectorEndpoint[];
  timeoutMs: number;
}

const DEFAULT_ENTERPRISE_CONNECTOR_TIMEOUT_MS = 10000;
const MAX_ENTERPRISE_CONNECTOR_TIMEOUT_MS = 30000;
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'proxy-authorization',
]);
const FORBIDDEN_CONNECTOR_HEADER_NAMES = new Set([
  ...SENSITIVE_HEADER_NAMES,
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'expect',
  'te',
  'trailer',
  'proxy-authenticate',
  'proxy-connection',
]);
const PRIVATE_CONNECTOR_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home'];

const ADAPTER_PROFILES: Record<IntegrationAdapterKey, IntegrationAdapterProfile> = {
  catalog_csv: {
    adapterType: 'catalog_csv',
    family: 'catalog',
    defaultEventType: 'catalog.asset.imported',
    supportsRetry: false,
    requiredPayloadFields: ['code'],
  },
  mock_rest: {
    adapterType: 'mock_rest',
    family: 'catalog',
    defaultEventType: 'catalog.asset.imported',
    supportsRetry: true,
    requiredPayloadFields: ['code'],
  },
  webhook_json: {
    adapterType: 'webhook_json',
    family: 'generic',
    defaultEventType: 'integration.event.received',
    supportsRetry: true,
    requiredPayloadFields: [],
  },
  mock_data_quality: {
    adapterType: 'mock_data_quality',
    family: 'data_quality',
    defaultEventType: 'dq.issue.detected',
    supportsRetry: true,
    requiredPayloadFields: ['assetCode'],
  },
  mock_dlp: {
    adapterType: 'mock_dlp',
    family: 'security',
    defaultEventType: 'dlp.incident.opened',
    supportsRetry: true,
    requiredPayloadFields: ['assetCode'],
  },
  mock_open_data: {
    adapterType: 'mock_open_data',
    family: 'transparency',
    defaultEventType: 'open_data.package.status',
    supportsRetry: true,
    requiredPayloadFields: ['packageCode'],
  },
  mock_foi: {
    adapterType: 'mock_foi',
    family: 'transparency',
    defaultEventType: 'foi.request.received',
    supportsRetry: true,
    requiredPayloadFields: ['requestCode'],
  },
  mock_lms: {
    adapterType: 'mock_lms',
    family: 'awareness',
    defaultEventType: 'training.completion.updated',
    supportsRetry: true,
    requiredPayloadFields: ['personEmail'],
  },
  mock_siem: {
    adapterType: 'mock_siem',
    family: 'security',
    defaultEventType: 'security.sensitive_access.detected',
    supportsRetry: true,
    requiredPayloadFields: ['actor'],
  },
  mock_iam_sso: {
    adapterType: 'mock_iam_sso',
    family: 'access',
    defaultEventType: 'iam.role.changed',
    supportsRetry: true,
    requiredPayloadFields: ['subject'],
  },
};

export interface NormalizedIntegrationEvent {
  adapterType: IntegrationAdapterKey;
  family: string;
  eventType: string;
  externalId: string | null;
  subject: string;
  status: string;
  severity: 'warning' | 'error';
  sourceSystem: string | null;
  raw: Record<string, unknown>;
}

export interface IntegrationEventIssue {
  field?: string;
  message: string;
}

export interface IntegrationEventNormalization {
  accepted: boolean;
  normalized: NormalizedIntegrationEvent;
  issues: IntegrationEventIssue[];
}

export function integrationAdapterProfile(adapterType: IntegrationAdapterKey): IntegrationAdapterProfile {
  return ADAPTER_PROFILES[adapterType] ?? ADAPTER_PROFILES.webhook_json;
}

function connectorConfigRecord(configJson: unknown): Record<string, unknown> {
  return configJson && typeof configJson === 'object' && !Array.isArray(configJson)
    ? (configJson as Record<string, unknown>)
    : {};
}

function stringConfig(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanConfig(config: Record<string, unknown>, key: string): boolean {
  return config[key] === true || config[key] === 'true';
}

function timeoutConfig(config: Record<string, unknown>): number {
  const raw = Number(config['timeoutMs'] ?? DEFAULT_ENTERPRISE_CONNECTOR_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_ENTERPRISE_CONNECTOR_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(raw), 1000), MAX_ENTERPRISE_CONNECTOR_TIMEOUT_MS);
}

function safeConnectorHeaders(config: Record<string, unknown>): Record<string, string> {
  const headers = config['headers'];
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    const headerName = key.trim();
    if (!isSafeConnectorHeaderName(headerName)) continue;
    if (typeof value === 'string' && value.trim()) result[headerName] = value.trim();
  }
  return result;
}

export function enterpriseConnectorConfig(configJson: unknown): EnterpriseConnectorConfig {
  const config = connectorConfigRecord(configJson);
  return {
    baseUrl: stringConfig(config, 'baseUrl'),
    pullUrl: stringConfig(config, 'pullUrl') ?? stringConfig(config, 'catalogUrl'),
    writebackUrl: stringConfig(config, 'writebackUrl'),
    healthUrl: stringConfig(config, 'healthUrl'),
    authHeaderName: stringConfig(config, 'authHeaderName'),
    authHeaderValueEnv: stringConfig(config, 'authHeaderValueEnv'),
    timeoutMs: timeoutConfig(config),
    allowInsecureHttp: booleanConfig(config, 'allowInsecureHttp'),
    allowPrivateNetwork: booleanConfig(config, 'allowPrivateNetwork'),
    headers: safeConnectorHeaders(config),
  };
}

export function enterpriseConnectorUrl(
  config: EnterpriseConnectorConfig,
  endpoint: EnterpriseConnectorEndpoint,
): string | null {
  if (endpoint === 'pull') return config.pullUrl ?? config.baseUrl;
  if (endpoint === 'writeback') return config.writebackUrl;
  return config.healthUrl ?? config.baseUrl ?? config.pullUrl ?? config.writebackUrl;
}

export function isSafeConnectorHeaderName(headerName: string): boolean {
  const normalized = headerName.trim().toLowerCase();
  if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/iu.test(normalized)) return false;
  return !FORBIDDEN_CONNECTOR_HEADER_NAMES.has(normalized);
}

function normalizedConnectorHost(hostname: string): string {
  return hostname.trim().replace(/^\[(.*)\]$/u, '$1').toLowerCase();
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const value = host.toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
  if (value.startsWith('ff')) return true;
  if (value.startsWith('2001:db8')) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

export function isPrivateConnectorHost(hostname: string): boolean {
  const host = normalizedConnectorHost(hostname);
  if (!host) return true;
  if (host === 'localhost' || PRIVATE_CONNECTOR_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return isPrivateIpv6(host);
  return false;
}

export function validateEnterpriseConnectorUrl(
  value: string | null,
  options: { allowInsecureHttp?: boolean; allowPrivateNetwork?: boolean } = {},
): string[] {
  if (!value) return ['Missing connector endpoint URL'];
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return ['Invalid connector endpoint URL'];
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) return ['Connector endpoint must use HTTP or HTTPS'];
  if (parsed.protocol === 'http:' && !options.allowInsecureHttp) {
    return ['Connector endpoint must use HTTPS unless insecure HTTP is explicitly enabled'];
  }
  if (isPrivateConnectorHost(parsed.hostname) && !options.allowPrivateNetwork) {
    return ['Private connector endpoint requires explicit private-network allowance'];
  }
  if (parsed.username || parsed.password) return ['Connector endpoint must not include credentials in the URL'];
  return [];
}

export function enterpriseConnectorRuntime(
  adapterType: IntegrationAdapterKey,
  sourceTrust: string | null | undefined,
  configJson: unknown,
): EnterpriseConnectorRuntime {
  const config = enterpriseConnectorConfig(configJson);
  const configuredEndpoints: EnterpriseConnectorEndpoint[] = [];
  if (enterpriseConnectorUrl(config, 'pull')) configuredEndpoints.push('pull');
  if (enterpriseConnectorUrl(config, 'writeback')) configuredEndpoints.push('writeback');
  if (enterpriseConnectorUrl(config, 'health')) configuredEndpoints.push('health');
  const simulated = sourceTrust === 'simulated' || adapterType.startsWith('mock_') || adapterType === 'mock_rest';
  const mode =
    adapterType === 'catalog_csv'
      ? 'file'
      : simulated
        ? 'simulated'
        : configuredEndpoints.length
          ? 'external_http'
          : 'webhook_only';
  return {
    mode,
    canPull: mode === 'external_http' && !!enterpriseConnectorUrl(config, 'pull'),
    canWriteback: mode === 'external_http' && !!enterpriseConnectorUrl(config, 'writeback'),
    canHealthCheck: mode === 'external_http' && !!enterpriseConnectorUrl(config, 'health'),
    configuredEndpoints,
    timeoutMs: config.timeoutMs,
  };
}

function normalizeExternalKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]/g, '');
}

export function catalogRowsFromExternalPayload(payload: unknown): Record<string, string>[] {
  const container = payloadRecord(payload);
  const rows =
    Array.isArray(payload)
      ? payload
      : Array.isArray(container['rows'])
        ? container['rows']
        : Array.isArray(container['assets'])
          ? container['assets']
          : Array.isArray(container['data'])
            ? container['data']
            : Array.isArray(container['items'])
              ? container['items']
              : [];
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        const normalizedKey = normalizeExternalKey(key);
        if (!normalizedKey) continue;
        if (typeof value === 'string') normalized[normalizedKey] = value;
        else if (typeof value === 'number' || typeof value === 'boolean') normalized[normalizedKey] = String(value);
        else if (value == null) normalized[normalizedKey] = '';
      }
      return normalized;
    });
}

function payloadValue(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export function normalizeIntegrationEventPayload(
  adapterType: IntegrationAdapterKey,
  eventType: string | null | undefined,
  payload: unknown,
): IntegrationEventNormalization {
  const profile = integrationAdapterProfile(adapterType);
  const raw = payloadRecord(payload);
  const issues: IntegrationEventIssue[] = [];
  for (const field of profile.requiredPayloadFields) {
    if (!payloadValue(raw, [field])) {
      issues.push({ field, message: `Missing required integration payload field: ${field}` });
    }
  }
  if (raw['forceFail'] === true || raw['valid'] === false) {
    issues.push({ field: 'payload', message: 'Adapter reported that the source payload is not ready to process' });
  }
  const externalId = payloadValue(raw, ['externalEventId', 'eventId', 'id', 'code', 'ticketId', 'requestCode', 'packageCode']);
  const subject =
    payloadValue(raw, ['assetCode', 'packageCode', 'requestCode', 'personEmail', 'actor', 'subject', 'code']) ??
    externalId ??
    'Unspecified subject';
  const severityInput = (payloadValue(raw, ['severity', 'risk', 'priority']) ?? '').toLowerCase();
  const severity = ['critical', 'high', 'error', 'severe'].includes(severityInput) || issues.length > 0 ? 'error' : 'warning';
  const normalized: NormalizedIntegrationEvent = {
    adapterType,
    family: profile.family,
    eventType: eventType?.trim() || profile.defaultEventType,
    externalId,
    subject,
    status: payloadValue(raw, ['status', 'state', 'decision']) ?? 'received',
    severity,
    sourceSystem: payloadValue(raw, ['sourceSystem', 'source', 'system']) ?? null,
    raw,
  };
  return { accepted: issues.length === 0, normalized, issues };
}

export function integrationRetryDelayMinutes(nextAttempt: number): number {
  if (nextAttempt <= 1) return 5;
  if (nextAttempt === 2) return 15;
  return 60;
}

export function nextIntegrationEventStatus(input: {
  accepted: boolean;
  currentAttempts: number;
  maxAttempts: number;
}): {
  attempts: number;
  status: 'succeeded' | 'retry_scheduled' | 'dead_letter';
  delayMinutes: number | null;
} {
  const attempts = input.currentAttempts + 1;
  if (input.accepted) return { attempts, status: 'succeeded', delayMinutes: null };
  if (attempts >= input.maxAttempts) return { attempts, status: 'dead_letter', delayMinutes: null };
  return { attempts, status: 'retry_scheduled', delayMinutes: integrationRetryDelayMinutes(attempts) };
}

export function reconciliationForIntegrationEvent(input: {
  accepted: boolean;
  created?: boolean;
  updated?: boolean;
  issues: IntegrationEventIssue[];
}) {
  const failedRecords = input.accepted ? 0 : Math.max(1, input.issues.length);
  return {
    status: input.accepted ? ('healthy' as const) : ('review' as const),
    totalRecords: 1,
    matchedRecords: input.accepted ? 1 : 0,
    createdRecords: input.created ? 1 : 0,
    updatedRecords: input.updated ? 1 : 0,
    failedRecords,
    orphanedRecords: 0,
    missingRecords: 0,
  };
}
