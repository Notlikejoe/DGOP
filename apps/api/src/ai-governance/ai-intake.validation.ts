import {
  AI_INTAKE_FIELDS,
  AiIntakeDraftV1,
  AiIntakeField,
  AiIntakeV1,
  assertIntakeDraftV1,
} from './ai-governance.contracts';

export interface AiIntakeValidationIssue {
  field: AiIntakeField;
  code: string;
  message: string;
}

export const AI_INTAKE_REQUIRED_FIELDS = AI_INTAKE_FIELDS.filter(
  field => field !== 'constraints_dependencies' && field !== 'attachments',
);

export const AI_INTAKE_REFERENCE_FIELDS = {
  strategic_streams: 'L_STREAMS',
  program_platform: 'L_PROGRAMS',
  human_role: 'L_HUMAN',
  target_stage: 'L_STAGE',
  execution_model: 'L_MODEL',
  data_availability: 'L_AVAIL',
  personal_data_flag: 'L_YN',
  data_classification: 'L_CLASS',
  budget_band: 'L_BUDGET',
} as const satisfies Partial<Record<AiIntakeField, string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TEXT_LIMITS: Partial<Record<AiIntakeField, number>> = {
  usecase_name: 200,
  beneficiary_group: 500,
  success_kpi: 200,
  data_source: 500,
};
const USER_FIELDS: AiIntakeField[] = ['requester', 'proposed_owner', 'data_owner', 'executive_sponsor'];

function blank(value: unknown): boolean {
  return typeof value !== 'string' || !value.trim();
}

function issue(field: AiIntakeField, code: string, message: string): AiIntakeValidationIssue {
  return { field, code, message };
}

export function assertAiIntakeDraftPayload(value: unknown): asserts value is AiIntakeDraftV1 {
  assertIntakeDraftV1(value);
  const payload = value as AiIntakeDraftV1;
  const issues: AiIntakeValidationIssue[] = [];
  for (const [field, limit] of Object.entries(TEXT_LIMITS) as [AiIntakeField, number][]) {
    const entry = payload[field];
    if (typeof entry === 'string' && entry.length > limit) {
      issues.push(issue(field, 'MAX_LENGTH', `${field} must not exceed ${limit} characters`));
    }
  }
  if (payload.strategic_streams && payload.strategic_streams.length > 9) {
    issues.push(issue('strategic_streams', 'MAX_SELECTIONS', 'strategic_streams allows at most nine values'));
  }
  if (payload.constraints_dependencies) {
    const { none, text } = payload.constraints_dependencies;
    if (none && text.trim()) {
      issues.push(issue('constraints_dependencies', 'CONFLICTING_NONE', 'Constraints text must be empty when none is selected'));
    }
  }
  if (issues.length) throw Object.assign(new Error('AI intake draft validation failed'), { issues });
}

export function aiIntakeSubmissionIssues(
  value: unknown,
  today: string,
): AiIntakeValidationIssue[] {
  try {
    assertAiIntakeDraftPayload(value);
  } catch (error) {
    const captured = (error as { issues?: AiIntakeValidationIssue[] }).issues;
    return captured ?? [issue('usecase_name', 'INVALID_PAYLOAD', (error as Error).message)];
  }
  const payload = value as AiIntakeDraftV1;
  const issues: AiIntakeValidationIssue[] = [];
  for (const field of AI_INTAKE_REQUIRED_FIELDS) {
    if (!(field in payload)) {
      issues.push(issue(field, 'REQUIRED', `${field} is required at submission`));
    }
  }
  for (const field of AI_INTAKE_REQUIRED_FIELDS) {
    const entry = payload[field];
    if (typeof entry === 'string' && !entry.trim()) {
      issues.push(issue(field, 'REQUIRED', `${field} cannot be blank`));
    }
  }
  if (payload.request_date !== undefined) {
    const valid = DATE.test(payload.request_date)
      && !Number.isNaN(Date.parse(`${payload.request_date}T00:00:00Z`));
    if (!valid) issues.push(issue('request_date', 'INVALID_DATE', 'request_date must be a valid YYYY-MM-DD date'));
    else if (payload.request_date > today) issues.push(issue('request_date', 'FUTURE_DATE', 'request_date cannot be in the future'));
  }
  for (const field of USER_FIELDS) {
    const entry = payload[field];
    if (typeof entry === 'string' && entry.trim() && !UUID.test(entry)) {
      issues.push(issue(field, 'INVALID_USER_REFERENCE', `${field} must be an organization-directory user identifier`));
    }
  }
  if (payload.strategic_streams) {
    if (payload.strategic_streams.length < 1 || payload.strategic_streams.length > 9) {
      issues.push(issue('strategic_streams', 'SELECTION_COUNT', 'Select between one and nine strategic streams'));
    }
    if (new Set(payload.strategic_streams).size !== payload.strategic_streams.length) {
      issues.push(issue('strategic_streams', 'DUPLICATE_SELECTION', 'Strategic streams cannot contain duplicates'));
    }
    if (payload.strategic_streams.some(blank)) {
      issues.push(issue('strategic_streams', 'INVALID_SELECTION', 'Strategic stream codes cannot be blank'));
    }
  }
  if (payload.attachments) {
    if (new Set(payload.attachments).size !== payload.attachments.length) {
      issues.push(issue('attachments', 'DUPLICATE_ATTACHMENT', 'Attachment identifiers cannot be repeated'));
    }
    if (payload.attachments.some(id => !UUID.test(id))) {
      issues.push(issue('attachments', 'INVALID_ATTACHMENT', 'Attachments must use DGOP evidence identifiers'));
    }
  }
  if (payload.simpler_alternatives && !payload.simpler_alternatives.justification.trim()) {
    issues.push(issue('simpler_alternatives', 'JUSTIFICATION_REQUIRED', 'A simpler-alternatives justification is required'));
  }
  if (payload.existing_solutions_check && !payload.existing_solutions_check.details.trim()) {
    issues.push(issue('existing_solutions_check', 'DETAILS_REQUIRED', 'Existing-solution checks must name the platforms checked or state that none exist'));
  }
  if (payload.constraints_dependencies && !payload.constraints_dependencies.none
    && !payload.constraints_dependencies.text.trim()) {
    issues.push(issue('constraints_dependencies', 'TEXT_OR_NONE_REQUIRED', 'Enter constraints or select none'));
  }
  return issues;
}

export function assertAiIntakeSubmission(
  value: unknown,
  today: string,
): asserts value is AiIntakeV1 {
  const issues = aiIntakeSubmissionIssues(value, today);
  if (issues.length) throw Object.assign(new Error('AI intake submission validation failed'), { issues });
}
