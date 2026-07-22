export const MASTER_CODE_MAX = 64;
export const MASTER_NAME_MAX = 180;
export const MASTER_DESCRIPTION_MAX = 1000;
export const MASTER_SHORT_TEXT_MAX = 160;
export const MASTER_PROCESS_TYPE_MAX = 80;
export const MASTER_SORT_MAX = 999;
export const MASTER_RANK_MAX = 99;
export const MASTER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
export const MASTER_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export interface MasterTextInput {
  code?: unknown;
  nameEn?: unknown;
  nameAr?: unknown;
  description?: unknown;
}

export interface MasterTextOptions {
  requireCode?: boolean;
  requireNames?: boolean;
  allowCode?: boolean;
  entityLabel?: string;
}

export function trimOrNull(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function trimRecord<T extends Record<string, unknown>>(data: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    next[key] = trimOrNull(value);
  }
  return next as T;
}

export function validateMasterText(
  input: MasterTextInput,
  options: MasterTextOptions = {},
): string[] {
  const errors: string[] = [];
  const entity = options.entityLabel ?? 'Record';
  const requireCode = options.requireCode ?? true;
  const requireNames = options.requireNames ?? true;
  const allowCode = options.allowCode ?? true;

  if ('code' in input) {
    if (!allowCode) {
      errors.push(`${entity} code is immutable after creation`);
    } else if (typeof input.code !== 'string') {
      errors.push(`${entity} code must be text`);
    } else if (!input.code.trim()) {
      if (requireCode) errors.push(`${entity} code is required`);
    } else if (input.code.trim().length > MASTER_CODE_MAX) {
      errors.push(`${entity} code must be ${MASTER_CODE_MAX} characters or fewer`);
    } else if (!MASTER_CODE_PATTERN.test(input.code.trim())) {
      errors.push(`${entity} code must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens`);
    }
  } else if (requireCode) {
    errors.push(`${entity} code is required`);
  }

  for (const [key, label] of [
    ['nameEn', 'English name'],
    ['nameAr', 'Arabic name'],
  ] as const) {
    if (!(key in input)) {
      if (requireNames) errors.push(`${label} is required`);
      continue;
    }
    const value = input[key];
    if (typeof value !== 'string') {
      errors.push(`${label} must be text`);
    } else if (!value.trim()) {
      if (requireNames) errors.push(`${label} is required`);
    } else if (value.trim().length > MASTER_NAME_MAX) {
      errors.push(`${label} must be ${MASTER_NAME_MAX} characters or fewer`);
    }
  }

  if ('description' in input && input.description !== null && input.description !== undefined) {
    if (typeof input.description !== 'string') {
      errors.push('Description must be text');
    } else if (input.description.trim().length > MASTER_DESCRIPTION_MAX) {
      errors.push(`Description must be ${MASTER_DESCRIPTION_MAX} characters or fewer`);
    }
  }

  return errors;
}

export function assertUniqueRoleResponsibility(
  items: { roleTypeId: string; responsibility?: string }[],
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.roleTypeId) continue;
    if (seen.has(item.roleTypeId)) {
      errors.push('Each role type can appear only once in a RACI template');
      break;
    }
    seen.add(item.roleTypeId);
  }
  return errors;
}
