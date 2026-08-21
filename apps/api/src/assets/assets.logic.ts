export const LIFECYCLE_STATUSES = ['draft', 'active', 'deprecated', 'retired'] as const;
export const OWNER_STATUSES = ['assigned', 'unassigned'] as const;
export const RELATIONSHIP_TYPES = ['derived_from', 'feeds', 'replicates', 'related_to'] as const;
export const DATA_ASSET_TYPES = [
  'dataset',
  'file',
  'document_record',
  'api_data_feed',
  'bi_report_dashboard',
  'ai_data_product',
] as const;
export const V6_LIFECYCLE_STATES = [
  'registered',
  'designed',
  'built',
  'validated',
  'published',
  'operational',
  'deprecated',
  'retired',
] as const;
export const LIFECYCLE_PHASES = ['discover', 'design', 'build', 'operate', 'retire'] as const;
export const DATA_ASSET_SUBTYPES: Record<(typeof DATA_ASSET_TYPES)[number], readonly string[]> = {
  dataset: ['master_dataset', 'transactional_dataset', 'reference_dataset', 'analytical_dataset'],
  file: ['flat_file', 'extract', 'spreadsheet', 'media_file'],
  document_record: ['policy_record', 'case_record', 'contract_record', 'retention_record'],
  api_data_feed: ['rest_api', 'event_stream', 'batch_feed', 'integration_feed'],
  bi_report_dashboard: ['dashboard', 'certified_report', 'self_service_report', 'regulatory_report'],
  ai_data_product: ['model', 'feature_set', 'training_dataset', 'prompt_library'],
};

export const DATA_ASSET_TYPE_DEFINITIONS = DATA_ASSET_TYPES.map((code) => ({
  code,
  nameEn: assetTypeName(code),
  subtypes: DATA_ASSET_SUBTYPES[code],
  lifecycleStates: V6_LIFECYCLE_STATES,
}));

export const ASSET_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
export const ASSET_CODE_MAX = 48;
export const ASSET_NAME_MAX = 180;
export const ASSET_DESCRIPTION_MAX = 1000;
export const ASSET_OWNER_MAX = 160;
export const MIN_PERSONAL_DATA_CLASSIFICATION_RANK = 2;

export interface AssetTextInput {
  code?: unknown;
  nameEn?: unknown;
  nameAr?: unknown;
  description?: unknown;
  ownerName?: unknown;
  lifecycleStatus?: unknown;
  assetType?: unknown;
  assetSubtype?: unknown;
  v6LifecycleState?: unknown;
  lifecyclePhase?: unknown;
  typeMetadataJson?: unknown;
}

export interface AssetCrossFieldInput {
  subjectIds: string[];
  classification?: { rank: number; code?: string | null } | null;
  orgUnitId?: string | null;
  system?: { ownerOrgUnitId?: string | null; code?: string | null } | null;
}

export function normalizeAssetCode(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeAssetTypeInput(value?: string | null): string {
  const normalized = String(value ?? 'dataset').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (normalized === 'document' || normalized === 'record' || normalized === 'document_or_record') return 'document_record';
  if (normalized === 'api' || normalized === 'data_feed' || normalized === 'api_or_data_feed') return 'api_data_feed';
  if (normalized === 'report' || normalized === 'dashboard' || normalized === 'bi_report' || normalized === 'bi_dashboard') {
    return 'bi_report_dashboard';
  }
  if (normalized === 'ai_product' || normalized === 'ai_data' || normalized === 'ai_dataset') return 'ai_data_product';
  return normalized;
}

export function normalizeAssetType(value?: string | null): (typeof DATA_ASSET_TYPES)[number] {
  const normalized = normalizeAssetTypeInput(value);
  return DATA_ASSET_TYPES.includes(normalized as (typeof DATA_ASSET_TYPES)[number])
    ? normalized as (typeof DATA_ASSET_TYPES)[number]
    : 'dataset';
}

export function normalizeAssetSubtype(assetType: string, value?: string | null): string | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (!normalized) return null;
  const type = normalizeAssetType(assetType);
  return DATA_ASSET_SUBTYPES[type].includes(normalized) ? normalized : normalized;
}

export function normalizeOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value as never;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function uniqueIds(ids?: string[] | null): string[] {
  return [...new Set((ids ?? []).filter(Boolean))];
}

export function validateAssetText(
  input: AssetTextInput,
  options: { requireCode: boolean; requireNames: boolean; allowCode: boolean },
): string[] {
  const errors: string[] = [];
  const code = typeof input.code === 'string' ? normalizeAssetCode(input.code) : input.code;

  if (!options.allowCode && code !== undefined) {
    errors.push('Asset code is immutable after creation');
  } else if (code != null && typeof code !== 'string') {
    errors.push('Asset code must be text');
  } else if (options.requireCode && !code) {
    errors.push('Asset code is required');
  } else if (typeof code === 'string') {
    if (code.length > ASSET_CODE_MAX) errors.push(`Asset code must be ${ASSET_CODE_MAX} characters or fewer`);
    if (!ASSET_CODE_PATTERN.test(code)) {
      errors.push('Asset code must use uppercase letters, numbers, and hyphens, starting with a letter');
    }
  }

  const nameEn = typeof input.nameEn === 'string' ? input.nameEn.trim() : input.nameEn;
  const nameAr = typeof input.nameAr === 'string' ? input.nameAr.trim() : input.nameAr;
  if (nameEn != null && typeof nameEn !== 'string') errors.push('English asset name must be text');
  if (nameAr != null && typeof nameAr !== 'string') errors.push('Arabic asset name must be text');
  if (options.requireNames && !nameEn) errors.push('English asset name is required');
  if (options.requireNames && !nameAr) errors.push('Arabic asset name is required');
  if (typeof nameEn === 'string' && nameEn.length > ASSET_NAME_MAX) {
    errors.push(`English asset name must be ${ASSET_NAME_MAX} characters or fewer`);
  }
  if (typeof nameAr === 'string' && nameAr.length > ASSET_NAME_MAX) {
    errors.push(`Arabic asset name must be ${ASSET_NAME_MAX} characters or fewer`);
  }

  const description = normalizeOptionalText(input.description);
  if (description != null && typeof description !== 'string') {
    errors.push('Description must be text');
  }
  if (typeof description === 'string' && description.length > ASSET_DESCRIPTION_MAX) {
    errors.push(`Description must be ${ASSET_DESCRIPTION_MAX} characters or fewer`);
  }

  const ownerName = normalizeOptionalText(input.ownerName);
  if (ownerName != null && typeof ownerName !== 'string') {
    errors.push('Owner name must be text');
  }
  if (typeof ownerName === 'string' && ownerName.length > ASSET_OWNER_MAX) {
    errors.push(`Owner name must be ${ASSET_OWNER_MAX} characters or fewer`);
  }

  if (input.lifecycleStatus != null && typeof input.lifecycleStatus !== 'string') {
    errors.push('Lifecycle status must be text');
  }
  if (
    typeof input.lifecycleStatus === 'string' &&
    !LIFECYCLE_STATUSES.includes(input.lifecycleStatus as (typeof LIFECYCLE_STATUSES)[number])
  ) {
    errors.push('Lifecycle status is not valid');
  }

  if (input.assetType != null && typeof input.assetType !== 'string') {
    errors.push('Asset type must be text');
  }
  if (typeof input.assetType === 'string' && !isKnownAssetTypeInput(input.assetType)) {
    errors.push('Asset type is not valid');
  }

  if (input.assetSubtype != null && typeof input.assetSubtype !== 'string') {
    errors.push('Asset subtype must be text');
  }

  if (input.v6LifecycleState != null && typeof input.v6LifecycleState !== 'string') {
    errors.push('v6 lifecycle state must be text');
  }
  if (
    typeof input.v6LifecycleState === 'string' &&
    !V6_LIFECYCLE_STATES.includes(input.v6LifecycleState as (typeof V6_LIFECYCLE_STATES)[number])
  ) {
    errors.push('v6 lifecycle state is not valid');
  }

  if (input.lifecyclePhase != null && typeof input.lifecyclePhase !== 'string') {
    errors.push('Lifecycle phase must be text');
  }
  if (
    typeof input.lifecyclePhase === 'string' &&
    !LIFECYCLE_PHASES.includes(input.lifecyclePhase as (typeof LIFECYCLE_PHASES)[number])
  ) {
    errors.push('Lifecycle phase is not valid');
  }

  return errors;
}

const ASSET_TYPE_METADATA_FIELDS: Record<(typeof DATA_ASSET_TYPES)[number], readonly string[]> = {
  dataset: ['refreshCadence', 'systemOfRecord', 'qualityTier', 'retentionCode'],
  file: ['storageLocation', 'format', 'transferProtocol', 'retentionCode'],
  document_record: ['recordClass', 'retentionSchedule', 'dispositionRule', 'legalHold'],
  api_data_feed: ['endpointUrl', 'protocol', 'producerSystem', 'consumerCount', 'slaTier'],
  bi_report_dashboard: ['reportTool', 'metricOwner', 'refreshCadence', 'certifiedMetricSet'],
  ai_data_product: ['modelCardUrl', 'modelRiskLevel', 'trainingDataCutoff', 'humanOversightOwner'],
};

const V6_LIFECYCLE_TRANSITIONS: Record<(typeof V6_LIFECYCLE_STATES)[number], readonly string[]> = {
  registered: ['registered', 'designed', 'deprecated', 'retired'],
  designed: ['designed', 'built', 'validated', 'deprecated', 'retired'],
  built: ['built', 'validated', 'published', 'deprecated', 'retired'],
  validated: ['validated', 'published', 'operational', 'deprecated', 'retired'],
  published: ['published', 'operational', 'deprecated', 'retired'],
  operational: ['operational', 'deprecated', 'retired'],
  deprecated: ['deprecated', 'retired'],
  retired: ['retired'],
};

export function validateAssetTypeFields(input: {
  assetType?: string | null;
  assetSubtype?: string | null;
  lifecyclePhase?: string | null;
  v6LifecycleState?: string | null;
  previousV6LifecycleState?: string | null;
  typeMetadataJson?: unknown | null;
}): string[] {
  const errors: string[] = [];
  const assetType = normalizeAssetType(input.assetType);
  const subtype = normalizeAssetSubtype(assetType, input.assetSubtype);
  if (input.assetSubtype && subtype && !DATA_ASSET_SUBTYPES[assetType].includes(subtype)) {
    errors.push(`Asset subtype ${subtype} is not registered for asset type ${assetType}`);
  }
  if (input.typeMetadataJson !== undefined && input.typeMetadataJson !== null) {
    if (typeof input.typeMetadataJson !== 'object' || Array.isArray(input.typeMetadataJson)) {
      errors.push('Asset type metadata must be an object');
    } else {
      const allowed = new Set(ASSET_TYPE_METADATA_FIELDS[assetType]);
      const unsupported = Object.keys(input.typeMetadataJson as Record<string, unknown>).filter((key) => !allowed.has(key));
      if (unsupported.length) {
        errors.push(`Unsupported ${assetType} metadata field(s): ${unsupported.join(', ')}`);
      }
    }
  }
  if (input.previousV6LifecycleState && input.v6LifecycleState) {
    const previous = input.previousV6LifecycleState as (typeof V6_LIFECYCLE_STATES)[number];
    const next = input.v6LifecycleState as (typeof V6_LIFECYCLE_STATES)[number];
    if (V6_LIFECYCLE_STATES.includes(previous) && V6_LIFECYCLE_STATES.includes(next) && !V6_LIFECYCLE_TRANSITIONS[previous].includes(next)) {
      errors.push(`Invalid v6 lifecycle transition from ${previous} to ${next}`);
    }
  }
  if (input.lifecyclePhase === 'retire' && input.v6LifecycleState && !['deprecated', 'retired'].includes(input.v6LifecycleState)) {
    errors.push('Retire phase requires a deprecated or retired v6 lifecycle state');
  }
  if (input.v6LifecycleState === 'retired' && input.lifecyclePhase && input.lifecyclePhase !== 'retire') {
    errors.push('Retired assets must use the retire lifecycle phase');
  }
  return errors;
}

export function assetTypePanel(assetTypeValue?: string | null) {
  const assetType = normalizeAssetType(assetTypeValue);
  const panelByType: Record<(typeof DATA_ASSET_TYPES)[number], { code: string; title: string; emptyState: string; expectedEvidence: string[] }> = {
    dataset: {
      code: 'dataset',
      title: 'Dataset governance panel',
      emptyState: 'Register classification, owner, data quality rules, lineage, and retention evidence.',
      expectedEvidence: ['classification', 'owner', 'quality_rules', 'retention'],
    },
    file: {
      code: 'file',
      title: 'File governance panel',
      emptyState: 'Register storage location, classification, owner, retention, and transfer evidence.',
      expectedEvidence: ['storage_location', 'classification', 'owner', 'retention'],
    },
    document_record: {
      code: 'document_record',
      title: 'Document and record governance panel',
      emptyState: 'Register record owner, retention schedule, disposition rule, and classification evidence.',
      expectedEvidence: ['record_owner', 'retention', 'disposition', 'classification'],
    },
    api_data_feed: {
      code: 'api_data_feed',
      title: 'API and data feed governance panel',
      emptyState: 'Register interface contract, consumer registry, SLA, owner, and monitoring evidence.',
      expectedEvidence: ['contract', 'consumer_registry', 'sla', 'monitoring'],
    },
    bi_report_dashboard: {
      code: 'bi_report_dashboard',
      title: 'BI report and dashboard governance panel',
      emptyState: 'Register metric definitions, certification, owner, refresh SLA, and audience evidence.',
      expectedEvidence: ['metric_definitions', 'certification', 'owner', 'refresh_sla'],
    },
    ai_data_product: {
      code: 'ai_data_product',
      title: 'AI data product governance panel',
      emptyState: 'Register model card, training-data lineage, risk assessment, owner, and human oversight evidence.',
      expectedEvidence: ['model_card', 'training_data_lineage', 'risk_assessment', 'human_oversight'],
    },
  };
  return panelByType[assetType];
}

function assetTypeName(code: (typeof DATA_ASSET_TYPES)[number]): string {
  switch (code) {
    case 'file':
      return 'File';
    case 'document_record':
      return 'Document or Record';
    case 'api_data_feed':
      return 'API or Data Feed';
    case 'bi_report_dashboard':
      return 'BI Report or Dashboard';
    case 'ai_data_product':
      return 'AI Data Product';
    case 'dataset':
    default:
      return 'Dataset';
  }
}

export function isKnownAssetTypeInput(value: string): boolean {
  return DATA_ASSET_TYPES.includes(normalizeAssetTypeInput(value) as (typeof DATA_ASSET_TYPES)[number]);
}

export function validateAssetCrossFields(input: AssetCrossFieldInput): string[] {
  const errors: string[] = [];
  if (input.subjectIds.length > 0) {
    if (!input.classification) {
      errors.push('Assets with data subjects require a classification of Internal or higher');
    } else if (input.classification.rank < MIN_PERSONAL_DATA_CLASSIFICATION_RANK) {
      errors.push('Assets with data subjects cannot be classified as Public');
    }
  }

  if (input.orgUnitId && input.system?.ownerOrgUnitId && input.system.ownerOrgUnitId !== input.orgUnitId) {
    errors.push('Selected system belongs to a different organization unit');
  }

  return errors;
}
