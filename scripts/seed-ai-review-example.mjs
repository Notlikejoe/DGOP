// Idempotent installer for one fully populated intake in the isolated AI preview review queue.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
Object.assign(process.env, parseEnv(readFileSync(resolve(root, '.env'), 'utf8')));
const connection = new URL(process.env.DATABASE_URL);
if (process.argv[2] !== '--local-demo' || connection.hostname !== '127.0.0.1' || connection.port !== '55436'
  || !/^\/dgop_ai_preview_\d+$/u.test(connection.pathname) || process.env.NODE_ENV !== 'development') {
  throw new Error('Explicit isolated local preview required; original and remote databases are prohibited');
}

const manifestPath = resolve(root, 'storage/ai-preview/demo-manifest.json');
const credentialsPath = resolve(root, '../../outputs/DGOP_AI_Demo_Logins.local.json');
if (!existsSync(manifestPath) || !existsSync(credentialsPath)) throw new Error('Install the local AI demonstration before adding the review example');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
if (manifest.demoOnly !== true || manifest.database !== connection.pathname.slice(1)) throw new Error('Demo manifest belongs to another database');
const account = credentials.accounts.find(row => row.purpose === 'showcase');
if (!account) throw new Error('Local showcase account is unavailable');

const base = 'http://127.0.0.1:3006/api';
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
  try { example = await request(`/ai/use-cases/${manifest.reviewExample.useCaseId}`, { headers: readHeaders }); } catch { example = null; }
}
if (!example) {
  const visible = await request('/ai/use-cases', { headers: readHeaders });
  example = visible.find(row => row.name === name) ?? null;
}

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
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ installed: true, useCaseId: example.id, stage, completeInput: true }));
