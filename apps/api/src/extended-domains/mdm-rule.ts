import { BadRequestException } from '@nestjs/common';

export const MDM_FACTOR_KEYS = ['code', 'name', 'domain', 'system_catalog', 'business_context', 'subjects', 'classification_owner'] as const;
const BLOCK_FIELDS = ['domainId', 'systemId', 'catalogSource', 'classificationId'] as const;
export interface MdmRuleConfig {
  blockingFields: string[];
  weights?: Record<string, number>;
  survivorship: 'higher_trust' | 'source' | 'candidate';
}

/** Unsupported configuration must fail visibly instead of being silently ignored. */
export function parseMdmRule(blocking: unknown, weights: unknown, survivorship: unknown): MdmRuleConfig {
  const object = (value: unknown, label: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${label} must be an object`);
    return value as Record<string, unknown>;
  };
  const block = object(blocking, 'Blocking rule');
  if (Object.keys(block).some((key) => key !== 'sameFields')) throw new BadRequestException('Supported blocking configuration: { sameFields: [domainId, systemId, catalogSource, classificationId] }');
  const fields = block.sameFields ?? [];
  if (!Array.isArray(fields) || fields.some((field) => !BLOCK_FIELDS.includes(field))) throw new BadRequestException('Unsupported blocking field');
  const configuredWeights = object(weights, 'Weights');
  if (Object.entries(configuredWeights).some(([key, value]) => !MDM_FACTOR_KEYS.includes(key as any) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) throw new BadRequestException('Weights must use supported factor keys and finite values from zero to 100');
  if (Object.keys(configuredWeights).length && !Object.values(configuredWeights).some((value) => Number(value) > 0)) throw new BadRequestException('At least one match weight must be positive');
  const survival = survivorship == null ? {} : object(survivorship, 'Survivorship rule');
  if (Object.keys(survival).some((key) => key !== 'strategy') || (survival.strategy !== undefined && !['higher_trust', 'source', 'candidate'].includes(String(survival.strategy)))) throw new BadRequestException('Supported survivorship strategies: higher_trust, source, candidate');
  return { blockingFields: [...new Set(fields)], weights: Object.keys(configuredWeights).length ? configuredWeights as Record<string, number> : undefined, survivorship: (survival.strategy ?? 'higher_trust') as MdmRuleConfig['survivorship'] };
}
