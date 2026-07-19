import {
  GovernanceEscalationLevel,
  GovernanceNotificationSeverity,
} from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
const KSA_WEEKEND_DAYS = new Set([5, 6]);

export type SlaSignal = 'on_track' | 'at_risk' | 'overdue' | 'done' | 'none';
export type ProductionReadinessStatus = 'ready' | 'watch' | 'blocked';
export type OperatingModelStatus = ProductionReadinessStatus;

export type OperatingBodyDefinition = {
  code: string;
  name: string;
  purpose: string;
  ownerRoleCode: string;
  cadence: string;
  responsibilities: string[];
  decisionRights: string[];
  evidenceRequirements: string[];
};

export type OperatingCeremonyDefinition = {
  code: string;
  name: string;
  cadence: string;
  ownerBodyCode: string;
  outputs: string[];
};

export type LifecycleStepDefinition = {
  code: string;
  name: string;
  ownerRoleCode: string;
  evidence: string;
};

export type ExecutiveKpiDefinition = {
  code: string;
  label: string;
  formula: string;
  dataSources: string[];
  ownerRoleCode: string;
  evidence: string[];
};

export type PlatformServiceDefinition = {
  code: string;
  name: string;
  boundedContext: string;
  serviceType: 'core_engine' | 'integration_service' | 'control_service' | 'analytics_service';
  ownerRoleCode: string;
  dependencies: string[];
  acceptanceSignals: string[];
  route: string;
};

export type PlatformServiceInput = {
  implemented: boolean;
  dataSignals: number;
  openRisks: number;
  wiredDependencies: number;
  requiredDependencies: number;
};

export type EnterpriseClosureDefinition = {
  code: string;
  name: string;
  family: string;
  ownerRoleCode: string;
  frameworks: string[];
  implementation: string;
  evidence: string[];
  acceptedDeferral?: string;
};

export type EnterpriseClosureInput = {
  implemented: boolean;
  evidenceSignals: number;
  openRisks: number;
  acceptedDeferral?: boolean;
};

export type ProductionAcceptanceDefinition = {
  code: string;
  name: string;
  family: 'environment' | 'module' | 'performance' | 'support';
  ownerRoleCode: string;
  target: string;
  evidence: string[];
  acceptedDeferral?: string;
};

export type DgpoSizingInput = {
  governedAssets: number;
  dataDomains: number;
  systemPlatforms: number;
  activeCases: number;
  openTasks: number;
};

export type OperatingPressureInput = {
  bodyCode: string;
  pressure: number;
  governedAssets: number;
  dataDomains: number;
  recommendedFte: number;
};

export const OPERATING_BODY_DEFINITIONS: OperatingBodyDefinition[] = [
  {
    code: 'dgsc',
    name: 'Data Governance Steering Committee',
    purpose: 'Executive body that owns governance priorities, risk acceptance, funding, and cross-domain decisions.',
    ownerRoleCode: 'executive',
    cadence: 'quarterly',
    responsibilities: ['Set governance priorities', 'Accept or reject enterprise risk', 'Fund DGPO capacity'],
    decisionRights: ['Approve operating model changes', 'Approve high-impact exceptions', 'Resolve executive escalations'],
    evidenceRequirements: ['Decision minutes', 'Risk acceptance record', 'Quarterly KPI pack'],
  },
  {
    code: 'data_council',
    name: 'Data Council',
    purpose: 'Senior operating council that turns executive priorities into governance standards and delivery decisions.',
    ownerRoleCode: 'dmo_admin',
    cadence: 'monthly',
    responsibilities: ['Prioritize policy backlog', 'Review KPI trends', 'Approve reusable standards'],
    decisionRights: ['Approve standards and procedures', 'Resolve cross-domain conflicts', 'Sponsor policy lifecycle changes'],
    evidenceRequirements: ['Council agenda', 'Decision register', 'Policy approval evidence'],
  },
  {
    code: 'dmo',
    name: 'Data Management Office',
    purpose: 'Central DGPO team that runs the platform, evidence cadence, configuration, reporting, and operational quality.',
    ownerRoleCode: 'dmo_admin',
    cadence: 'weekly',
    responsibilities: ['Operate DGOP', 'Run evidence cycles', 'Maintain workflow and SLA configuration'],
    decisionRights: ['Configure workflow templates', 'Publish operating dashboards', 'Coordinate escalations'],
    evidenceRequirements: ['Runbook updates', 'Configuration change log', 'Release readiness record'],
  },
  {
    code: 'domain_council',
    name: 'Domain Council',
    purpose: 'Domain-level group that owns data accountability, quality remediation, and policy execution for its domain.',
    ownerRoleCode: 'data_owner',
    cadence: 'biweekly',
    responsibilities: ['Assign owners and stewards', 'Review domain quality', 'Resolve domain exceptions'],
    decisionRights: ['Approve domain ownership changes', 'Accept domain remediation plans', 'Escalate unresolved risks'],
    evidenceRequirements: ['Ownership decisions', 'Quality issue evidence', 'Domain exception record'],
  },
  {
    code: 'working_group',
    name: 'Working Group',
    purpose: 'Temporary or standing group that prepares technical options, implementation evidence, and issue remediation.',
    ownerRoleCode: 'data_steward',
    cadence: 'as_needed',
    responsibilities: ['Prepare analysis', 'Coordinate remediation', 'Document implementation evidence'],
    decisionRights: ['Recommend actions', 'Confirm work readiness', 'Raise dependency blockers'],
    evidenceRequirements: ['Analysis note', 'Remediation evidence', 'Dependency log'],
  },
  {
    code: 'community_of_practice',
    name: 'Community of Practice',
    purpose: 'Practitioner network that scales standards, training, and reusable practices across domains.',
    ownerRoleCode: 'enterprise_data_steward',
    cadence: 'monthly',
    responsibilities: ['Share patterns', 'Improve training', 'Collect feedback from stewards'],
    decisionRights: ['Recommend playbook improvements', 'Propose training updates', 'Surface adoption risks'],
    evidenceRequirements: ['Session notes', 'Practice backlog', 'Training feedback'],
  },
];

export const OPERATING_CEREMONY_DEFINITIONS: OperatingCeremonyDefinition[] = [
  {
    code: 'weekly_triage',
    name: 'Weekly governance triage',
    cadence: 'weekly',
    ownerBodyCode: 'dmo',
    outputs: ['Priority queue', 'SLA risk list', 'Escalation candidates'],
  },
  {
    code: 'monthly_council',
    name: 'Monthly Data Council',
    cadence: 'monthly',
    ownerBodyCode: 'data_council',
    outputs: ['Decision register', 'Policy approvals', 'Cross-domain action list'],
  },
  {
    code: 'quarterly_steering',
    name: 'Quarterly steering review',
    cadence: 'quarterly',
    ownerBodyCode: 'dgsc',
    outputs: ['Executive KPI pack', 'Risk acceptance record', 'Funding or capacity decisions'],
  },
  {
    code: 'domain_operations_review',
    name: 'Domain operations review',
    cadence: 'biweekly',
    ownerBodyCode: 'domain_council',
    outputs: ['Domain backlog', 'Owner decisions', 'Quality remediation commitments'],
  },
];

export const CHARTER_LIFECYCLE_STEPS: LifecycleStepDefinition[] = [
  { code: 'draft', name: 'Draft charter', ownerRoleCode: 'dmo_admin', evidence: 'Charter draft and scope statement' },
  { code: 'review', name: 'Council review', ownerRoleCode: 'data_council', evidence: 'Review comments and decision log' },
  { code: 'approve', name: 'Steering approval', ownerRoleCode: 'executive', evidence: 'Approved charter decision' },
  { code: 'publish', name: 'Publish and assign', ownerRoleCode: 'dmo_admin', evidence: 'Published charter and accountable roles' },
  { code: 'refresh', name: 'Periodic refresh', ownerRoleCode: 'data_council', evidence: 'Refresh record and change summary' },
];

export const POLICY_LIFECYCLE_STEPS: LifecycleStepDefinition[] = [
  { code: 'intake', name: 'Policy intake', ownerRoleCode: 'dmo_admin', evidence: 'Policy need and control mapping' },
  { code: 'draft', name: 'Draft policy', ownerRoleCode: 'enterprise_data_steward', evidence: 'Draft policy and consultation notes' },
  { code: 'review', name: 'Impact review', ownerRoleCode: 'data_council', evidence: 'Legal, privacy, security, and domain review' },
  { code: 'approve', name: 'Approve policy', ownerRoleCode: 'executive', evidence: 'Approval decision and effective date' },
  { code: 'monitor', name: 'Monitor compliance', ownerRoleCode: 'dmo_admin', evidence: 'Compliance score, exceptions, and audit evidence' },
];

export const EXECUTIVE_KPI_DEFINITIONS: ExecutiveKpiDefinition[] = [
  {
    code: 'ownership_coverage',
    label: 'Ownership coverage',
    formula: 'assigned governed assets / total governed assets',
    dataSources: ['data_assets.ownerStatus'],
    ownerRoleCode: 'dmo_admin',
    evidence: ['Asset register snapshot', 'Ownership assignment trail'],
  },
  {
    code: 'workflow_sla_health',
    label: 'Workflow SLA health',
    formula: '1 - overdue open workflow tasks / open workflow tasks',
    dataSources: ['workflow_tasks.status', 'workflow_tasks.dueDate'],
    ownerRoleCode: 'dmo_admin',
    evidence: ['Workflow task queue', 'KSA business-day SLA calculation'],
  },
  {
    code: 'quality_pressure',
    label: 'Data quality pressure',
    formula: 'open data quality issues / governed assets',
    dataSources: ['data_quality_issues.status', 'data_assets.id'],
    ownerRoleCode: 'dq_steward',
    evidence: ['Quality issue queue', 'RCA and closure evidence'],
  },
  {
    code: 'audit_evidence_readiness',
    label: 'Audit evidence readiness',
    formula: 'verified audit evidence records / required audit evidence records',
    dataSources: ['audit_logs', 'compliance_calendar_occurrences'],
    ownerRoleCode: 'auditor',
    evidence: ['Audit log chain', 'Compliance calendar evidence'],
  },
  {
    code: 'operating_cadence_readiness',
    label: 'Operating cadence readiness',
    formula: 'active ceremonies with owners / required operating ceremonies',
    dataSources: ['compliance_calendar_templates', 'governance_notifications'],
    ownerRoleCode: 'dmo_admin',
    evidence: ['Ceremony cadence register', 'Calendar workflow cases'],
  },
];

export const PLATFORM_SERVICE_DEFINITIONS: PlatformServiceDefinition[] = [
  {
    code: 'workflow_engine',
    name: 'Workflow and BPM Service',
    boundedContext: 'workflow',
    serviceType: 'core_engine',
    ownerRoleCode: 'dmo_admin',
    dependencies: ['audit_chain', 'notification_sla_engine', 'scope_abac_engine'],
    acceptanceSignals: ['template coverage', 'routed cases', 'task SLA decisions'],
    route: '/governance/workflow',
  },
  {
    code: 'evidence_engine',
    name: 'Evidence and Audit Pack Service',
    boundedContext: 'evidence',
    serviceType: 'control_service',
    ownerRoleCode: 'auditor',
    dependencies: ['audit_chain', 'workflow_engine'],
    acceptanceSignals: ['approved evidence', 'audit packs', 'chain-of-custody metadata'],
    route: '/governance/ndi/audit-packs',
  },
  {
    code: 'ndi_scoring_engine',
    name: 'NDI Scoring Engine',
    boundedContext: 'ndi',
    serviceType: 'analytics_service',
    ownerRoleCode: 'dmo_admin',
    dependencies: ['evidence_engine'],
    acceptanceSignals: ['domain readiness', 'gap queue', 'maturity bands'],
    route: '/governance/ndi/readiness',
  },
  {
    code: 'unified_search_service',
    name: 'Unified Search Service',
    boundedContext: 'search',
    serviceType: 'analytics_service',
    ownerRoleCode: 'dmo_admin',
    dependencies: ['scope_abac_engine'],
    acceptanceSignals: ['cross-object results', 'permission filters', 'asset-scope enforcement'],
    route: '/design-system',
  },
  {
    code: 'integration_adapter_service',
    name: 'Integration Adapter Service',
    boundedContext: 'integrations',
    serviceType: 'integration_service',
    ownerRoleCode: 'data_custodian',
    dependencies: ['audit_chain', 'evidence_engine'],
    acceptanceSignals: ['connectors', 'import batches', 'dead-letter handling'],
    route: '/admin/integrations',
  },
  {
    code: 'scope_abac_engine',
    name: 'Scope and ABAC Engine',
    boundedContext: 'access',
    serviceType: 'control_service',
    ownerRoleCode: 'security_admin',
    dependencies: ['audit_chain'],
    acceptanceSignals: ['role-data maps', 'object-level scope', 'decision logs'],
    route: '/governance/security',
  },
  {
    code: 'masking_service',
    name: 'Masking Policy Service',
    boundedContext: 'security_governance',
    serviceType: 'control_service',
    ownerRoleCode: 'security_admin',
    dependencies: ['scope_abac_engine'],
    acceptanceSignals: ['masking policies', 'classification rules', 'decision preview'],
    route: '/governance/security',
  },
  {
    code: 'notification_sla_engine',
    name: 'Notification and SLA Service',
    boundedContext: 'governance_operations',
    serviceType: 'core_engine',
    ownerRoleCode: 'dmo_admin',
    dependencies: ['workflow_engine', 'audit_chain'],
    acceptanceSignals: ['KSA business days', 'notifications', 'escalations'],
    route: '/governance/operations',
  },
  {
    code: 'audit_chain',
    name: 'Audit Chain Service',
    boundedContext: 'audit',
    serviceType: 'control_service',
    ownerRoleCode: 'auditor',
    dependencies: [],
    acceptanceSignals: ['hash chain', 'verified logs', 'tamper detection'],
    route: '/admin/audit',
  },
  {
    code: 'reporting_service',
    name: 'Reporting and Executive Pack Service',
    boundedContext: 'reports',
    serviceType: 'analytics_service',
    ownerRoleCode: 'executive',
    dependencies: ['workflow_engine', 'evidence_engine', 'ndi_scoring_engine'],
    acceptanceSignals: ['executive reports', 'audit exports', 'readiness snapshots'],
    route: '/governance/reports',
  },
];

export const SECURITY_CONTROL_CROSSWALK_DEFINITIONS: EnterpriseClosureDefinition[] = [
  {
    code: 'rbac_abac_scope',
    name: 'RBAC, ABAC, and role-data scope',
    family: 'Access control',
    ownerRoleCode: 'security_admin',
    frameworks: ['NCA ECC', 'PDPL', 'DSP'],
    implementation: 'JWT session guard, permission guard, ScopeService, role-data mappings, and ABAC decision log.',
    evidence: ['roles and permissions', 'role data scopes', 'role-data access maps', 'ABAC decisions'],
  },
  {
    code: 'secure_search',
    name: 'Secure federated search',
    family: 'Search security',
    ownerRoleCode: 'dmo_admin',
    frameworks: ['NCA ECC', 'NDI'],
    implementation: 'Search results are permission-gated and filtered through asset/data-scope visibility.',
    evidence: ['search permission checks', 'scoped asset filters', 'cross-object result groups'],
  },
  {
    code: 'masking_classification',
    name: 'Masking and classification controls',
    family: 'Data protection',
    ownerRoleCode: 'security_admin',
    frameworks: ['NCA ECC', 'PDPL'],
    implementation: 'Classification-aware access decisions apply masking policies before exposure.',
    evidence: ['masking policies', 'classification ranks', 'ABAC simulation decisions'],
  },
  {
    code: 'evidence_chain',
    name: 'Evidence chain of custody',
    family: 'Audit evidence',
    ownerRoleCode: 'auditor',
    frameworks: ['NDI', 'NCA ECC'],
    implementation: 'Evidence is hashed, reviewed, linked to NDI specifications, and packaged for audit.',
    evidence: ['approved evidence', 'audit packs', 'evidence hashes'],
  },
  {
    code: 'audit_chain_integrity',
    name: 'Audit log integrity',
    family: 'Monitoring',
    ownerRoleCode: 'auditor',
    frameworks: ['NCA ECC', 'NDI'],
    implementation: 'Append-only audit rows include previous/current hashes and can be verified as a chain.',
    evidence: ['audit rows', 'chain verification result'],
  },
  {
    code: 'privacy_by_design',
    name: 'Privacy by Design SDLC gates',
    family: 'Privacy',
    ownerRoleCode: 'privacy_officer',
    frameworks: ['PDPL', 'DSP'],
    implementation: 'DPIA, RoPA, DSR, consent, retention, and breach records route privacy work through controlled workflows.',
    evidence: ['DPIA records', 'privacy gates', 'DSR queue', 'breach records'],
  },
  {
    code: 'incident_response',
    name: 'Incident response and classification change control',
    family: 'Security operations',
    ownerRoleCode: 'security_admin',
    frameworks: ['NCA ECC', 'PDPL'],
    implementation: 'DLP incidents and classification changes create workflow cases and keep decisions auditable.',
    evidence: ['DLP incidents', 'classification change requests', 'workflow cases'],
  },
  {
    code: 'compliance_calendar',
    name: 'Recurring compliance calendar',
    family: 'Governance operations',
    ownerRoleCode: 'dmo_admin',
    frameworks: ['NDI', 'PDPL', 'DSP'],
    implementation: 'Compliance templates create due work using KSA business-day SLA calculation and workflow cases.',
    evidence: ['calendar templates', 'calendar occurrences', 'workflow tasks'],
  },
  {
    code: 'secure_error_handling',
    name: 'Secure error handling',
    family: 'Platform trust',
    ownerRoleCode: 'platform_admin',
    frameworks: ['NCA ECC', 'DSP'],
    implementation: 'Global exception handling returns safe error envelopes with stable codes and request IDs.',
    evidence: ['error catalog', 'request ID headers', 'safe public messages'],
  },
  {
    code: 'integration_resilience',
    name: 'Integration retry and dead-letter control',
    family: 'Integration governance',
    ownerRoleCode: 'data_custodian',
    frameworks: ['NCA ECC', 'NDI'],
    implementation: 'Integration events, import batches, row errors, retries, and dead-letter states are tracked.',
    evidence: ['integration events', 'import errors', 'retry/dead-letter counts'],
  },
  {
    code: 'vault_secret_management',
    name: 'Vault-backed secret management',
    family: 'Deployment security',
    ownerRoleCode: 'security_admin',
    frameworks: ['NCA ECC'],
    implementation: 'Application reads secrets from environment variables; external vault binding is a deployment control.',
    evidence: ['JWT secret requirement', 'environment gate'],
    acceptedDeferral: 'Requires target hosting/security platform such as HashiCorp Vault, cloud secret manager, or equivalent.',
  },
  {
    code: 'mtls_service_mesh',
    name: 'mTLS and service-to-service trust',
    family: 'Deployment security',
    ownerRoleCode: 'security_admin',
    frameworks: ['NCA ECC'],
    implementation: 'The local monolith exposes one API boundary; mTLS is mapped to production ingress/service mesh.',
    evidence: ['helmet headers', 'CORS allowlist', 'production ingress requirement'],
    acceptedDeferral: 'Requires production hosting, ingress, certificate lifecycle, and service mesh decisions.',
  },
  {
    code: 'siem_monitoring',
    name: 'SIEM and monitoring integration',
    family: 'Monitoring',
    ownerRoleCode: 'security_admin',
    frameworks: ['NCA ECC'],
    implementation: 'Audit, integration, and error logs are structured locally; SIEM forwarding is a deployment integration.',
    evidence: ['audit log', 'integration events', 'request IDs'],
    acceptedDeferral: 'Requires target SIEM/log drain and retention policy for the production environment.',
  },
];

export const PRODUCTION_ACCEPTANCE_DEFINITIONS: ProductionAcceptanceDefinition[] = [
  {
    code: 'env_strategy',
    name: 'DEV, TEST, UAT, PRE-PROD, PROD, and DR gates',
    family: 'environment',
    ownerRoleCode: 'platform_admin',
    target: 'Each environment has entry/exit criteria, data controls, support owner, and rollback path.',
    evidence: ['README run modes', 'environment variables', 'release readiness gate'],
  },
  {
    code: 'module_acceptance',
    name: 'Module-level acceptance coverage',
    family: 'module',
    ownerRoleCode: 'qa_lead',
    target: 'Administration, ownership, assets, workflow, NDI, training, DQ/security, integrations, reports, and audit packs have test/build evidence.',
    evidence: ['API test suite', 'web build', 'QA sprint packs'],
  },
  {
    code: 'search_performance',
    name: '1M asset search target',
    family: 'performance',
    ownerRoleCode: 'platform_admin',
    target: 'Search should be under 500ms p95 after production indexing and data-volume testing.',
    evidence: ['bounded search limit', 'scope-filtered queries', 'performance test plan'],
    acceptedDeferral: 'Requires target production data volume, indexing/cache decisions, and signed load-test evidence in the selected hosting environment.',
  },
  {
    code: 'asset_360_performance',
    name: 'Asset 360 response target',
    family: 'performance',
    ownerRoleCode: 'platform_admin',
    target: 'Asset 360 should load under 2 seconds for production reference data volume.',
    evidence: ['bounded API selects', 'asset route build evidence', 'performance test plan'],
    acceptedDeferral: 'Requires production-like reference data volume and browser/API timing evidence after final infrastructure sizing.',
  },
  {
    code: 'bulk_import_target',
    name: '10,000 asset import target',
    family: 'performance',
    ownerRoleCode: 'data_custodian',
    target: '10,000-row import should complete under 10 minutes with row-level error reporting.',
    evidence: ['CSV import engine', 'row error outputs', 'batch reconciliation'],
    acceptedDeferral: 'Requires production database sizing, import-file storage limits, and a 10,000-row signed performance run.',
  },
  {
    code: 'workflow_scale_target',
    name: '1,000 concurrent workflow cases target',
    family: 'performance',
    ownerRoleCode: 'dmo_admin',
    target: 'Workflow queues should remain usable and SLA timers accurate within +/-30 seconds at target case volume.',
    evidence: ['workflow tests', 'KSA SLA helpers', 'scale test plan'],
    acceptedDeferral: 'Requires a target-environment concurrency test with seeded role queues, active cases, and SLA recalculation evidence.',
  },
  {
    code: 'recovery_target',
    name: 'Recovery and DR target',
    family: 'support',
    ownerRoleCode: 'platform_admin',
    target: 'Recover API/UI service in under 5 minutes for demo/UAT; production RTO/RPO depend on hosting/backup architecture.',
    evidence: ['production-style run', 'health endpoint', 'DR acceptance note'],
    acceptedDeferral: 'Requires production backup/restore architecture, DR runbook exercise, and signed RTO/RPO acceptance evidence.',
  },
  {
    code: 'hypercare_support',
    name: 'Hypercare and support triage',
    family: 'support',
    ownerRoleCode: 'support_lead',
    target: 'Known issues, support owner, triage flow, request IDs, and escalation route are available for handover.',
    evidence: ['error request IDs', 'governance escalation', 'release readiness evidence'],
  },
];

export const ERROR_EXPERIENCE_DEFINITIONS: EnterpriseClosureDefinition[] = [
  {
    code: 'validation_errors',
    name: 'Validation and field errors',
    family: 'Error UX',
    ownerRoleCode: 'platform_admin',
    frameworks: ['DSP'],
    implementation: 'ValidationPipe blocks unknown fields and the error layer maps 400/422 to safe next steps.',
    evidence: ['validation pipe', 'VAL-400', 'VAL-422'],
  },
  {
    code: 'session_errors',
    name: 'Session expiry and login recovery',
    family: 'Error UX',
    ownerRoleCode: 'platform_admin',
    frameworks: ['NCA ECC'],
    implementation: '401 errors clear local session and redirect the user to login without exposing token details.',
    evidence: ['auth interceptor', 'SES-401'],
  },
  {
    code: 'permission_errors',
    name: 'Permission and scope denial',
    family: 'Error UX',
    ownerRoleCode: 'security_admin',
    frameworks: ['NCA ECC', 'PDPL'],
    implementation: '403/404 messages explain access safely while object-level checks remain server-side.',
    evidence: ['permission guard', 'ScopeService', 'PER-403', 'BUS-404'],
  },
  {
    code: 'conflict_errors',
    name: 'Duplicate and lifecycle conflict errors',
    family: 'Error UX',
    ownerRoleCode: 'dmo_admin',
    frameworks: ['NDI', 'DSP'],
    implementation: 'Unique conflicts and invalid lifecycle decisions return stable business error codes.',
    evidence: ['BUS-409', 'Prisma P2002 mapping'],
  },
  {
    code: 'rate_limit_errors',
    name: 'Rate limit guidance',
    family: 'Error UX',
    ownerRoleCode: 'platform_admin',
    frameworks: ['NCA ECC'],
    implementation: 'Login and API rate limits map to a retryable nontechnical message.',
    evidence: ['express-rate-limit', 'RATE-429'],
  },
  {
    code: 'import_errors',
    name: 'Import and upload error handling',
    family: 'Error UX',
    ownerRoleCode: 'data_custodian',
    frameworks: ['NDI', 'DSP'],
    implementation: 'CSV/import engines keep row-level errors and file upload errors receive safe INT codes.',
    evidence: ['row errors', 'Multer error mapping', 'INT-400'],
  },
  {
    code: 'system_errors',
    name: 'Unexpected system failures',
    family: 'Error UX',
    ownerRoleCode: 'platform_admin',
    frameworks: ['NCA ECC'],
    implementation: 'Unhandled failures return SYS-500 with request ID and no stack trace in the response.',
    evidence: ['global exception filter', 'request ID', 'safe public message'],
  },
];

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function recurringHolidayKey(date: Date): string {
  return date.toISOString().slice(5, 10);
}

export function isKsaBusinessDay(date: Date, holidayDates: string[] = [], recurringHolidayDates: string[] = []): boolean {
  if (KSA_WEEKEND_DAYS.has(date.getUTCDay())) return false;
  if (holidayDates.includes(dateKey(date))) return false;
  return !recurringHolidayDates.includes(recurringHolidayKey(date));
}

export function addKsaBusinessDays(start: Date, days: number, holidayDates: string[] = [], recurringHolidayDates: string[] = []): Date {
  const result = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 12));
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isKsaBusinessDay(result, holidayDates, recurringHolidayDates)) remaining--;
  }
  return result;
}

export function businessDaysBetween(from: Date, to: Date, holidayDates: string[] = [], recurringHolidayDates: string[] = []): number {
  const direction = to.getTime() >= from.getTime() ? 1 : -1;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 12));
  let days = 0;
  while (cursor.getTime() !== end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    if (isKsaBusinessDay(cursor, holidayDates, recurringHolidayDates)) days += direction;
  }
  return days;
}

export function ksaSlaSignal(input: {
  status: string;
  dueDate: Date | null;
  completedAt?: Date | null;
}, now = new Date(), holidayDates: string[] = [], recurringHolidayDates: string[] = []): SlaSignal {
  if (['completed', 'cancelled'].includes(input.status) || input.completedAt) return 'done';
  if (!input.dueDate) return 'none';
  const remaining = businessDaysBetween(now, input.dueDate, holidayDates, recurringHolidayDates);
  if (remaining < 0) return 'overdue';
  if (remaining <= 2) return 'at_risk';
  return 'on_track';
}

export function escalationLevel(overdueBusinessDays: number): GovernanceEscalationLevel {
  if (overdueBusinessDays >= 10) return GovernanceEscalationLevel.executive_steering_committee;
  if (overdueBusinessDays >= 6) return GovernanceEscalationLevel.data_governance_board;
  if (overdueBusinessDays >= 3) return GovernanceEscalationLevel.data_stewardship_council;
  return GovernanceEscalationLevel.domain_council;
}

export function escalationPenalty(overdueBusinessDays: number): number {
  return Math.max(1, overdueBusinessDays) * 5;
}

export function notificationSeverity(signal: SlaSignal, overdueBusinessDays = 0): GovernanceNotificationSeverity {
  if (signal === 'overdue' && overdueBusinessDays >= 6) return GovernanceNotificationSeverity.critical;
  if (signal === 'overdue' || signal === 'at_risk') return GovernanceNotificationSeverity.warning;
  if (signal === 'done') return GovernanceNotificationSeverity.success;
  return GovernanceNotificationSeverity.info;
}

export const ESCALATION_LEVEL_LABELS: Record<GovernanceEscalationLevel, string> = {
  [GovernanceEscalationLevel.domain_council]: 'Domain Council',
  [GovernanceEscalationLevel.data_stewardship_council]: 'Data Stewardship Council',
  [GovernanceEscalationLevel.data_governance_board]: 'Data Governance Board',
  [GovernanceEscalationLevel.executive_steering_committee]: 'Executive Steering Committee',
};

export function combineReadinessStatus(statuses: ProductionReadinessStatus[]): ProductionReadinessStatus {
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('watch')) return 'watch';
  return 'ready';
}

export function issueRatioStatus(
  issueCount: number,
  totalCount: number,
  thresholds: { watchPct: number; blockedPct: number; absoluteBlock?: number },
): ProductionReadinessStatus {
  if (thresholds.absoluteBlock != null && issueCount >= thresholds.absoluteBlock) return 'blocked';
  if (totalCount <= 0) return issueCount > 0 ? 'blocked' : 'ready';
  const pct = issueCount / totalCount;
  if (pct >= thresholds.blockedPct) return 'blocked';
  if (pct >= thresholds.watchPct || issueCount > 0) return 'watch';
  return 'ready';
}

export function backlogStatus(open: number, overdue: number, atRisk = 0): ProductionReadinessStatus {
  if (overdue >= 10 || (open > 0 && overdue / open >= 0.25)) return 'blocked';
  if (overdue > 0 || atRisk >= 10 || (open > 0 && atRisk / open >= 0.35)) return 'watch';
  return 'ready';
}

export function operatingDefinitionStatus(definition: {
  ownerRoleCode?: string | null;
  cadence?: string | null;
  responsibilities?: unknown[];
  decisionRights?: unknown[];
  evidenceRequirements?: unknown[];
}): OperatingModelStatus {
  if (!definition.ownerRoleCode || !definition.cadence) return 'blocked';
  if (!definition.responsibilities?.length || !definition.decisionRights?.length) return 'blocked';
  if (!definition.evidenceRequirements?.length) return 'watch';
  return 'ready';
}

export function lifecycleReadiness(steps: LifecycleStepDefinition[]): OperatingModelStatus {
  if (!steps.length) return 'blocked';
  if (steps.some((step) => !step.ownerRoleCode || !step.evidence)) return 'blocked';
  return steps.length >= 4 ? 'ready' : 'watch';
}

export function kpiTraceabilityStatus(kpi: ExecutiveKpiDefinition): OperatingModelStatus {
  if (!kpi.formula || !kpi.ownerRoleCode) return 'blocked';
  if (!kpi.dataSources.length || !kpi.evidence.length) return 'watch';
  return 'ready';
}

export function dgpoSizingGuidance(input: DgpoSizingInput) {
  const assetStewards = Math.ceil(Math.max(input.governedAssets, 0) / 75);
  const domainLeads = Math.ceil(Math.max(input.dataDomains, 0) / 6);
  const platformAnalysts = Math.ceil(Math.max(input.systemPlatforms, 0) / 20);
  const caseCoordinators = Math.ceil(Math.max(input.activeCases, 0) / 40);
  const workflowCoordinators = Math.ceil(Math.max(input.openTasks, 0) / 80);
  const baseTeam = 3;
  const recommendedFte = Math.max(
    baseTeam,
    baseTeam + assetStewards + domainLeads + platformAnalysts + caseCoordinators + workflowCoordinators,
  );
  return {
    recommendedFte,
    bands: {
      baseTeam,
      assetStewards,
      domainLeads,
      platformAnalysts,
      caseCoordinators,
      workflowCoordinators,
    },
    assumptions: [
      'Base DGPO requires lead, platform operator, and evidence coordinator.',
      'One steward capacity band is assumed per 75 governed assets.',
      'One domain lead capacity band is assumed per 6 active data domains.',
      'One platform analyst band is assumed per 20 connected systems.',
      'One coordinator band is assumed per 40 active cases or 80 open workflow tasks.',
    ],
  };
}

export function operatingPressureStatus(input: OperatingPressureInput): ProductionReadinessStatus {
  if (input.pressure <= 0) return 'ready';
  if (input.bodyCode === 'dgsc') return 'watch';

  const stewardCapacity = Math.max(12, input.recommendedFte * 6);
  const domainCapacity = Math.max(12, input.dataDomains * 3);
  const qualityCapacity = Math.max(5, Math.ceil(input.governedAssets * 0.3));

  const threshold =
    input.bodyCode === 'dmo'
      ? stewardCapacity
      : input.bodyCode === 'domain_council'
        ? domainCapacity
        : input.bodyCode === 'data_council'
          ? qualityCapacity
          : 12;

  return input.pressure > threshold ? 'watch' : 'ready';
}

export function platformServiceStatus(input: PlatformServiceInput): ProductionReadinessStatus {
  if (!input.implemented) return 'blocked';
  if (input.wiredDependencies < input.requiredDependencies) return 'blocked';
  if (input.openRisks > 0 || input.dataSignals <= 0) return 'watch';
  return 'ready';
}

export function platformArchitectureStatus(statuses: ProductionReadinessStatus[]): ProductionReadinessStatus {
  return combineReadinessStatus(statuses);
}

export function enterpriseClosureStatus(input: EnterpriseClosureInput): ProductionReadinessStatus {
  if (!input.implemented && !input.acceptedDeferral) return 'blocked';
  if (input.openRisks > 0) return 'watch';
  if (input.evidenceSignals <= 0 || input.acceptedDeferral) return 'watch';
  return 'ready';
}
