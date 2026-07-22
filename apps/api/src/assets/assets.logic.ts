export const LIFECYCLE_STATUSES = ['draft', 'active', 'deprecated', 'retired'] as const;
export const OWNER_STATUSES = ['assigned', 'unassigned'] as const;
export const RELATIONSHIP_TYPES = ['derived_from', 'feeds', 'replicates', 'related_to'] as const;

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

  return errors;
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
