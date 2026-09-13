import assert from 'node:assert/strict';
import {
  AI_INTAKE_REFERENCE_FIELDS,
  AI_INTAKE_REQUIRED_FIELDS,
  aiIntakeSubmissionIssues,
  assertAiIntakeDraftPayload,
} from '../src/ai-governance/ai-intake.validation';

const id = '11111111-1111-4111-8111-111111111111';
const complete = {
  request_date: '2026-09-10', requester: id, usecase_name: 'Assisted matching', proposed_owner: id,
  strategic_streams: ['STREAM_1'], values_alignment: 'Supports equitable access', program_platform: 'PROGRAM_1',
  problem_desc: 'Manual matching takes too long', beneficiary_group: 'Job seekers', current_state: 'Manual review',
  objective_value: 'Reduce review time', success_kpi: 'Minutes per match', kpi_baseline: '30', kpi_target: '10',
  simpler_alternatives: { answer: true, justification: 'Rules were insufficient' },
  existing_solutions_check: { answer: true, details: 'Reviewed existing organization solutions' },
  human_role: 'HUMAN_APPROVAL', target_stage: 'PILOT', execution_model: 'INTERNAL', data_source: 'Matching records',
  data_owner: id, data_availability: 'AVAILABLE', personal_data_flag: 'YES', data_classification: 'RESTRICTED',
  budget_band: 'FUNDED', executive_sponsor: id,
  constraints_dependencies: { text: '', none: true }, attachments: [],
};

assert.equal(AI_INTAKE_REQUIRED_FIELDS.length, 26);
assert.equal(Object.keys(AI_INTAKE_REFERENCE_FIELDS).length, 9);
assert.doesNotThrow(() => assertAiIntakeDraftPayload({ usecase_name: '' }));
assert.throws(() => assertAiIntakeDraftPayload({ usecase_name: 'x'.repeat(201) }));
assert.throws(() => assertAiIntakeDraftPayload({ invented_field: true }));
assert.equal(aiIntakeSubmissionIssues(complete, '2026-09-11').length, 0);
assert.ok(aiIntakeSubmissionIssues({ ...complete, problem_desc: '' }, '2026-09-11').some(row => row.field === 'problem_desc'));
assert.ok(aiIntakeSubmissionIssues({ ...complete, request_date: '2026-09-12' }, '2026-09-11').some(row => row.code === 'FUTURE_DATE'));
assert.ok(aiIntakeSubmissionIssues({ ...complete, strategic_streams: ['STREAM_1', 'STREAM_1'] }, '2026-09-11').some(row => row.code === 'DUPLICATE_SELECTION'));
assert.ok(aiIntakeSubmissionIssues({ ...complete, simpler_alternatives: { answer: false, justification: '' } }, '2026-09-11').some(row => row.code === 'JUSTIFICATION_REQUIRED'));

console.log('AI intake contracts passed: 28-field boundary, 26 required fields, references, dates, composites and duplicate guards.');
