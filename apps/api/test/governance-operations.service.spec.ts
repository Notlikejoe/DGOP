import assert from 'node:assert/strict';
import {
  GovernanceEscalationLevel,
  GovernanceEscalationStatus,
  GovernanceNotificationSeverity,
} from '@prisma/client';
import { GovernanceOperationsService } from '../src/governance-operations/governance-operations.service';
import {
  CHARTER_LIFECYCLE_STEPS,
  EXECUTIVE_KPI_DEFINITIONS,
  ERROR_EXPERIENCE_DEFINITIONS,
  PLATFORM_SERVICE_DEFINITIONS,
  PRODUCTION_ACCEPTANCE_DEFINITIONS,
  SECURITY_CONTROL_CROSSWALK_DEFINITIONS,
  addKsaBusinessDays,
  backlogStatus,
  businessDaysBetween,
  combineReadinessStatus,
  dgpoSizingGuidance,
  escalationLevel,
  escalationPenalty,
  enterpriseClosureStatus,
  issueRatioStatus,
  isKsaBusinessDay,
  kpiTraceabilityStatus,
  ksaSlaSignal,
  lifecycleReadiness,
  notificationSeverity,
  operatingDefinitionStatus,
  platformArchitectureStatus,
  platformServiceStatus,
} from '../src/governance-operations/governance-operations.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('KSA business days skip Friday, Saturday, and configured holidays', () => {
  const friday = new Date('2026-07-17T12:00:00Z');
  const sundayHoliday = new Date('2026-07-19T12:00:00Z');
  assert.equal(isKsaBusinessDay(friday), false);
  assert.equal(isKsaBusinessDay(sundayHoliday, ['2026-07-19']), false);
  assert.equal(isKsaBusinessDay(new Date('2026-07-20T12:00:00Z')), true);
});

test('addKsaBusinessDays lands on the next available working date', () => {
  const start = new Date('2026-07-16T12:00:00Z');
  const due = addKsaBusinessDays(start, 1);
  assert.equal(due.toISOString().slice(0, 10), '2026-07-19');
});

test('business day distance drives SLA signals', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  assert.equal(ksaSlaSignal({ status: 'pending', dueDate: new Date('2026-07-16T12:00:00Z') }, now), 'at_risk');
  assert.equal(ksaSlaSignal({ status: 'pending', dueDate: new Date('2026-07-27T12:00:00Z') }, now), 'on_track');
  assert.equal(ksaSlaSignal({ status: 'pending', dueDate: new Date('2026-07-12T12:00:00Z') }, now), 'overdue');
  assert.equal(businessDaysBetween(new Date('2026-07-12T12:00:00Z'), now), 2);
});

test('overdue days map to four escalation councils', () => {
  assert.equal(escalationLevel(1), GovernanceEscalationLevel.domain_council);
  assert.equal(escalationLevel(3), GovernanceEscalationLevel.data_stewardship_council);
  assert.equal(escalationLevel(6), GovernanceEscalationLevel.data_governance_board);
  assert.equal(escalationLevel(11), GovernanceEscalationLevel.executive_steering_committee);
  assert.equal(escalationPenalty(3), 15);
});

test('notification severity follows SLA risk without color-only meaning', () => {
  assert.equal(notificationSeverity('done'), GovernanceNotificationSeverity.success);
  assert.equal(notificationSeverity('at_risk'), GovernanceNotificationSeverity.warning);
  assert.equal(notificationSeverity('overdue', 7), GovernanceNotificationSeverity.critical);
});

test('production readiness status helpers escalate from ready to watch to blocked', () => {
  assert.equal(combineReadinessStatus(['ready', 'watch']), 'watch');
  assert.equal(combineReadinessStatus(['ready', 'blocked']), 'blocked');
  assert.equal(issueRatioStatus(0, 100, { watchPct: 0.05, blockedPct: 0.2 }), 'ready');
  assert.equal(issueRatioStatus(3, 100, { watchPct: 0.05, blockedPct: 0.2 }), 'watch');
  assert.equal(issueRatioStatus(22, 100, { watchPct: 0.05, blockedPct: 0.2 }), 'blocked');
  assert.equal(backlogStatus(10, 0, 0), 'ready');
  assert.equal(backlogStatus(10, 0, 4), 'watch');
  assert.equal(backlogStatus(10, 3, 0), 'blocked');
});

test('operating model helpers require accountable owners, evidence, and traceable formulas', () => {
  assert.equal(
    operatingDefinitionStatus({
      ownerRoleCode: 'dmo_admin',
      cadence: 'monthly',
      responsibilities: ['Run council'],
      decisionRights: ['Approve standards'],
      evidenceRequirements: ['Decision register'],
    }),
    'ready',
  );
  assert.equal(
    operatingDefinitionStatus({
      ownerRoleCode: 'dmo_admin',
      cadence: 'monthly',
      responsibilities: [],
      decisionRights: ['Approve standards'],
      evidenceRequirements: ['Decision register'],
    }),
    'blocked',
  );
  assert.equal(lifecycleReadiness(CHARTER_LIFECYCLE_STEPS), 'ready');
  assert.equal(kpiTraceabilityStatus(EXECUTIVE_KPI_DEFINITIONS[0]), 'ready');
});

test('platform architecture helpers require implementation, dependencies, data signals, and clean risks', () => {
  assert.equal(PLATFORM_SERVICE_DEFINITIONS.length >= 10, true);
  assert.equal(
    platformServiceStatus({
      implemented: true,
      dataSignals: 5,
      openRisks: 0,
      wiredDependencies: 2,
      requiredDependencies: 2,
    }),
    'ready',
  );
  assert.equal(
    platformServiceStatus({
      implemented: true,
      dataSignals: 0,
      openRisks: 0,
      wiredDependencies: 1,
      requiredDependencies: 1,
    }),
    'watch',
  );
  assert.equal(
    platformServiceStatus({
      implemented: true,
      dataSignals: 5,
      openRisks: 0,
      wiredDependencies: 0,
      requiredDependencies: 1,
    }),
    'blocked',
  );
  assert.equal(platformArchitectureStatus(['ready', 'watch']), 'watch');
});

test('enterprise closure helpers distinguish implemented controls from accepted deployment deferrals', () => {
  assert.equal(SECURITY_CONTROL_CROSSWALK_DEFINITIONS.length >= 12, true);
  assert.equal(PRODUCTION_ACCEPTANCE_DEFINITIONS.length >= 8, true);
  assert.equal(ERROR_EXPERIENCE_DEFINITIONS.length >= 7, true);
  assert.equal(
    enterpriseClosureStatus({
      implemented: true,
      evidenceSignals: 3,
      openRisks: 0,
    }),
    'ready',
  );
  assert.equal(
    enterpriseClosureStatus({
      implemented: true,
      evidenceSignals: 0,
      openRisks: 0,
    }),
    'watch',
  );
  assert.equal(
    enterpriseClosureStatus({
      implemented: false,
      evidenceSignals: 0,
      openRisks: 0,
    }),
    'blocked',
  );
  assert.equal(
    enterpriseClosureStatus({
      implemented: false,
      evidenceSignals: 1,
      openRisks: 0,
      acceptedDeferral: true,
    }),
    'watch',
  );
});

test('DGPO sizing grows with assets, domains, systems, and active workflow pressure', () => {
  const small = dgpoSizingGuidance({
    governedAssets: 10,
    dataDomains: 1,
    systemPlatforms: 1,
    activeCases: 0,
    openTasks: 0,
  });
  const large = dgpoSizingGuidance({
    governedAssets: 350,
    dataDomains: 14,
    systemPlatforms: 45,
    activeCases: 120,
    openTasks: 220,
  });
  assert.equal(small.recommendedFte >= 3, true);
  assert.equal(large.recommendedFte > small.recommendedFte, true);
  assert.equal(large.bands.assetStewards >= 5, true);
});

test('production readiness aggregates scoped engine signals into a ready response', async () => {
  const prisma: any = {
    ksaHoliday: { findMany: async () => [] },
    dataAsset: {
      count: async () => 5,
      findMany: async () => [],
    },
    workflowCase: { count: async () => 2 },
    workflowTask: {
      count: async () => 0,
      findMany: async () => [],
    },
    dataQualityIssue: { count: async () => 0 },
    auditLog: { count: async () => 12 },
    integrationEvent: {
      count: async (args?: any) => {
        if (args?.where?.status) return 0;
        return 20;
      },
    },
    integrationImportBatch: { count: async () => 0 },
    integrationConnector: { count: async () => 0 },
    governanceEscalation: { count: async () => 0 },
  };
  const audit = {
    verifyChain: async () => ({
      totalRowsRead: 12,
      valid: true,
      checked: 12,
      legacyRows: 0,
      brokenAt: null,
      expectedHash: null,
      actualHash: null,
      expectedPreviousHash: null,
      actualPreviousHash: null,
    }),
  };
  const service = new GovernanceOperationsService(
    prisma,
    audit as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  const readiness = await service.productionReadiness({
    id: 'admin',
    email: 'admin@dgop.local',
    roles: ['system_admin'],
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.summary.governedAssets, 5);
  assert.equal(readiness.summary.integrationProblems, 0);
  assert.equal(readiness.checks.length, 6);
  assert.equal(readiness.checks.find((check) => check.code === 'audit_chain')?.status, 'ready');
});

test('operating model exposes v5 governance bodies, lifecycle, KPI traceability, and sizing', async () => {
  const prisma: any = {
    ksaHoliday: { findMany: async () => [] },
    dataAsset: {
      count: async (args?: any) => (args?.where?.ownerStatus === 'assigned' ? 4 : 5),
      findMany: async () => [],
    },
    dataDomain: { count: async () => 3 },
    systemPlatform: { count: async () => 2 },
    person: { count: async () => 8 },
    workflowCase: { count: async () => 4 },
    workflowTask: {
      count: async () => 3,
      findMany: async () => [
        { id: 'task-1', status: 'pending', dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), completedAt: null },
      ],
    },
    dataQualityIssue: { count: async () => 1 },
    auditLog: { count: async () => 20 },
    complianceCalendarTemplate: { count: async () => 4 },
    governanceEscalation: { count: async () => 0 },
  };
  const service = new GovernanceOperationsService(
    prisma,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  const model = await service.operatingModel({
    id: 'admin',
    email: 'admin@dgop.local',
    roles: ['system_admin'],
  });

  assert.equal(model.bodies.length >= 6, true);
  assert.equal(model.ceremonies.length >= 4, true);
  assert.equal(model.lifecycles.length, 2);
  assert.equal(model.kpiTraceability.every((kpi) => kpi.formula && kpi.ownerRoleCode), true);
  assert.equal(model.dgpoSizing.recommendedFte >= 3, true);
  assert.equal(model.summary.governedAssets, 5);
});

test('platform architecture exposes v5 platform services, dependency map, and live risk signals', async () => {
  const prisma: any = {
    dataAsset: {
      count: async () => 6,
      findMany: async () => [],
    },
    workflowTemplate: { count: async () => 4 },
    workflowCase: { count: async () => 8 },
    workflowTask: { count: async (args?: any) => (args?.where?.dueDate ? 1 : 10) },
    ndiEvidence: { count: async (args?: any) => (args?.where?.status ? 3 : 5) },
    ndiAuditPack: { count: async () => 2 },
    ndiSpecification: { count: async () => 12 },
    person: { count: async () => 5 },
    integrationConnector: { count: async () => 2 },
    integrationEvent: { count: async (args?: any) => (args?.where?.status ? 1 : 9) },
    integrationImportBatch: { count: async () => 0 },
    roleDataAccessMap: { count: async () => 2 },
    abacDecisionLog: { count: async () => 4 },
    maskingPolicy: { count: async () => 1 },
    governanceNotification: { count: async () => 3 },
    governanceEscalation: { count: async () => 0 },
    auditLog: { count: async () => 20 },
    integrationReconciliationReport: { count: async () => 1 },
  };
  const audit = {
    verifyChain: async () => ({
      totalRowsRead: 20,
      valid: true,
      checked: 20,
      legacyRows: 0,
      brokenAt: null,
      expectedHash: null,
      actualHash: null,
      expectedPreviousHash: null,
      actualPreviousHash: null,
    }),
  };
  const service = new GovernanceOperationsService(
    prisma,
    audit as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  const architecture = await service.platformArchitecture({
    id: 'admin',
    email: 'admin@dgop.local',
    roles: ['system_admin'],
  });

  assert.equal(architecture.summary.services, PLATFORM_SERVICE_DEFINITIONS.length);
  assert.equal(architecture.services.some((service) => service.code === 'workflow_engine'), true);
  assert.equal(architecture.dependencyMap.some((edge) => edge.status === 'wired'), true);
  assert.equal(architecture.summary.openRisks >= 1, true);
});

test('enterprise close-out exposes control crosswalk, production acceptance, and error readiness', async () => {
  const prisma: any = {
    ksaHoliday: { findMany: async () => [] },
    permission: { count: async () => 40 },
    roleDataScope: { count: async () => 5 },
    roleDataAccessMap: { count: async () => 3 },
    abacDecisionLog: { count: async () => 8 },
    maskingPolicy: { count: async () => 2 },
    ndiEvidence: { count: async () => 6 },
    ndiAuditPack: { count: async () => 2 },
    auditLog: { count: async () => 30 },
    privacyDpia: { count: async () => 2 },
    privacyGate: { count: async () => 5 },
    privacyDsrRequest: { count: async () => 1 },
    privacyBreach: { count: async () => 1 },
    dlpIncident: { count: async (args?: any) => (args?.where?.status ? 1 : 3) },
    classificationChangeRequest: { count: async (args?: any) => (args?.where?.status ? 1 : 2) },
    complianceCalendarTemplate: { count: async () => 4 },
    complianceCalendarOccurrence: { count: async () => 2 },
    workflowCase: { count: async () => 4 },
    workflowTask: {
      count: async () => 0,
      findMany: async () => [],
    },
    dataAsset: {
      count: async () => 6,
      findMany: async () => [],
    },
    dataQualityIssue: { count: async () => 0 },
    integrationEvent: {
      count: async (args?: any) => (args?.where?.status ? 1 : 10),
    },
    integrationImportError: { count: async () => 3 },
    integrationImportBatch: { count: async () => 1 },
    integrationConnector: { count: async () => 0 },
    governanceEscalation: { count: async () => 0 },
  };
  const audit = {
    verifyChain: async () => ({
      totalRowsRead: 30,
      valid: true,
      checked: 30,
      legacyRows: 0,
      brokenAt: null,
      expectedHash: null,
      actualHash: null,
      expectedPreviousHash: null,
      actualPreviousHash: null,
    }),
  };
  const service = new GovernanceOperationsService(
    prisma,
    audit as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  const crosswalk = await service.controlCrosswalk({
    id: 'admin',
    email: 'admin@dgop.local',
    roles: ['system_admin'],
  });
  assert.equal(crosswalk.summary.controls, SECURITY_CONTROL_CROSSWALK_DEFINITIONS.length);
  assert.equal(crosswalk.controls.some((control) => control.acceptedDeferral), true);
  assert.equal(crosswalk.frameworkCoverage.some((row) => row.framework === 'NCA ECC'), true);

  const acceptance = await service.productionAcceptancePackage({
    id: 'admin',
    email: 'admin@dgop.local',
    roles: ['system_admin'],
  });
  assert.equal(acceptance.summary.items, PRODUCTION_ACCEPTANCE_DEFINITIONS.length);
  assert.equal(acceptance.environments.length, 6);
  assert.equal(acceptance.items.some((item) => item.family === 'performance' && item.status === 'watch'), true);

  const errors = await service.errorExperienceReadiness({
    id: 'admin',
    email: 'admin@dgop.local',
    roles: ['system_admin'],
  });
  assert.equal(errors.summary.categories, ERROR_EXPERIENCE_DEFINITIONS.length);
  assert.equal(errors.envelope.publicCodes.includes('SYS-500'), true);
  assert.equal(errors.envelope.requiredFields.includes('requestId'), true);
});

test('SLA recalculation uses stable dedupe keys for workflow task signals', async () => {
  const createdNotifications: any[] = [];
  const updatedNotifications: any[] = [];
  const createdEscalations: any[] = [];
  const updatedEscalations: any[] = [];
  let existingNotification: { id: string } | null = null;
  let existingEscalation: { id: string; status: GovernanceEscalationStatus } | null = null;
  const overdueTask = {
    id: 'task-1',
    caseId: 'case-1',
    title: 'Validate evidence',
    status: 'pending',
    dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    completedAt: null,
    assigneeUserId: 'user-1',
    assignee: { id: 'user-1', email: 'owner@dgop.local', displayName: 'Owner' },
    case: {
      id: 'case-1',
      code: 'WFC-0001',
      title: 'Evidence case',
      type: 'general',
      status: 'submitted',
      assetId: null,
      asset: null,
    },
  };
  const prisma: any = {
    ksaHoliday: { findMany: async () => [] },
    workflowTask: { findMany: async () => [overdueTask] },
    governanceNotification: {
      findUnique: async ({ where }: any) => {
        assert.equal(where.dedupeKey, 'workflow_task:task-1:notification');
        return existingNotification;
      },
      create: async ({ data }: any) => {
        createdNotifications.push(data);
        existingNotification = { id: 'notice-1' };
        return { id: 'notice-1', ...data };
      },
      update: async ({ where, data }: any) => {
        updatedNotifications.push({ where, data });
        return { id: where.id, ...data };
      },
    },
    governanceEscalation: {
      count: async () => 0,
      findUnique: async ({ where }: any) => {
        assert.equal(where.dedupeKey, 'workflow_task:task-1:escalation');
        return existingEscalation;
      },
      create: async ({ data }: any) => {
        createdEscalations.push(data);
        existingEscalation = { id: 'esc-1', status: GovernanceEscalationStatus.open };
        return { id: 'esc-1', ...data };
      },
      update: async ({ where, data }: any) => {
        updatedEscalations.push({ where, data });
        return { id: where.id, ...data };
      },
    },
  };
  const service = new GovernanceOperationsService(
    prisma,
    { log: async () => {} } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );
  (service as any).ensureDefaultCalendarTemplates = async () => {};
  (service as any).workspace = async () => ({});

  await service.recalculateSla({ id: 'system', email: 'system@dgop.local', roles: ['system_admin'] });
  await service.recalculateSla({ id: 'system', email: 'system@dgop.local', roles: ['system_admin'] });

  assert.equal(createdNotifications.length, 1);
  assert.equal(updatedNotifications.length, 1);
  assert.equal(createdNotifications[0].dedupeKey, 'workflow_task:task-1:notification');
  assert.equal(createdEscalations.length, 1);
  assert.equal(updatedEscalations.length, 1);
  assert.equal(createdEscalations[0].dedupeKey, 'workflow_task:task-1:escalation');
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  OK ${t.name}`);
    } catch (err) {
      console.error(`  FAIL ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
