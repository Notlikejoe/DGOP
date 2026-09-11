// FD 4.2: exactly 28 business fields. These are persistence contracts, not
// public DTOs: submission completeness, role eligibility and list resolution
// are implemented with the intake endpoints in Phase 2.
export const AI_INTAKE_SCHEMA_VERSION = 1;
export const AI_INTAKE_FIELDS = [
  'request_date', 'requester', 'usecase_name', 'proposed_owner',
  'strategic_streams', 'values_alignment', 'program_platform', 'problem_desc',
  'beneficiary_group', 'current_state', 'objective_value', 'success_kpi',
  'kpi_baseline', 'kpi_target', 'simpler_alternatives', 'existing_solutions_check',
  'human_role', 'target_stage', 'execution_model', 'data_source', 'data_owner',
  'data_availability', 'personal_data_flag', 'data_classification', 'budget_band',
  'executive_sponsor', 'constraints_dependencies', 'attachments',
] as const;

export type AiIntakeField = typeof AI_INTAKE_FIELDS[number];
export interface AiIntakeV1 {
  request_date: string;
  requester: string;
  usecase_name: string;
  proposed_owner: string;
  strategic_streams: string[];
  values_alignment: string;
  program_platform: string;
  problem_desc: string;
  beneficiary_group: string;
  current_state: string;
  objective_value: string;
  success_kpi: string;
  // Decimal strings avoid losing precision in JSON serialization.
  kpi_baseline: string;
  kpi_target: string;
  simpler_alternatives: { answer: boolean; justification: string };
  existing_solutions_check: { answer: boolean; details: string };
  human_role: string;
  target_stage: string;
  execution_model: string;
  data_source: string;
  data_owner: string;
  data_availability: string;
  personal_data_flag: string;
  data_classification: string;
  budget_band: string;
  executive_sponsor: string;
  constraints_dependencies: { text: string; none: boolean };
  // Existing DGOP evidence identifiers, never arbitrary remote URLs.
  attachments: string[];
}

export type AiIntakeDraftV1 = Partial<AiIntakeV1>;
export const AI_CLASSIFICATION_CRITERIA = [
  'individual_impact',
  'affected_scope',
  'harm_likelihood',
  'decision_autonomy',
  'data_fairness_transparency',
  'technical_resilience',
] as const;
export type AiClassificationCriterion = typeof AI_CLASSIFICATION_CRITERIA[number];
export type JustifiedScore = Readonly<{ value: number; justification: string }>;
export interface AiCalculationInputV1 {
  kind: 'classification' | 'inherent' | 'residual';
  scores: readonly JustifiedScore[];
  likelihood?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertIntakeDraftV1(value: unknown): asserts value is AiIntakeDraftV1 {
  if (!record(value)) throw new Error('AI intake must be an object');
  const known = new Set<string>(AI_INTAKE_FIELDS);
  for (const [key, entry] of Object.entries(value)) {
    if (!known.has(key)) throw new Error(`Unknown AI intake field: ${key}`);
    if (key === 'strategic_streams' || key === 'attachments') {
      if (!Array.isArray(entry) || entry.some(item => typeof item !== 'string')) {
        throw new Error(`${key} must contain string identifiers`);
      }
    } else if (key === 'simpler_alternatives' || key === 'existing_solutions_check') {
      const textKey = key === 'simpler_alternatives' ? 'justification' : 'details';
      if (!record(entry) || typeof entry.answer !== 'boolean' || typeof entry[textKey] !== 'string'
        || Object.keys(entry).some(k => !['answer', textKey].includes(k))) {
        throw new Error(`${key} requires an answer and explanatory text`);
      }
    } else if (key === 'constraints_dependencies') {
      if (!record(entry) || typeof entry.none !== 'boolean' || typeof entry.text !== 'string'
        || Object.keys(entry).some(k => !['none', 'text'].includes(k))) {
        throw new Error('constraints_dependencies requires text and an explicit none flag');
      }
    } else if (typeof entry !== 'string') {
      throw new Error(`${key} must be a string`);
    } else if ((key === 'kpi_baseline' || key === 'kpi_target') && !/^-?\d+(\.\d+)?$/u.test(entry)) {
      throw new Error(`${key} must be a decimal string`);
    }
  }
}

export function assertCalculationInputV1(value: unknown): asserts value is AiCalculationInputV1 {
  if (!record(value) || !['classification', 'inherent', 'residual'].includes(String(value.kind))) {
    throw new Error('Unknown AI assessment kind');
  }
  if (Object.keys(value).some(key => !['kind', 'scores', 'likelihood'].includes(key))) {
    throw new Error('Assessment inputs cannot include computed results or unknown fields');
  }
  const classification = value.kind === 'classification';
  if (!Array.isArray(value.scores) || value.scores.length !== (classification ? 6 : 8)) {
    throw new Error(classification ? 'Six classification criteria required' : 'Eight impact dimensions required');
  }
  for (const score of value.scores) {
    if (!record(score) || !Number.isInteger(score.value) || Number(score.value) < 1
      || Number(score.value) > (classification ? 5 : 4)
      || typeof score.justification !== 'string' || !score.justification.trim()
      || Object.keys(score).some(key => !['value', 'justification'].includes(key))) {
      throw new Error('Each dimension needs an in-range integer and justification');
    }
  }
  if (classification ? value.likelihood !== undefined
    : !Number.isInteger(value.likelihood) || Number(value.likelihood) < 1 || Number(value.likelihood) > 4) {
    throw new Error('Likelihood is required only for risk assessments and must be 1–4');
  }
}
