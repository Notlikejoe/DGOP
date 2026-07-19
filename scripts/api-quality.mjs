import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'apps', 'api', 'src');
const testDir = join(root, 'apps', 'api', 'test');
const qaDir = join(root, 'QA');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file, out);
    else if (/\.controller\.ts$/u.test(name)) out.push(file);
  }
  return out;
}

function walkTypescript(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walkTypescript(file, out);
    else if (/\.ts$/u.test(name)) out.push(file);
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const mutatingMethods = new Set(['Post', 'Put', 'Patch', 'Delete']);
const routeDecorators = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);
const viewPermissionAllowlist = new Set([
  // Read-only calculations that use POST because the request body can be complex.
  'apps/api/src/audit-packs/audit-packs.controller.ts:readiness',
  'apps/api/src/integrations/integrations.controller.ts:previewCatalog',
  'apps/api/src/workflow/workflow.controller.ts:routePreview',
  // Self-service acknowledgement; service enforces assignee/role scope and writes audit.
  'apps/api/src/governance-operations/governance-operations.controller.ts:readNotification',
]);
const routeBlocks = [];
const methodOrClass = /^\s*(?:export\s+)?(?:abstract\s+)?(?:class\s+(?<className>[A-Za-z_$][\w$]*)|(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(?<method>[A-Za-z_$][\w$]*)\s*\()/u;
const topLevelDecorator = /^@(?<decorator>\w+)\b(?<args>[^\n]*)/u;
const methodDecorator = /^\s{2}@(?<decorator>\w+)\b(?<args>[^\n]*)/u;

for (const file of walk(srcDir)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  let controllerDecorators = [];
  let decorators = [];
  for (let index = 0; index < lines.length; index += 1) {
    const topDecorator = lines[index].match(topLevelDecorator);
    if (topDecorator) {
      controllerDecorators.push({ line: index + 1, name: topDecorator.groups.decorator, text: lines[index] });
      continue;
    }

    const methodDecoratorMatch = lines[index].match(methodDecorator);
    if (methodDecoratorMatch) {
      decorators.push({
        line: index + 1,
        name: methodDecoratorMatch.groups.decorator,
        text: lines[index],
      });
      continue;
    }

    const match = lines[index].match(methodOrClass);
    if (!match) continue;
    if (match.groups?.className) {
      decorators = [];
      continue;
    }
    if (decorators.length) {
      routeBlocks.push({
        file,
        methodLine: index + 1,
        method: match.groups?.method ?? 'unknown',
        controllerDecorators,
        decorators,
      });
      decorators = [];
    }
  }
}

const authorizationAllowlist = new Set([
  // Authenticated self-service routes. JwtAuthGuard still requires a valid user.
  'apps/api/src/auth/auth.controller.ts:me',
  'apps/api/src/auth/auth.controller.ts:logout',
  'apps/api/src/ownership/people.controller.ts:me',
]);
const publicRouteAllowlist = new Set([
  'apps/api/src/auth/auth.controller.ts:login',
  'apps/api/src/auth/auth.controller.ts:session',
  'apps/api/src/health/health.controller.ts:check',
  // External system ingress. The service validates x-dgop-webhook-token with timing-safe comparison.
  'apps/api/src/integrations/integrations.controller.ts:receiveWebhook',
]);

const unauthorisedDecision = [];
for (const block of routeBlocks) {
  const hasRoute = block.decorators.some((decorator) => routeDecorators.has(decorator.name));
  if (!hasRoute) continue;
  const allDecorators = [...block.controllerDecorators, ...block.decorators].map((decorator) => decorator.name);
  const hasAuthorizationDecision = allDecorators.some((name) =>
    ['Public', 'RequirePermissions', 'Roles'].includes(name),
  );
  const key = `${relative(root, block.file).replaceAll('\\', '/')}:${block.method}`;
  if (!hasAuthorizationDecision && !authorizationAllowlist.has(key)) {
    unauthorisedDecision.push(
      `${relative(root, block.file)}:${block.methodLine} ${block.method} has no explicit Public, RequirePermissions, or Roles decision`,
    );
  }
}

if (unauthorisedDecision.length) {
  fail(
    `API routes must make authorization explicit:\n${unauthorisedDecision.map((item) => `- ${item}`).join('\n')}`,
  );
}

const unexpectedPublicRoutes = [];
for (const block of routeBlocks) {
  const hasRoute = block.decorators.some((decorator) => routeDecorators.has(decorator.name));
  if (!hasRoute) continue;
  const allDecorators = [...block.controllerDecorators, ...block.decorators].map((decorator) => decorator.name);
  if (!allDecorators.includes('Public')) continue;
  const key = `${relative(root, block.file).replaceAll('\\', '/')}:${block.method}`;
  if (!publicRouteAllowlist.has(key)) {
    unexpectedPublicRoutes.push(`${relative(root, block.file)}:${block.methodLine} ${block.method}`);
  }
}

if (unexpectedPublicRoutes.length) {
  fail(
    `Public API routes must stay intentionally allowlisted:\n${unexpectedPublicRoutes.map((item) => `- ${item}`).join('\n')}`,
  );
}

const unsafe = [];
for (const block of routeBlocks) {
  const http = block.decorators.find((decorator) => mutatingMethods.has(decorator.name));
  if (!http) continue;
  const permissions = block.decorators
    .filter((decorator) => decorator.name === 'RequirePermissions')
    .flatMap((decorator) => [...decorator.text.matchAll(/['"]([^'"]+)['"]/gu)].map((match) => match[1]));
  if (permissions.length > 0 && permissions.every((permission) => permission.endsWith('.view'))) {
    const key = `${relative(root, block.file).replaceAll('\\', '/')}:${block.method}`;
    if (viewPermissionAllowlist.has(key)) continue;
    unsafe.push(
      `${relative(root, block.file)}:${http.line} ${http.name} ${block.method} uses only view permission(s): ${permissions.join(', ')}`,
    );
  }
}

if (unsafe.length) {
  fail(`Mutating API routes must not be protected only by view permissions:\n${unsafe.map((item) => `- ${item}`).join('\n')}`);
}

const seedPath = join(root, 'apps', 'api', 'prisma', 'seed.ts');
const seedText = readFileSync(seedPath, 'utf8');
const mojibakeArabicPattern = /[ØÙ][^\s'"}),.;:!?<>]*/u;
const mojibakeSeed = seedText.match(mojibakeArabicPattern);
if (mojibakeSeed) {
  const line = seedText.slice(0, mojibakeSeed.index).split(/\r?\n/u).length;
  fail(`Seed Arabic copy appears to contain mojibake/corrupted encoding at ${relative(root, seedPath)}:${line} (${mojibakeSeed[0]}).`);
}

const forbiddenSeedFallbacks = ['Admin@12345', 'Password@123'];
const leakedFallbacks = forbiddenSeedFallbacks.filter((secret) => seedText.includes(secret));
if (leakedFallbacks.length) {
  fail(`Seed data must not include fallback demo passwords: ${leakedFallbacks.join(', ')}`);
}
if (!seedText.includes('SEED_ADMIN_PASSWORD must be set') || !seedText.includes('SEED_PERSON_PASSWORD must be set')) {
  fail('Seed data must require SEED_ADMIN_PASSWORD and SEED_PERSON_PASSWORD instead of falling back to defaults.');
}

const dqConfigText = readFileSync(join(root, 'apps', 'api', 'src', 'data-quality', 'data-quality.config.ts'), 'utf8');
const dqControllerText = readFileSync(join(root, 'apps', 'api', 'src', 'data-quality', 'data-quality.controller.ts'), 'utf8');
const dqServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'data-quality', 'data-quality.service.ts'), 'utf8');
const ndiServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'ndi', 'ndi.service.ts'), 'utf8');
const queryFiltersText = readFileSync(join(root, 'apps', 'api', 'src', 'common', 'query-filters.ts'), 'utf8');
const dataSharingServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'data-sharing', 'data-sharing.service.ts'), 'utf8');
const privacyServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'privacy', 'privacy.service.ts'), 'utf8');
const foiServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'foi', 'foi.service.ts'), 'utf8');
const openDataServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'open-data', 'open-data.service.ts'), 'utf8');
const trainingServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'training', 'training.service.ts'), 'utf8');
const assetsServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'assets', 'assets.service.ts'), 'utf8');
const peopleServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'ownership', 'people.service.ts'), 'utf8');
const scoringControllerText = readFileSync(join(root, 'apps', 'api', 'src', 'scoring', 'scoring.controller.ts'), 'utf8');
const scoringServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'scoring', 'scoring.service.ts'), 'utf8');
const dashboardServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'dashboard', 'dashboard.service.ts'), 'utf8');
const auditPacksServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'audit-packs', 'audit-packs.service.ts'), 'utf8');
const businessValueServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'business-value', 'business-value.service.ts'), 'utf8');
const extendedDomainsServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'extended-domains', 'extended-domains.service.ts'), 'utf8');
const transparencyServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'transparency', 'transparency.service.ts'), 'utf8');
const reportsServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'reports', 'reports.service.ts'), 'utf8');
const securityGovernanceServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'security-governance', 'security-governance.service.ts'), 'utf8');
if (
  !dqConfigText.includes('isSafeDataQualityImportContent') ||
  !dqControllerText.includes('isSafeDataQualityImportContent(file.buffer)')
) {
  fail('Data Quality CSV file import must validate uploaded content before parsing/importing rows.');
}
if (
  !dqServiceText.includes('function parseFilterEnum') ||
  dqServiceText.includes('if (filters.status) and.push({ status: filters.status })') ||
  dqServiceText.includes('if (filters.severity) and.push({ severity: filters.severity })') ||
  dqServiceText.includes('if (filters.dimension) and.push({ dimension: filters.dimension })')
) {
  fail('Data Quality list filters must validate query enum values before passing them to Prisma.');
}
if (
  !ndiServiceText.includes('function filterEnum') ||
  ndiServiceText.includes('if (filters.type) and.push({ type: filters.type })') ||
  ndiServiceText.includes('if (filters.maturityLevel) and.push({ maturityLevel: filters.maturityLevel })') ||
  ndiServiceText.includes("if (filters.status === 'active')")
) {
  fail('NDI specification filters must validate type, maturity, and status query values before passing them to Prisma.');
}
if (!queryFiltersText.includes('export function parseQueryEnum') || !queryFiltersText.includes('BadRequestException')) {
  fail('Shared query enum filters must reject unknown values with BadRequestException before Prisma receives them.');
}
if (
  !dataSharingServiceText.includes('parseQueryEnum<DataSharingRequestStatus>') ||
  !dataSharingServiceText.includes('parseQueryEnum<DataSharingAgreementStatus>') ||
  dataSharingServiceText.includes('filters.status as DataSharingRequestStatus') ||
  dataSharingServiceText.includes('filters.status as DataSharingAgreementStatus')
) {
  fail('Data Sharing list status filters must validate query enum values before passing them to Prisma.');
}
if (
  !privacyServiceText.includes('parseQueryEnum<PrivacyWorkStatus>') ||
  !privacyServiceText.includes('parseQueryEnum<DsrRequestStatus>') ||
  !privacyServiceText.includes('parseQueryEnum<BreachStatus>') ||
  privacyServiceText.includes('filters.status as PrivacyWorkStatus') ||
  privacyServiceText.includes('filters.status as DsrRequestStatus') ||
  privacyServiceText.includes('filters.status as BreachStatus')
) {
  fail('Privacy list status filters must validate query enum values before passing them to Prisma.');
}
if (
  !foiServiceText.includes('parseQueryEnum<FoiRequestStatus>') ||
  !foiServiceText.includes('parseQueryEnum<FoiRequestChannel>') ||
  foiServiceText.includes('if (filters.status) clauses.push({ status: filters.status })') ||
  foiServiceText.includes('if (filters.channel) clauses.push({ channel: filters.channel })')
) {
  fail('FOI list status and channel filters must validate query enum values before passing them to Prisma.');
}
if (
  !foiServiceText.includes('visibleRequestBranches') ||
  !foiServiceText.includes('dataDomainId: { in: scope.domains }') ||
  foiServiceText.includes('if (assetIds.size === 0) return { deletedAt: null, assetId: null }') ||
  foiServiceText.includes('OR: [{ assetId: { in: [...assetIds] } }, { assetId: null }]') ||
  foiServiceText.includes('overdueRows, dueSoonRows')
) {
  fail('FOI scoped reads must not expose unanchored requests to restricted users and summary must avoid duplicate SLA row reads.');
}
if (
  !dqServiceText.includes("issueScopeWhere(assetIds: Set<string> | 'all', actorEmail?: string)") ||
  !dqServiceText.includes('createdBy: actorEmail') ||
  !dqControllerText.includes('this.service.summary(user.roles, user.email)') ||
  !dqControllerText.includes('this.service.list(user.roles, { search, status, severity, dimension, assetId }, page, pageSize, user.email)') ||
  dqServiceText.includes('return { OR: [{ assetId: null }, { assetId: { in: [...assetIds] } }] };')
) {
  fail('Data Quality issue reads must not expose every unlinked issue to scoped users; only visible assets and the actor own unlinked issues are allowed.');
}
if (
  !securityGovernanceServiceText.includes('assetClassificationScope') ||
  !securityGovernanceServiceText.includes('assetDomainClassificationScope') ||
  !securityGovernanceServiceText.includes('__no_visible_security_records__') ||
  !securityGovernanceServiceText.includes('__no_visible_access_review_items__') ||
  securityGovernanceServiceText.includes('return { OR: [{ assetId: null }, { assetId: { in: [...assetIds] } }] };') ||
  securityGovernanceServiceText.includes("if (assetIds !== 'all') and.push({ OR: [{ assetId: null }, { assetId: { in: [...assetIds] } }] });")
) {
  fail('Security Governance reads must not expose every unlinked security record to scoped users; unlinked records need a domain/classification anchor or fail-closed scope.');
}
for (const [label, text] of [
  ['Transparency cockpit', transparencyServiceText],
  ['Reports service', reportsServiceText],
]) {
  if (
    !text.includes('foiBranches') ||
    !text.includes('dataDomainId: { in: scope.domains }') ||
    text.includes('if (assetIds.size === 0) return { deletedAt: null, assetId: null }') ||
    text.includes('OR: [{ assetId: { in: [...assetIds] } }, { assetId: null }]')
  ) {
    fail(`${label} FOI rollups must use the same scoped FOI visibility rule as the FOI service.`);
  }
}
if (
  !transparencyServiceText.includes('workflowCaseScopeWhere') ||
  !transparencyServiceText.includes('workflowTaskOwnershipWhere') ||
  !transparencyServiceText.includes("createdBy: user.email") ||
  !transparencyServiceText.includes('assigneeUserId: user.id') ||
  !transparencyServiceText.includes("where: { AND: [{ type: { in: TRANSPARENCY_CASE_TYPES } }, caseScope] }") ||
  transparencyServiceText.includes("where: { type: { in: TRANSPARENCY_CASE_TYPES } }")
) {
  fail('Transparency workflow cockpit rollups must apply workflow case data-scope and unanchored ownership/task visibility.');
}
if (
  !openDataServiceText.includes('parseQueryEnum<OpenDataCandidateStatus>') ||
  openDataServiceText.includes('if (filters.status) and.push({ status: filters.status })')
) {
  fail('Open Data candidate status filters must validate query enum values before passing them to Prisma.');
}
if (
  !trainingServiceText.includes('parseQueryEnum<TrainingAssignmentStatus>') ||
  trainingServiceText.includes("where['status'] = filters.status")
) {
  fail('Training assignment status filters must validate query enum values before passing them to Prisma.');
}
const unboundedTrainingLegacyReads = [
  'rows = await this.prisma.trainingAssignment.findMany(query)',
  ': [await this.prisma.certificationAttempt.findMany(query), 0]',
  'return this.prisma.continuingEducationActivity.findMany(query)',
  'return this.prisma.communityArticle.findMany(query)',
  'return this.prisma.expertProfile.findMany(query)',
  'return this.prisma.mentorshipPair.findMany(query)',
].filter((snippet) => trainingServiceText.includes(snippet));
if (!trainingServiceText.includes('boundedFirstPageParams') || unboundedTrainingLegacyReads.length) {
  fail(
    `Training legacy array list endpoints must keep a bounded default database read:\n${unboundedTrainingLegacyReads
      .map((snippet) => `- ${snippet}`)
      .join('\n')}`,
  );
}
if (
  !assetsServiceText.includes('parseQueryEnum(filters.ownerStatus') ||
  !assetsServiceText.includes('parseQueryEnum(filters.lifecycleStatus') ||
  assetsServiceText.includes('and.push({ ownerStatus: filters.ownerStatus })') ||
  assetsServiceText.includes('and.push({ lifecycleStatus: filters.lifecycleStatus })')
) {
  fail('Asset owner and lifecycle filters must validate query values before passing them to Prisma.');
}
if (
  !peopleServiceText.includes('boundedFirstPageParams(pageSize)') ||
  peopleServiceText.includes('return this.prisma.person.findMany({\n        where,\n        include: userInclude,\n        orderBy: { fullNameEn: \'asc\' },\n      })')
) {
  fail('People Directory legacy array list must keep a bounded default database read.');
}
if (
  !scoringControllerText.includes('@CurrentUser() user: AuthUser') ||
  !scoringControllerText.includes('this.service.readiness(user)') ||
  !scoringServiceText.includes('BROAD_SCORING_ROLES') ||
  !scoringServiceText.includes('specVisibilityWhere') ||
  !scoringServiceText.includes('parseQueryEnum<GapType>') ||
  scoringServiceText.includes('async readiness():') ||
  scoringServiceText.includes('async domainDetail(domainId: string)') ||
  scoringServiceText.includes('async gaps(filter?')
) {
  fail('NDI scoring endpoints must be user-aware, scoped by evidence responsibility, and validate gap-type query filters.');
}
if (
  !dashboardServiceText.includes('this.scoring.readiness(user)') ||
  dashboardServiceText.includes('this.scoring.readiness()') ||
  dashboardServiceText.includes('this.prisma.ndiSpecification.count({ where: { deletedAt: null, isActive: true } })')
) {
  fail('Dashboard NDI tiles must reuse user-aware scoring instead of global NDI counts.');
}
if (
  !auditPacksServiceText.includes('BROAD_AUDIT_PACK_ROLES') ||
  !auditPacksServiceText.includes('this.scoring.readiness(actor)') ||
  !auditPacksServiceText.includes('this.scoring.gaps(actor') ||
  !auditPacksServiceText.includes('requestedBy: actor.email') ||
  !auditPacksServiceText.includes('specVisibilityWhere') ||
  auditPacksServiceText.includes('this.scoring.readiness()') ||
  auditPacksServiceText.includes('this.scoring.domainDetail(domainId)') ||
  auditPacksServiceText.includes('where: { deletedAt: null, isActive: true, ...(domainId ? { domainId } : {}) }')
) {
  fail('NDI audit packs must scope previews, listed packs, exports, specifications, evidence, and scoring to the actor unless the actor has broad audit-pack access.');
}
const requiredBusinessValueGuardrails = [
  'FINAL_GLOSSARY_STATUSES',
  'FINAL_LIFECYCLE_STATUSES',
  'Glossary term creators cannot make the final review decision',
  'Lineage maps need a visible asset or domain',
  'Lineage creators cannot verify their own lineage map',
  'Lifecycle decision creators cannot approve or reject their own decision',
  'const row = await this.prisma.$transaction(async (tx) => {',
  'await tx.dataAssetValuation.update',
];
const missingBusinessValueGuardrails = requiredBusinessValueGuardrails.filter(
  (phrase) => !businessValueServiceText.includes(phrase),
);
if (missingBusinessValueGuardrails.length) {
  fail(
    `Business Value engine must preserve scoped anchoring, SoD, and transactional survey rollups:\n${missingBusinessValueGuardrails
      .map((phrase) => `- ${phrase}`)
      .join('\n')}`,
  );
}
const requiredExtendedDomainGuardrails = [
  'FINAL_REFERENCE_DECISIONS',
  'MDM match creators cannot make the final resolution decision',
  'Reference version creators cannot make the final decision',
  'Metadata certification creators cannot certify their own metadata',
  'Architecture review creators cannot make the final decision',
];
const missingExtendedDomainGuardrails = requiredExtendedDomainGuardrails.filter(
  (phrase) => !extendedDomainsServiceText.includes(phrase),
);
if (missingExtendedDomainGuardrails.length) {
  fail(
    `Extended Domain engine must preserve final-decision segregation of duties:\n${missingExtendedDomainGuardrails
      .map((phrase) => `- ${phrase}`)
      .join('\n')}`,
  );
}
const integrationsControllerText = readFileSync(join(root, 'apps', 'api', 'src', 'integrations', 'integrations.controller.ts'), 'utf8');
const integrationsServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'integrations', 'integrations.service.ts'), 'utf8');
const integrationsDtoText = readFileSync(join(root, 'apps', 'api', 'src', 'integrations', 'integrations.dto.ts'), 'utf8');
const integrationsLogicText = readFileSync(join(root, 'apps', 'api', 'src', 'integrations', 'integrations.logic.ts'), 'utf8');
if (
  !integrationsControllerText.includes("@Headers('x-dgop-webhook-token')") ||
  !integrationsServiceText.includes('webhookTokenIsValid') ||
  !integrationsServiceText.includes('timingSafeEqual')
) {
  fail('Public integration webhooks must require x-dgop-webhook-token and timing-safe token validation.');
}
if (
  !integrationsServiceText.includes('redactSensitiveJson(rawPayload)') ||
  integrationsServiceText.includes('payloadJson: rawPayload as Prisma.InputJsonValue') ||
  integrationsServiceText.includes('payloadJson: dto.payload as Prisma.InputJsonValue')
) {
  fail('Public integration webhook payloads must be redacted before persistence, normalization, and dedupe processing.');
}
if (
  !integrationsDtoText.includes('INTEGRATION_ADAPTERS') ||
  !integrationsLogicText.includes('adapterMatchesConnectorType') ||
  !integrationsLogicText.includes('compatibleAdaptersForConnectorType') ||
  !integrationsLogicText.includes('mock_siem') ||
  !integrationsLogicText.includes('mock_iam_sso') ||
  !integrationsLogicText.includes("code: 'IAM-SSO-MOCK'") ||
  !integrationsLogicText.includes("type: 'iam_sso'") ||
  !integrationsServiceText.includes('adapterMatchesConnectorType(type, adapterType)')
) {
  fail('Integration connector creation must keep adapter allowlists, IAM/SSO default coverage, and type/adapter compatibility enforced by pure engine logic.');
}
const integrationReadBootstrapPattern =
  /async\s+(?:summary|connectors)\s*\([^)]*\)\s*\{[\s\S]{0,500}?(?:ensureDefaultMockConnectors|resolveCatalogConnector\s*\(\s*null)/u;
if (
  integrationReadBootstrapPattern.test(integrationsServiceText) ||
  !integrationsServiceText.includes('implements OnModuleInit') ||
  !integrationsServiceText.includes('ensureDefaultIntegrationRegistry')
) {
  fail('Integration default connector bootstrap must run outside GET/read endpoints so summary/connectors remain read-only.');
}
const workflowServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'workflow', 'workflow.service.ts'), 'utf8');
const workflowControllerText = readFileSync(join(root, 'apps', 'api', 'src', 'workflow', 'workflow.controller.ts'), 'utf8');
const workflowSpecText = readFileSync(join(root, 'apps', 'api', 'test', 'workflow.service.spec.ts'), 'utf8');
const workflowReadBootstrapPattern =
  /async\s+(?:graph|configuration|caseManagement)\s*\([^)]*\)\s*\{[\s\S]{0,500}?ensureDefaultTemplates\s*\(/u;
if (
  workflowReadBootstrapPattern.test(workflowServiceText) ||
  !workflowServiceText.includes('implements OnModuleInit') ||
  !workflowServiceText.includes('async onModuleInit(): Promise<void>')
) {
  fail('Workflow route-template bootstrap must run outside GET/read endpoints so graph/configuration/case-management remain read-only.');
}
if (
  !workflowServiceText.includes('workflowTaskActorVisibility(') ||
  !workflowServiceText.includes('workflowCaseActorVisibility(') ||
  !workflowServiceText.includes('const actorVisibility = this.workflowCaseActorVisibility(roleCodes, actor);') ||
  !workflowServiceText.includes('await this.assertCaseVisible(roleCodes, existing, viewer ?? actor);') ||
  !workflowServiceText.includes('await this.assertCaseVisible(user.roles, task.case, user);') ||
  workflowServiceText.includes('if (!wfCase.assetId) return;') ||
  !workflowControllerText.includes('this.service.updateCase(id, dto, user.roles, user.email, user)') ||
  !workflowControllerText.includes('this.service.submitCase(id, user.roles, user.email, user)') ||
  !workflowControllerText.includes('this.service.addTask(id, dto, user.roles, user.email, user)') ||
  !workflowControllerText.includes('this.service.getTask(id, user.roles, user)') ||
  !workflowControllerText.includes('this.service.updateTask(id, dto, user.roles, user.email, user)') ||
  !workflowSpecText.includes('updateCase: hides unanchored cases unless actor created or owns the route') ||
  !workflowSpecText.includes('updateTask: hides tasks on unanchored cases outside actor visibility')
) {
  fail('Workflow case/task writes must keep actor-aware visibility for unanchored cases and regression tests for scope bypasses.');
}
const governanceOperationsServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'governance-operations', 'governance-operations.service.ts'), 'utf8');
const governanceReadBootstrapPattern =
  /async\s+workspace\s*\([^)]*\)\s*\{[\s\S]{0,500}?ensureDefaultCalendarTemplates\s*\(/u;
if (
  governanceReadBootstrapPattern.test(governanceOperationsServiceText) ||
  !governanceOperationsServiceText.includes('async onModuleInit(): Promise<void>') ||
  !governanceOperationsServiceText.includes('await this.ensureDefaultCalendarTemplates();')
) {
  fail('Governance operations calendar bootstrap must run outside GET/read endpoints so workspace remains read-only.');
}
if (
  !governanceOperationsServiceText.includes("dataQualityIssueScopeWhere(assetIds: Set<string> | 'all', actorEmail?: string)") ||
  !governanceOperationsServiceText.includes('createdBy: actorEmail') ||
  !governanceOperationsServiceText.includes('this.dataQualityIssueScopeWhere(assetIds, user.email)') ||
  governanceOperationsServiceText.includes('OR: [{ assetId: null }, { assetId: { in: [...assetIds] } }]') ||
  governanceOperationsServiceText.includes(': { assetId: null };')
) {
  fail('Governance Operations DQ rollups must not expose every unlinked data-quality issue to scoped users.');
}
if (
  !governanceOperationsServiceText.includes('workflowLinkScopeWhere') ||
  !governanceOperationsServiceText.includes('notificationVisibilityWhere') ||
  !governanceOperationsServiceText.includes('workflowLinkedEscalationScopeWhere') ||
  !governanceOperationsServiceText.includes('this.notificationVisibilityWhere(assetIds, user)') ||
  !governanceOperationsServiceText.includes('occurrences: {') ||
  !governanceOperationsServiceText.includes('where: { OR: [{ workflowCase: caseWhere }, { workflowCaseId: null }] }') ||
  governanceOperationsServiceText.includes('governanceEscalation.findUnique({ where: { id } })')
) {
  fail('Governance Operations notifications, escalations, and nested calendar occurrences must be scoped by linked workflow case/task visibility.');
}
const evidenceServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'evidence', 'evidence.service.ts'), 'utf8');
if (
  !evidenceServiceText.includes('private storagePath') ||
  !evidenceServiceText.includes('relative(this.storageDir, target)') ||
  !evidenceServiceText.includes("throw new NotFoundException('evidence file not found')") ||
  evidenceServiceText.includes('join(this.storageDir, e.fileName)')
) {
  fail('Evidence file download/delete paths must resolve inside the configured evidence storage directory and fail closed.');
}
const searchServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'search', 'search.service.ts'), 'utf8');
if (
  !searchServiceText.includes('private async ndiSpecVisibilityWhere') ||
  !searchServiceText.includes('this.searchNdi(query, limit, scope, user)') ||
  !searchServiceText.includes('ownerPersonId') ||
  !searchServiceText.includes('submittedBy: user.email') ||
  !searchServiceText.includes('reviewedBy: user.email')
) {
  fail('Global search must keep NDI specification results constrained to actor ownership/review/submission responsibility.');
}
if (
  !searchServiceText.includes('dataQualityIssueScopeWhere') ||
  !searchServiceText.includes('createdBy: user.email') ||
  !searchServiceText.includes('foiScopeWhere') ||
  !searchServiceText.includes('dataDomainId: { in: scope.domains }') ||
  searchServiceText.includes('this.assetLinkedWhere(assetIds, true)')
) {
  fail('Global search must reuse actor/domain-aware scope for Data Quality and FOI instead of exposing all unlinked records.');
}
const accessServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'access', 'access.service.ts'), 'utf8');
const scopeServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'access', 'scope.service.ts'), 'utf8');
if (
  accessServiceText.includes("roleCodes.includes('system_admin')") ||
  !accessServiceText.includes("where: { code: { in: roleCodes }, isActive: true, deletedAt: null }") ||
  !accessServiceText.includes("activeRoles.some((role) => role.code === 'system_admin')")
) {
  fail('AccessService must resolve active role rows before granting system_admin wildcard permissions.');
}
if (
  integrationsServiceText.includes("roleCodes.includes('system_admin') || roleCodes.includes('dmo_admin')") ||
  !integrationsServiceText.includes("where: { code: { in: adminRoleCodes }, isActive: true, deletedAt: null }") ||
  !integrationsServiceText.includes('const adminRoleCodes = roleCodes.filter')
) {
  fail('Catalog synchronization admin bypass must verify active system_admin/dmo_admin role rows before skipping scope validation.');
}
if (
  integrationsControllerText.includes('Number(limit)') ||
  !integrationsServiceText.includes('function boundedIntegrationLimit') ||
  integrationsServiceText.includes('Math.min(Math.max(limit, 1), 100)')
) {
  fail('Integration list endpoints must pass raw query limits to a finite service-side clamp before Prisma receives take.');
}
if (
  /async\s+resolve\s*\([^)]*\)\s*\{[\s\S]{0,250}?roleCodes\.includes\(['"]system_admin['"]\)/u.test(scopeServiceText) ||
  !scopeServiceText.includes('where: { code: { in: roleCodes }, isActive: true, deletedAt: null }')
) {
  fail('ScopeService must resolve active role rows before granting unrestricted system-role scope.');
}
const rolesServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'roles', 'roles.service.ts'), 'utf8');
if (
  !rolesServiceText.includes("role.code === 'system_admin'") ||
  !rolesServiceText.includes('system_admin role is immutable') ||
  !rolesServiceText.includes('System roles cannot be deactivated') ||
  !rolesServiceText.includes('Unknown or inactive scope references') ||
  !rolesServiceText.includes('where: { user: { isActive: true } }') ||
  !rolesServiceText.includes('userCount: r.userRoles.length')
) {
  fail('Role administration must keep system-admin immutability, system-role activation protection, active-user counts, and scope-reference validation.');
}
const auditLogicText = readFileSync(join(root, 'apps', 'api', 'src', 'audit', 'audit.logic.ts'), 'utf8');
const auditServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'audit', 'audit.service.ts'), 'utf8');
const sensitiveJsonText = readFileSync(join(root, 'apps', 'api', 'src', 'common', 'sensitive-json.ts'), 'utf8');
if (
  !auditLogicText.includes('sanitizeAuditMetadata') ||
  !auditLogicText.includes('redactSensitiveJson') ||
  !sensitiveJsonText.includes('SENSITIVE_JSON_KEY_FRAGMENTS') ||
  !sensitiveJsonText.includes('REDACTED_VALUE') ||
  !auditServiceText.includes('const metadata = sanitizeAuditMetadata(entry.metadata ?? null)') ||
  auditServiceText.includes('metadata: (entry.metadata ?? undefined)')
) {
  fail('Audit log metadata must be centrally sanitized before hashing and persistence.');
}
const reportsLogicText = readFileSync(join(root, 'apps', 'api', 'src', 'reports', 'reports.logic.ts'), 'utf8');
const reportsControllerText = readFileSync(join(root, 'apps', 'api', 'src', 'reports', 'reports.controller.ts'), 'utf8');
const auditPacksControllerText = readFileSync(join(root, 'apps', 'api', 'src', 'audit-packs', 'audit-packs.controller.ts'), 'utf8');
const auditPacksLogicText = readFileSync(join(root, 'apps', 'api', 'src', 'audit-packs', 'audit-packs.logic.ts'), 'utf8');
const evidenceControllerText = readFileSync(join(root, 'apps', 'api', 'src', 'evidence', 'evidence.controller.ts'), 'utf8');
const downloadText = readFileSync(join(root, 'apps', 'api', 'src', 'common', 'download.ts'), 'utf8');
if (
  !reportsLogicText.includes('neutralizeSpreadsheetFormula') ||
  !reportsLogicText.includes('/^[=+\\-@\\t\\r\\n]|\\s+[=+\\-@]/u') ||
  !reportsLogicText.includes("typeof value === 'string' ? neutralizeSpreadsheetFormula(value) : String(value)")
) {
  fail('Report CSV exports must neutralize spreadsheet formula text before writing downloadable CSV files.');
}
if (
  !downloadText.includes('sanitizeAttachmentFilename') ||
  !downloadText.includes('contentDispositionAttachment') ||
  !reportsControllerText.includes('contentDispositionAttachment(file.filename)') ||
  !auditPacksControllerText.includes('contentDispositionAttachment(file.filename)') ||
  !evidenceControllerText.includes("sanitizeAttachmentFilename(originalName, 'evidence-file')")
) {
  fail('Download endpoints must use the shared safe attachment filename helper instead of hand-rolled Content-Disposition headers.');
}
if (
  !auditPacksLogicText.includes('safeZipEntryPath') ||
  !auditPacksLogicText.includes('UNSAFE_ZIP_PATH_CHARS') ||
  !auditPacksLogicText.includes("throw new Error('unsafe audit pack file path')") ||
  auditPacksLogicText.includes('function normalizePath')
) {
  fail('Audit pack ZIP exports must reject unsafe archive entry paths instead of only normalizing file names.');
}
const usersDtoText = readFileSync(join(root, 'apps', 'api', 'src', 'users', 'users.dto.ts'), 'utf8');
if (!usersDtoText.includes('USER_PASSWORD_MIN_LENGTH = 12') || usersDtoText.includes('MinLength(8)')) {
  fail('User create/reset passwords must require at least 12 characters.');
}
const mainText = readFileSync(join(root, 'apps', 'api', 'src', 'main.ts'), 'utf8');
const runtimeSafetyText = readFileSync(join(root, 'apps', 'api', 'src', 'common', 'runtime-safety.ts'), 'utf8');
const authModuleText = readFileSync(join(root, 'apps', 'api', 'src', 'auth', 'auth.module.ts'), 'utf8');
const authCookieText = readFileSync(join(root, 'apps', 'api', 'src', 'auth', 'auth-cookie.ts'), 'utf8');
const authServiceText = readFileSync(join(root, 'apps', 'api', 'src', 'auth', 'auth.service.ts'), 'utf8');
if (
  !mainText.includes('READ_ONLY_METHODS') ||
  !mainText.includes('skip: (req) => READ_ONLY_METHODS.has(req.method.toUpperCase())') ||
  !mainText.includes('max: 120')
) {
  fail('API runtime must include a stricter rate limiter for mutating routes in addition to login and broad API limits.');
}
if (
  !mainText.includes('assertSafeRuntimeConfig();') ||
  !mainText.includes('helmet({') ||
  !mainText.includes('contentSecurityPolicy: strictConfig') ||
  !mainText.includes("scriptSrc: [\"'self'\"]") ||
  !mainText.includes("baseUri: [\"'self'\"]") ||
  !mainText.includes("formAction: [\"'self'\"]") ||
  !mainText.includes("frameAncestors: [\"'none'\"]") ||
  !mainText.includes("instance.set('trust proxy', 1)") ||
  !mainText.includes('app.enableCors({ origin: corsOrigins, credentials: true })')
) {
  fail('API runtime must keep strict runtime validation, Helmet CSP/frame protections, trusted proxy handling, and credentialed allowlisted CORS enabled.');
}
if (
  !mainText.includes("app.use(\n    '/api/auth/login'") ||
  !mainText.includes('windowMs: 15 * 60_000') ||
  !mainText.includes('skipSuccessfulRequests: true')
) {
  fail('API runtime must rate-limit login attempts separately while allowing successful demo logins to continue.');
}
if (
  !authModuleText.includes('jwtDurationSeconds') ||
  authModuleText.includes('as unknown as number') ||
  !authCookieText.includes('jwtDurationMs')
) {
  fail('JWT signing and auth cookie expiry must use the shared JWT duration parser.');
}
if (authServiceText.includes('Could not write login audit event') || !authServiceText.includes("action: 'auth.login.success'")) {
  fail('Successful login must not swallow auth.login.success audit write failures.');
}
if (
  !runtimeSafetyText.includes('SEED_PERSON_PASSWORD') ||
  !authServiceText.includes('isUnsafeDemoPassword(password)') ||
  !authServiceText.includes("reason: 'unsafe_demo_credential'")
) {
  fail('Strict runtime/login safety must reject known unsafe seeded demo passwords for every demo account, not only admin.');
}

const readme = readFileSync(join(root, 'README.md'), 'utf8');
const enterpriseReadinessText = readFileSync(join(root, 'QA', 'ENTERPRISE_READINESS_0_43.md'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');
const apiPackageJson = readFileSync(join(root, 'apps', 'api', 'package.json'), 'utf8');
if (!readme.includes('npm run demo:prepare') || !readme.includes('npm run qa:api') || !readme.includes('npm run qa:ui') || !readme.includes('npm run qa`')) {
  fail('README must document demo credential preparation and the full QA commands.');
}
const requiredEnterpriseCaveats = [
  'suitable for local demo and UAT-style walkthrough',
  'Production deployment still requires environment-specific controls',
  'production secret manager or vault binding',
  'SIEM/log drain and retention policy',
  'database backup, restore, DR test, and RTO/RPO sign-off',
  'production load testing at the target data volumes',
  'Accepted Deferrals',
];
const missingEnterpriseCaveats = requiredEnterpriseCaveats.filter((phrase) => !enterpriseReadinessText.includes(phrase));
if (missingEnterpriseCaveats.length) {
  fail(
    `Enterprise readiness close-out must preserve demo/UAT-vs-production caveats:\n${missingEnterpriseCaveats.map((phrase) => `- ${phrase}`).join('\n')}`,
  );
}
if (!readme.includes('QA/ENTERPRISE_READINESS_0_43.md') || !readme.includes('production caveats')) {
  fail('README must link the Sprint 0-43 enterprise readiness close-out and production caveats.');
}
if (!packageJson.includes('"publish:external": "node scripts/publish.mjs"') || !packageJson.includes('"publish:external:dry-run": "node scripts/publish.mjs --dry-run"')) {
  fail('publish:external must use the cross-platform Node publisher with demo safeguards.');
}
if (!packageJson.includes('"qa:release": "node scripts/qa-release.mjs"')) {
  fail('package.json must expose qa:release for full release verification.');
}
const publisherText = readFileSync(join(root, 'scripts', 'publish.mjs'), 'utf8');
if (!publisherText.includes("['run', 'qa:release']")) {
  fail('publish:external must run qa:release before opening an external tunnel.');
}
if (publisherText.includes('DGOP_SKIP_UI_SMOKE') || publisherText.includes('skipUiSmoke')) {
  fail('publish:external must not allow skipping the authenticated UI smoke before opening an external tunnel.');
}
if (!publisherText.includes("['run', 'qa:ui']")) {
  fail('publish:external must run the authenticated UI smoke against the production-style local server before opening a tunnel.');
}
const healthControllerText = readFileSync(join(root, 'apps', 'api', 'src', 'health', 'health.controller.ts'), 'utf8');
const startDemoText = readFileSync(join(root, 'scripts', 'start-demo.mjs'), 'utf8');
if (
  !runtimeSafetyText.includes('must use HTTPS in strict runtime') ||
  !runtimeSafetyText.includes('LOOPBACK_HOSTS') ||
  !startDemoText.includes('originIsSafe') ||
  !startDemoText.includes('LOOPBACK_HOSTS')
) {
  fail('Strict runtime and start:demo must reject non-HTTPS external origins while allowing loopback HTTP.');
}
if (!healthControllerText.includes('database:') || !healthControllerText.includes('status: dbStatus')) {
  fail('Health check must always expose database.status so release smoke tests prove database connectivity without leaking details.');
}
if (!startDemoText.includes("requireEnv('SEED_PERSON_PASSWORD', isSafePassword)")) {
  fail('start:demo must require a rotated SEED_PERSON_PASSWORD before serving production-style demos.');
}
const qaReleaseText = readFileSync(join(root, 'scripts', 'qa-release.mjs'), 'utf8');
if (!qaReleaseText.includes("['run', 'db:generate']") || !qaReleaseText.includes("['diff', '--check']")) {
  fail('qa:release must regenerate the Prisma client and run git diff --check before a production build.');
}
if (!qaReleaseText.includes('assertDemoApiIsStopped') || !qaReleaseText.includes('/api/health')) {
  fail('qa:release must fail fast if the DGOP API is already running before Prisma client generation.');
}
const dbScriptText = readFileSync(join(root, 'scripts', 'db.mjs'), 'utf8');
if (
  !dbScriptText.includes("['--no-install', 'prisma', 'generate']") ||
  !dbScriptText.includes("['--no-install', 'prisma', 'migrate', 'status']") ||
  !qaReleaseText.includes("['--no-install', 'prisma', 'validate']") ||
  !qaReleaseText.includes("['--no-install', 'prisma', 'migrate', 'status']")
) {
  fail('DB and release scripts must use local pinned Prisma via npx --no-install to prevent major-version drift.');
}
const missingApiSpecs = readdirSync(testDir)
  .filter((name) => /\.spec\.ts$/u.test(name))
  .filter((name) => !apiPackageJson.includes(`test/${name}`));
if (missingApiSpecs.length) {
  fail(
    `Every API spec file must be included in apps/api/package.json test script:\n${missingApiSpecs.map((name) => `- ${name}`).join('\n')}`,
  );
}

const qaFiles = [];
function walkMarkdown(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walkMarkdown(file, out);
    else if (/\.md$/u.test(name)) out.push(file);
  }
  return out;
}
walkMarkdown(qaDir, qaFiles);
const staleQaPlaceholders = qaFiles.flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/\bplaceholder\b/giu)].map((match) => {
    const line = text.slice(0, match.index).split(/\r?\n/u).length;
    return `${relative(root, file)}:${line}`;
  });
});
if (staleQaPlaceholders.length) {
  fail(
    `QA sprint documents must describe implemented behavior, not placeholder behavior:\n${staleQaPlaceholders.map((item) => `- ${item}`).join('\n')}`,
  );
}

const destructiveAllowlist = new Set([
  // Relationship/junction replacement rows; parent entities remain governed and writes are audited.
  'apps/api/src/assets/assets.service.ts:assetSubject.deleteMany',
  'apps/api/src/assets/assets.service.ts:assetRelationship.delete',
  'apps/api/src/users/users.service.ts:userRole.deleteMany',
  'apps/api/src/roles/roles.service.ts:rolePermission.deleteMany',
  'apps/api/src/roles/roles.service.ts:roleDataScope.deleteMany',
  'apps/api/src/master-data/raci-templates.service.ts:raciTemplateItem.deleteMany',
  // Training requirement is a role/course policy link and deletion is audited.
  'apps/api/src/training/training.service.ts:trainingRequirement.delete',
]);
const rawSqlAllowlist = new Set([
  // Health probe and PostgreSQL advisory lock for singleton scheduler execution.
  'apps/api/src/health/health.controller.ts:$queryRaw',
  'apps/api/src/governance-operations/governance-operations.service.ts:$queryRaw',
  'apps/api/src/governance-operations/governance-operations.service.ts:$executeRaw',
]);
const destructiveFindings = [];
const rawSqlFindings = [];
for (const file of walkTypescript(srcDir, [])) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\b(?:this\.)?(?:prisma|tx)\.(?<model>\w+)\.(?<operation>deleteMany|delete)\s*\(/gu)) {
    const key = `${rel}:${match.groups.model}.${match.groups.operation}`;
    if (!destructiveAllowlist.has(key)) destructiveFindings.push(key);
  }
  for (const match of text.matchAll(/\b\$queryRaw\b|\b\$executeRaw\b/gu)) {
    const key = `${rel}:${match[0]}`;
    if (!rawSqlAllowlist.has(key)) rawSqlFindings.push(key);
  }
}
if (destructiveFindings.length) {
  fail(
    `Hard deletes must be explicitly reviewed and allowlisted:\n${[...new Set(destructiveFindings)].map((item) => `- ${item}`).join('\n')}`,
  );
}
if (rawSqlFindings.length) {
  fail(
    `Raw SQL must be explicitly reviewed and allowlisted:\n${[...new Set(rawSqlFindings)].map((item) => `- ${item}`).join('\n')}`,
  );
}

if (!process.exitCode) {
  console.log(`API quality checks passed: ${routeBlocks.length} controller route blocks inspected.`);
} else {
  console.error(`API quality checks failed under ${relative(root, srcDir)}.`);
}
