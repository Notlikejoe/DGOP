import { applyEnvironment } from './runtime-env.mjs';
import { demoConfig, atomicJson, readManifest, applyDemoEnvironment, assertDemoFixtureWrite } from './demo-profile.mjs';
// Idempotent installer for one fully populated intake in the isolated AI preview review queue.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
applyEnvironment(root, true);
const config = demoConfig(root);
applyDemoEnvironment(config);
process.env.DGOP_DEMO_ADAPTER_SCHEDULER = 'false';
const connection = new URL(process.env.DATABASE_URL);
assertDemoFixtureWrite(config,process.argv[2]);

const manifestPath = config.manifestPath;
const credentialsPath = config.credentialsPath;
if (!existsSync(manifestPath) || !existsSync(credentialsPath)) throw new Error('Install the local AI demonstration before adding the review example');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
if (manifest.demoOnly !== true || manifest.database !== connection.pathname.slice(1)) throw new Error('Demo manifest belongs to another database');
const account = credentials.accounts.find(row => row.purpose === 'showcase');
if (!account) throw new Error('Local showcase account is unavailable');

const base = config.base + '/api';
const login = await fetch(base + '/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-dgop-csrf': 'same-origin' },
  body: JSON.stringify({ email: account.email, password: account.password }),
});
if (!login.ok) throw new Error(`Preview login failed (${login.status})`);
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const readHeaders = { cookie };
const writeHeaders = { cookie, 'content-type': 'application/json', 'x-dgop-csrf': 'same-origin' };

async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${body?.message ?? text}`);
  return body;
}

const name = 'DEMO — Employee Support Knowledge Assistant';
let example = null;
if (manifest.reviewExample?.useCaseId) {
  example = await request(`/ai/use-cases/${manifest.reviewExample.useCaseId}`, { headers: readHeaders });
}
if (!example) {
  const visible = await request(`/ai/use-cases?search=${encodeURIComponent(name)}&pageSize=200`, { headers: readHeaders });
  if (!Array.isArray(visible.data) || visible.total > 200) throw new Error('Review example lookup is ambiguous; preserve existing records and inspect fixture ownership');
  const matches = visible.data.filter(row => row.name === name);
  if (matches.length > 1) throw new Error('Multiple records claim the pending review fixture');
  if (matches.length) example = await request(`/ai/use-cases/${matches[0].id}`, { headers: readHeaders });
}
if (example && (example.name !== name || example.requesterUserId !== manifest.actors.showcase || example.intakeRevisions?.[0]?.createdBy !== manifest.actors.showcase)) throw new Error('Pending review fixture ownership conflicts with this installation');

if (!example) {
  const riyadhDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const payload = {
    request_date: riyadhDate,
    requester: manifest.actors.showcase,
    usecase_name: name,
    proposed_owner: manifest.actors.owner,
    strategic_streams: ['EFFICIENCY'],
    values_alignment: 'Consistent, transparent and accountable employee support with human ownership of every response.',
    program_platform: 'OPERATIONS',
    problem_desc: 'Employees spend time searching multiple approved knowledge sources and service procedures before submitting support requests.',
    beneficiary_group: 'All employees and internal service teams',
    current_state: 'Employees search policy pages manually and service agents repeatedly answer common questions.',
    objective_value: 'Recommend approved knowledge articles and the correct service channel while preserving human review for sensitive requests.',
    success_kpi: 'Percentage of questions resolved with an approved source and no escalation',
    kpi_baseline: '45',
    kpi_target: '75',
    simpler_alternatives: { answer: true, justification: 'Search improvements and decision trees were assessed; retrieval assistance adds value for natural-language questions.' },
    existing_solutions_check: { answer: true, details: 'Existing enterprise search and service catalogue capabilities were reviewed before proposing this use case.' },
    human_role: 'HUMAN_APPROVAL',
    target_stage: 'PILOT',
    execution_model: 'INTERNAL',
    data_source: 'Synthetic employee questions and approved internal knowledge articles',
    data_owner: manifest.actors.dataOwner,
    data_availability: 'AVAILABLE',
    personal_data_flag: 'YES',
    data_classification: 'RESTRICTED',
    budget_band: 'FUNDED',
    executive_sponsor: manifest.actors.executive,
    constraints_dependencies: { text: 'Pilot uses synthetic questions, approved content only, access controls, source citations and human escalation.', none: false },
    attachments: [manifest.evidenceId],
  };
  example = await request('/ai/use-cases', { method: 'POST', headers: writeHeaders, body: JSON.stringify({ payload }) });
  manifest.reviewExample = { useCaseId: example.id, name: 'Employee Support Knowledge Assistant', stage: 'draft', completeInput: true, demoOnly: true };
  atomicJson(manifestPath, manifest);
}
if (!example.workflowCaseId) {
  await request(`/ai/use-cases/${example.id}/submit`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ expectedVersion: example.version }) });
  example = await request(`/ai/use-cases/${example.id}`, { headers: readHeaders });
}

const reviewQueues = [
  ['triage', '/ai/use-cases/triage'],
  ['classification', '/ai/use-cases/classification/queue'],
  ['verification', '/ai/use-cases/classification/verification/queue'],
  ['specialist', '/ai/use-cases/classification/reviews/queue'],
  ['decision', '/ai/use-cases/decisions/queue'],
  ['registration', '/ai/use-cases/registration/queue'],
];
let stage = null;
for (const [name, path] of reviewQueues) {
  const queue = await request(path, { headers: readHeaders });
  if (queue.some(row => row.id === example.id)) stage = name;
}
if (!stage) throw new Error('The complete example is not available in an active review queue');
const payload = example.intakeRevisions?.[0]?.payload ?? {};
const requiredFields = ['usecase_name', 'proposed_owner', 'problem_desc', 'objective_value', 'success_kpi', 'human_role', 'data_source', 'data_owner', 'executive_sponsor'];
if (requiredFields.some(field => payload[field] === undefined || payload[field] === '')) throw new Error('The review example intake is incomplete');
manifest.reviewExample = { useCaseId: example.id, name: 'Employee Support Knowledge Assistant', stage, completeInput: true, demoOnly: true };
atomicJson(manifestPath, manifest);
console.log(JSON.stringify({ installed: true, useCaseId: example.id, stage, completeInput: true }));
