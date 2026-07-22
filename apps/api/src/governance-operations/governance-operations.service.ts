import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  CaseStatus,
  ClassificationRequestStatus,
  ComplianceCalendarStatus,
  ComplianceCalendarType,
  DataQualityIssueStatus,
  DlpIncidentStatus,
  GovernanceEscalationLevel,
  GovernanceEscalationStatus,
  GovernanceNotificationSeverity,
  GovernanceNotificationStatus,
  IntegrationBatchStatus,
  IntegrationConnectorStatus,
  IntegrationEventStatus,
  NdiEvidenceStatus,
  Prisma,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { AuthUser } from '../auth/auth.types';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateComplianceCalendarTemplateDto,
  CreateGovernanceNotificationDto,
  CreateKsaHolidayDto,
  DispatchNotificationsDto,
  UpdateComplianceCalendarTemplateDto,
  UpdateEscalationDto,
  UpdateNotificationDto,
} from './governance-operations.dto';
import {
  CHARTER_LIFECYCLE_STEPS,
  ERROR_EXPERIENCE_DEFINITIONS,
  EXECUTIVE_KPI_DEFINITIONS,
  ESCALATION_LEVEL_LABELS,
  OPERATING_BODY_DEFINITIONS,
  OPERATING_CEREMONY_DEFINITIONS,
  POLICY_LIFECYCLE_STEPS,
  PLATFORM_SERVICE_DEFINITIONS,
  PRODUCTION_ACCEPTANCE_DEFINITIONS,
  SECURITY_CONTROL_CROSSWALK_DEFINITIONS,
  addKsaBusinessDays,
  backlogStatus,
  buildNotificationDeliveryPlan,
  businessDaysBetween,
  combineReadinessStatus,
  dateKey,
  dgpoSizingGuidance,
  escalationLevel,
  escalationPenalty,
  enterpriseClosureStatus,
  issueRatioStatus,
  kpiTraceabilityStatus,
  ksaSlaSignal,
  lifecycleReadiness,
  notificationSeverity,
  operatingDefinitionStatus,
  operatingPressureStatus,
  platformArchitectureStatus,
  platformServiceStatus,
  summarizeNotificationLayer,
} from './governance-operations.logic';

const taskInclude = {
  assignee: { select: { id: true, email: true, displayName: true } },
  case: {
    select: {
      id: true,
      code: true,
      title: true,
      type: true,
      status: true,
      assetId: true,
      asset: { select: { id: true, code: true, nameEn: true, domain: { select: { id: true, code: true, nameEn: true } } } },
    },
  },
};

const notificationInclude = {
  workflowCase: { select: { id: true, code: true, title: true, status: true } },
  workflowTask: { select: { id: true, title: true, status: true, dueDate: true } },
} satisfies Prisma.GovernanceNotificationInclude;

type NotificationWithLinks = Prisma.GovernanceNotificationGetPayload<{ include: typeof notificationInclude }>;

const GOVERNANCE_SCHEDULER_LOCK_KEY = 174205361;

function workflowTaskSignalKey(taskId: string, kind: 'notification' | 'escalation'): string {
  return `workflow_task:${taskId}:${kind}`;
}

@Injectable()
export class GovernanceOperationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GovernanceOperationsService.name);
  private readonly systemUser: AuthUser = {
    id: 'system',
    email: 'system@scheduler.dgop.local',
    roles: ['system_admin'],
  };
  private slaWorker: ReturnType<typeof setInterval> | null = null;
  private slaWorkerRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly workflow?: WorkflowService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.ensureDefaultCalendarTemplates();
    } catch (error) {
      this.logger.warn(
        `Governance operations calendar bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (process.env.GOVERNANCE_OPERATIONS_SCHEDULER === 'false') return;
    const intervalMs = Math.max(Number(process.env.GOVERNANCE_OPERATIONS_SCHEDULER_MS ?? 300000), 60000);
    this.slaWorker = setInterval(() => void this.runScheduledGovernanceCycle(), intervalMs);
    void this.runScheduledGovernanceCycle();
  }

  onModuleDestroy(): void {
    if (this.slaWorker) clearInterval(this.slaWorker);
    this.slaWorker = null;
  }

  private async runScheduledGovernanceCycle(): Promise<void> {
    if (this.slaWorkerRunning) return;
    this.slaWorkerRunning = true;
    try {
      await this.withSchedulerLock(async () => {
        await this.recalculateSla(this.systemUser);
        await this.generateCalendarOccurrences(this.systemUser);
      });
    } catch (error) {
      this.logger.warn(
        `Governance operations scheduler failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.slaWorkerRunning = false;
    }
  }

  private async withSchedulerLock(work: () => Promise<void>): Promise<void> {
    const [lock] = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(${GOVERNANCE_SCHEDULER_LOCK_KEY}) AS locked
    `;
    if (!lock?.locked) return;
    try {
      await work();
    } finally {
      await this.prisma.$executeRaw`SELECT pg_advisory_unlock(${GOVERNANCE_SCHEDULER_LOCK_KEY})`;
    }
  }

  private isUnrestricted(scope: EffectiveScope): boolean {
    return scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
  }

  private assetScopeWhere(scope: EffectiveScope): Prisma.DataAssetWhereInput {
    const where: Prisma.DataAssetWhereInput = { deletedAt: null, isActive: true };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [{ classificationId: null }, { classification: { rank: { lte: scope.maxClassRank } } }];
    }
    return where;
  }

  private async visibleAssetIds(scope: EffectiveScope): Promise<Set<string> | 'all'> {
    if (this.isUnrestricted(scope)) return 'all';
    const rows = await this.prisma.dataAsset.findMany({ where: this.assetScopeWhere(scope), select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  private workflowCaseScopeWhere(assetIds: Set<string> | 'all', user?: AuthUser): Prisma.WorkflowCaseWhereInput {
    if (assetIds === 'all') return {};
    const visible: Prisma.WorkflowCaseWhereInput[] = [];
    if (assetIds.size) visible.push({ assetId: { in: [...assetIds] } });
    if (user) {
      const taskVisibility = this.workflowTaskOwnershipWhere(user);
      visible.push({ AND: [{ assetId: null }, { createdBy: user.email }] });
      visible.push({ AND: [{ assetId: null }, { tasks: { some: { OR: taskVisibility } } }] });
    }
    return visible.length ? { OR: visible } : { id: '__no_visible_governance_operations__' };
  }

  private workflowLinkScopeWhere(
    assetIds: Set<string> | 'all',
    user: AuthUser,
  ): Prisma.GovernanceNotificationWhereInput {
    if (assetIds === 'all') return {};
    const caseWhere = this.workflowCaseScopeWhere(assetIds, user);
    return {
      OR: [
        { AND: [{ workflowCaseId: null }, { workflowTaskId: null }] },
        { workflowCase: caseWhere },
        { workflowTask: { case: caseWhere } },
      ],
    };
  }

  private notificationRecipientWhere(user: AuthUser): Prisma.GovernanceNotificationWhereInput {
    return {
      OR: [
        { assigneeUserId: user.id },
        { targetRoleCode: { in: user.roles } },
        { AND: [{ assigneeUserId: null }, { targetRoleCode: null }] },
      ],
    };
  }

  private notificationVisibilityWhere(
    assetIds: Set<string> | 'all',
    user: AuthUser,
  ): Prisma.GovernanceNotificationWhereInput {
    return {
      AND: [
        this.notificationRecipientWhere(user),
        this.workflowLinkScopeWhere(assetIds, user),
      ],
    };
  }

  private externalNotificationDeliveryEnabled(): boolean {
    return process.env.DGOP_NOTIFICATION_EXTERNAL_DELIVERY === 'true';
  }

  private enrichNotification(row: NotificationWithLinks) {
    const overdueBusinessDays = row.workflowTask?.dueDate
      ? Math.max(0, businessDaysBetween(row.workflowTask.dueDate, new Date()))
      : 0;
    const deliveryPlan = buildNotificationDeliveryPlan({
      severity: row.severity,
      status: row.status,
      sourceType: row.sourceType,
      targetRoleCode: row.targetRoleCode,
      assigneeUserId: row.assigneeUserId,
      emailTo: row.emailTo,
      workflowCaseId: row.workflowCaseId,
      workflowTaskId: row.workflowTaskId,
      overdueBusinessDays,
      externalDeliveryEnabled: this.externalNotificationDeliveryEnabled(),
    });
    return {
      ...row,
      audience: deliveryPlan.deliveryMode,
      deliveryPlan,
    };
  }

  private notificationLayer(notifications: NotificationWithLinks[], activeEscalations = 0) {
    const enriched = notifications.map((row) => this.enrichNotification(row));
    return {
      generatedAt: new Date().toISOString(),
      summary: summarizeNotificationLayer(
        enriched.map((row) => ({
          severity: row.severity,
          status: row.status,
          assigneeUserId: row.assigneeUserId,
          targetRoleCode: row.targetRoleCode,
          deliveryPlan: row.deliveryPlan,
        })),
        activeEscalations,
      ),
      channels: ['in_app', 'email', 'email_digest', 'teams', 'sms', 'webhook'],
      notifications: enriched,
    };
  }

  private cleanOptional(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private requireTrimmed(value: string, field: string): string {
    const trimmed = value.trim();
    if (!trimmed) throw new BadRequestException(`${field} is required`);
    return trimmed;
  }

  private workflowLinkedEscalationScopeWhere(
    assetIds: Set<string> | 'all',
    user: AuthUser,
  ): Prisma.GovernanceEscalationWhereInput {
    if (assetIds === 'all') return {};
    const caseWhere = this.workflowCaseScopeWhere(assetIds, user);
    return {
      OR: [
        { workflowCase: caseWhere },
        { workflowTask: { case: caseWhere } },
      ],
    };
  }

  private workflowTaskOwnershipWhere(user: AuthUser): Prisma.WorkflowTaskWhereInput[] {
    const ownership: Prisma.WorkflowTaskWhereInput[] = [{ assigneeUserId: user.id }];
    if (user.roles.length) {
      ownership.push({
        assigneeUserId: null,
        OR: [
          { assigneeRoleCode: { in: user.roles } },
          { templateStage: { assigneeRoleCode: { in: user.roles } } },
        ],
      });
    }
    return ownership;
  }

  private async scopedTaskWhere(user: AuthUser): Promise<Prisma.WorkflowTaskWhereInput> {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const where: Prisma.WorkflowTaskWhereInput = {
      status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      case: this.workflowCaseScopeWhere(assetIds, user),
    };
    if (!user.roles.some((role) => ['system_admin', 'dmo_admin'].includes(role))) {
      where.OR = this.workflowTaskOwnershipWhere(user);
    }
    return where;
  }

  private async resolveNotificationCreateData(
    dto: CreateGovernanceNotificationDto,
    user: AuthUser,
    assetIds: Set<string> | 'all',
  ): Promise<{
    targetRoleCode: string | null;
    assigneeUserId: string | null;
    workflowCaseId: string | null;
    workflowTaskId: string | null;
    sourceType: string;
    sourceId: string | null;
    emailTo: string | null;
    dedupeKey: string | null;
  }> {
    let targetRoleCode = this.cleanOptional(dto.targetRoleCode);
    let assigneeUserId = this.cleanOptional(dto.assigneeUserId);
    let emailTo = this.cleanOptional(dto.emailTo);
    let workflowCaseId = this.cleanOptional(dto.workflowCaseId);
    const workflowTaskId = this.cleanOptional(dto.workflowTaskId);
    const caseWhere = this.workflowCaseScopeWhere(assetIds, user);

    if (workflowTaskId) {
      const task = await this.prisma.workflowTask.findFirst({
        where: { id: workflowTaskId, case: caseWhere },
        select: {
          id: true,
          caseId: true,
          assigneeUserId: true,
          assignee: { select: { email: true, isActive: true } },
        },
      });
      if (!task) throw new NotFoundException('workflow_task not found');
      if (workflowCaseId && workflowCaseId !== task.caseId) {
        throw new BadRequestException('workflowTaskId does not belong to workflowCaseId');
      }
      workflowCaseId = task.caseId;
      if (!assigneeUserId && !targetRoleCode && task.assigneeUserId) assigneeUserId = task.assigneeUserId;
      if (!emailTo && !targetRoleCode && task.assignee?.isActive) emailTo = task.assignee.email;
    }

    if (workflowCaseId) {
      const workflowCase = await this.prisma.workflowCase.findFirst({
        where: { AND: [{ id: workflowCaseId }, caseWhere] },
        select: { id: true },
      });
      if (!workflowCase) throw new NotFoundException('workflow_case not found');
    }

    if (assigneeUserId && targetRoleCode) {
      throw new BadRequestException('Choose either assigneeUserId or targetRoleCode, not both');
    }

    if (assigneeUserId) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: assigneeUserId, isActive: true },
        select: { id: true, email: true },
      });
      if (!assignee) throw new NotFoundException('assignee user not found');
      emailTo = emailTo ?? assignee.email;
    }

    if (targetRoleCode) {
      const role = await this.prisma.role.findFirst({
        where: { code: targetRoleCode, isActive: true, deletedAt: null },
        select: { code: true },
      });
      if (!role) throw new NotFoundException('target role not found');
    }

    const sourceType =
      this.cleanOptional(dto.sourceType) ??
      (workflowTaskId ? 'workflow_task' : workflowCaseId ? 'workflow_case' : 'manual_notification');
    const sourceId = this.cleanOptional(dto.sourceId) ?? workflowTaskId ?? workflowCaseId ?? null;

    return {
      targetRoleCode,
      assigneeUserId,
      workflowCaseId,
      workflowTaskId,
      sourceType,
      sourceId,
      emailTo,
      dedupeKey: this.cleanOptional(dto.dedupeKey),
    };
  }

  private dataQualityIssueScopeWhere(assetIds: Set<string> | 'all', actorEmail?: string): Prisma.DataQualityIssueWhereInput {
    if (assetIds === 'all') return {};
    const or: Prisma.DataQualityIssueWhereInput[] = [];
    if (assetIds.size) or.push({ assetId: { in: [...assetIds] } });
    if (actorEmail) {
      or.push({ AND: [{ assetId: null }, { createdBy: actorEmail }] });
    }
    return or.length ? { OR: or } : { id: { equals: '__no_visible_governance_dq_issues__' } };
  }

  private async holidayConfig() {
    const holidays = await this.prisma.ksaHoliday.findMany({ orderBy: { date: 'asc' } });
    return {
      holidays,
      holidayDates: holidays.filter((row) => !row.isRecurring).map((row) => dateKey(row.date)),
      recurringHolidayDates: holidays.filter((row) => row.isRecurring).map((row) => row.date.toISOString().slice(5, 10)),
    };
  }

  async workspace(user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const caseWhere = this.workflowCaseScopeWhere(assetIds, user);
    const { holidays, holidayDates, recurringHolidayDates } = await this.holidayConfig();
    const [tasks, notifications, escalations, templates, occurrences] = await Promise.all([
      this.prisma.workflowTask.findMany({
        where: await this.scopedTaskWhere(user),
        include: taskInclude,
        orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
        take: 80,
      }),
      this.prisma.governanceNotification.findMany({
        where: this.notificationVisibilityWhere(assetIds, user),
        include: notificationInclude,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 80,
      }),
      this.prisma.governanceEscalation.findMany({
        where: {
          workflowCase: caseWhere,
          status: { in: [GovernanceEscalationStatus.open, GovernanceEscalationStatus.acknowledged] },
        },
        include: {
          workflowCase: { select: { id: true, code: true, title: true, type: true, status: true } },
          workflowTask: { select: { id: true, title: true, status: true, dueDate: true } },
        },
        orderBy: [{ level: 'desc' }, { escalatedAt: 'desc' }],
        take: 80,
      }),
      this.prisma.complianceCalendarTemplate.findMany({
        include: {
          occurrences: {
            where: { OR: [{ workflowCase: caseWhere }, { workflowCaseId: null }] },
            orderBy: { dueAt: 'asc' },
            take: 5,
          },
        },
        orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }],
      }),
      this.prisma.complianceCalendarOccurrence.findMany({
        where: { OR: [{ workflowCase: caseWhere }, { workflowCaseId: null }] },
        include: {
          template: { select: { id: true, code: true, title: true, type: true, ownerRoleCode: true } },
          workflowCase: { select: { id: true, code: true, title: true, status: true } },
        },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        take: 80,
      }),
    ]);
    const now = new Date();
    const taskSignals = tasks.map((task) => {
      const overdueBusinessDays = task.dueDate ? Math.max(0, businessDaysBetween(task.dueDate, now, holidayDates, recurringHolidayDates)) : 0;
      const slaSignal = ksaSlaSignal(task, now, holidayDates, recurringHolidayDates);
      return { ...task, slaSignal, overdueBusinessDays };
    });
    return {
      summary: {
        openTasks: tasks.length,
        atRiskTasks: taskSignals.filter((row) => row.slaSignal === 'at_risk').length,
        overdueTasks: taskSignals.filter((row) => row.slaSignal === 'overdue').length,
        unreadNotifications: notifications.filter((row) => row.status === GovernanceNotificationStatus.unread).length,
        activeEscalations: escalations.length,
        calendarItems: occurrences.filter((row) => row.status === ComplianceCalendarStatus.active).length,
        holidaysConfigured: holidays.length,
      },
      taskSignals,
      notifications: notifications.map((row) => this.enrichNotification(row)),
      notificationLayer: this.notificationLayer(notifications, escalations.length),
      escalations,
      templates,
      occurrences,
      holidays,
      graph: this.escalationGraph(escalations),
    };
  }

  async productionReadiness(user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const caseWhere = this.workflowCaseScopeWhere(assetIds, user);
    const taskWhere: Prisma.WorkflowTaskWhereInput = {
      status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      case: caseWhere,
    };
    const dqScopeWhere = this.dataQualityIssueScopeWhere(assetIds, user.email);
    const dqOpenStatuses = [
      DataQualityIssueStatus.open,
      DataQualityIssueStatus.triaged,
      DataQualityIssueStatus.in_progress,
      DataQualityIssueStatus.resolved,
    ];
    const { holidayDates, recurringHolidayDates } = await this.holidayConfig();
    const now = new Date();

    const [
      assetCount,
      activeCaseCount,
      openTaskCount,
      taskRows,
      dqIssueCount,
      dqOpenIssueCount,
      auditRows,
      integrationEvents,
      retryEvents,
      deadLetterEvents,
      failedBatches,
      troubledConnectors,
      openEscalations,
      auditChain,
      legacyBaselineAccepted,
    ] = await Promise.all([
      this.prisma.dataAsset.count({ where: this.assetScopeWhere(scope) }),
      this.prisma.workflowCase.count({ where: { AND: [caseWhere, { status: { not: CaseStatus.closed } }] } }),
      this.prisma.workflowTask.count({ where: taskWhere }),
      this.prisma.workflowTask.findMany({
        where: taskWhere,
        select: { id: true, status: true, dueDate: true, completedAt: true },
        orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
        take: 1000,
      }),
      this.prisma.dataQualityIssue.count({ where: { AND: [{ deletedAt: null }, dqScopeWhere] } }),
      this.prisma.dataQualityIssue.count({
        where: { AND: [{ deletedAt: null }, dqScopeWhere, { status: { in: dqOpenStatuses } }] },
      }),
      this.prisma.auditLog.count(),
      this.prisma.integrationEvent.count(),
      this.prisma.integrationEvent.count({
        where: { status: { in: [IntegrationEventStatus.failed, IntegrationEventStatus.retry_scheduled] } },
      }),
      this.prisma.integrationEvent.count({ where: { status: IntegrationEventStatus.dead_letter } }),
      this.prisma.integrationImportBatch.count({
        where: { status: { in: [IntegrationBatchStatus.completed_with_errors, IntegrationBatchStatus.failed] } },
      }),
      this.prisma.integrationConnector.count({
        where: {
          deletedAt: null,
          isActive: true,
          OR: [
            { status: IntegrationConnectorStatus.failed },
            {
              status: IntegrationConnectorStatus.warning,
              OR: [{ lastError: { not: null } }, { lastRunAt: { not: null } }],
            },
          ],
        },
      }),
      this.prisma.governanceEscalation.count({
        where: {
          workflowCase: caseWhere,
          status: { in: [GovernanceEscalationStatus.open, GovernanceEscalationStatus.acknowledged] },
        },
      }),
      this.audit.verifyChain(1000),
      this.audit.legacyBaselineAccepted(),
    ]);

    const taskSignals = taskRows.map((task) => ksaSlaSignal(task, now, holidayDates, recurringHolidayDates));
    const overdueTasks = taskSignals.filter((signal) => signal === 'overdue').length;
    const atRiskTasks = taskSignals.filter((signal) => signal === 'at_risk').length;
    const integrationProblemCount = retryEvents + deadLetterEvents + failedBatches + troubledConnectors;
    const auditStatus = !auditChain.valid
      ? 'blocked'
      : auditRows === 0 || (auditChain.legacyRows > 0 && !legacyBaselineAccepted)
        ? 'watch'
        : 'ready';
    const checks = [
      {
        code: 'workflow_backlog',
        label: 'Workflow backlog',
        status: backlogStatus(openTaskCount, overdueTasks, atRiskTasks),
        metric: { openTasks: openTaskCount, overdueTasks, atRiskTasks, sampledTasks: taskRows.length },
        guidance: 'Keep active workflow tasks inside SLA before client demonstrations or production handover.',
      },
      {
        code: 'integration_reliability',
        label: 'Integration reliability',
        status: issueRatioStatus(integrationProblemCount, integrationEvents, {
          watchPct: 0.05,
          blockedPct: 0.2,
          absoluteBlock: 10,
        }),
        metric: { integrationEvents, retryEvents, deadLetterEvents, failedBatches, troubledConnectors },
        guidance: 'Review retries, dead letters, failed batches, and unhealthy connectors before relying on automated feeds.',
      },
      {
        code: 'audit_chain',
        label: 'Audit evidence chain',
        status: auditStatus,
        metric: {
          auditRows,
          verifiedRows: auditChain.totalRowsRead,
          checkedRows: auditChain.checked,
          legacyRows: auditChain.legacyRows,
          legacyBaselineAccepted,
          brokenAt: auditChain.brokenAt,
        },
        guidance: 'The audit chain must verify cleanly because it is the evidence trail for governance decisions.',
      },
      {
        code: 'data_quality_pressure',
        label: 'Data quality pressure',
        status: issueRatioStatus(dqOpenIssueCount, Math.max(dqIssueCount, assetCount), {
          watchPct: 0.1,
          blockedPct: 0.35,
          absoluteBlock: 25,
        }),
        metric: { dqIssueCount, dqOpenIssueCount, governedAssets: assetCount },
        guidance: 'Open quality issues should be triaged and linked to owners before production reporting.',
      },
      {
        code: 'escalation_pressure',
        label: 'Escalation pressure',
        status: openEscalations >= 10 ? 'blocked' : openEscalations > 0 ? 'watch' : 'ready',
        metric: { openEscalations, activeCaseCount },
        guidance: 'Resolve or acknowledge escalations so executive-facing queues do not mask operational risk.',
      },
      {
        code: 'governed_asset_baseline',
        label: 'Governed asset baseline',
        status: assetCount > 0 ? 'ready' : 'watch',
        metric: { governedAssets: assetCount },
        guidance: 'At least one visible governed asset is needed for meaningful ownership, quality, and security workflows.',
      },
    ] as const;

    return {
      status: combineReadinessStatus(checks.map((check) => check.status)),
      generatedAt: now.toISOString(),
      scope: {
        assetVisibility: assetIds === 'all' ? 'all' : assetIds.size,
        restricted: !this.isUnrestricted(scope),
      },
      summary: {
        governedAssets: assetCount,
        activeCases: activeCaseCount,
        openTasks: openTaskCount,
        overdueTasks,
        atRiskTasks,
        integrationProblems: integrationProblemCount,
        openQualityIssues: dqOpenIssueCount,
        activeEscalations: openEscalations,
      },
      checks,
    };
  }

  async controlCrosswalk(user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const caseWhere = this.workflowCaseScopeWhere(assetIds, user);
    const [
      permissions,
      roleScopes,
      roleDataMaps,
      abacDecisions,
      maskingPolicies,
      approvedEvidence,
      auditPacks,
      auditRows,
      privacyDpia,
      privacyGates,
      privacyDsr,
      privacyBreaches,
      dlpIncidents,
      openDlpIncidents,
      classificationRequests,
      openClassificationRequests,
      calendarTemplates,
      calendarOccurrences,
      workflowCases,
      integrationEvents,
      integrationProblems,
      importErrors,
      auditChain,
      legacyBaselineAccepted,
    ] = await Promise.all([
      this.prisma.permission.count(),
      this.prisma.roleDataScope.count(),
      this.prisma.roleDataAccessMap.count({ where: { isActive: true } }),
      this.prisma.abacDecisionLog.count(),
      this.prisma.maskingPolicy.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.ndiEvidence.count({ where: { status: NdiEvidenceStatus.approved } }),
      this.prisma.ndiAuditPack.count(),
      this.prisma.auditLog.count(),
      this.prisma.privacyDpia.count({ where: { deletedAt: null } }),
      this.prisma.privacyGate.count(),
      this.prisma.privacyDsrRequest.count({ where: { deletedAt: null } }),
      this.prisma.privacyBreach.count({ where: { deletedAt: null } }),
      this.prisma.dlpIncident.count(),
      this.prisma.dlpIncident.count({
        where: { status: { in: [DlpIncidentStatus.new, DlpIncidentStatus.triaged, DlpIncidentStatus.under_review, DlpIncidentStatus.contained] } },
      }),
      this.prisma.classificationChangeRequest.count(),
      this.prisma.classificationChangeRequest.count({
        where: { status: ClassificationRequestStatus.pending },
      }),
      this.prisma.complianceCalendarTemplate.count({ where: { status: ComplianceCalendarStatus.active } }),
      this.prisma.complianceCalendarOccurrence.count(),
      this.prisma.workflowCase.count({ where: caseWhere }),
      this.prisma.integrationEvent.count(),
      this.prisma.integrationEvent.count({
        where: { status: { in: [IntegrationEventStatus.failed, IntegrationEventStatus.retry_scheduled, IntegrationEventStatus.dead_letter] } },
      }),
      this.prisma.integrationImportError.count(),
      this.audit.verifyChain(1000),
      this.audit.legacyBaselineAccepted(),
    ]);

    const evidenceSignals: Record<string, number> = {
      rbac_abac_scope: permissions + roleScopes + roleDataMaps + abacDecisions,
      secure_search: permissions + (assetIds === 'all' ? 1 : assetIds.size),
      masking_classification: maskingPolicies + abacDecisions,
      evidence_chain: approvedEvidence + auditPacks,
      audit_chain_integrity: auditRows,
      privacy_by_design: privacyDpia + privacyGates + privacyDsr + privacyBreaches,
      incident_response: dlpIncidents + classificationRequests + workflowCases,
      compliance_calendar: calendarTemplates + calendarOccurrences,
      secure_error_handling: 1,
      integration_resilience: integrationEvents + importErrors,
      vault_secret_management: process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? 1 : 0,
      mtls_service_mesh: process.env.PUBLIC_ORIGIN ? 1 : 0,
      siem_monitoring: auditRows + integrationEvents,
    };
    const openRisks: Record<string, number> = {
      rbac_abac_scope: roleDataMaps === 0 ? 1 : 0,
      secure_search: 0,
      masking_classification: maskingPolicies === 0 ? 1 : 0,
      evidence_chain: approvedEvidence === 0 ? 1 : 0,
      audit_chain_integrity: auditChain.valid
        ? auditChain.legacyRows > 0 && !legacyBaselineAccepted
          ? auditChain.legacyRows
          : 0
        : 1,
      privacy_by_design: privacyDpia === 0 ? 1 : 0,
      incident_response: openDlpIncidents + openClassificationRequests,
      compliance_calendar: calendarTemplates === 0 ? 1 : 0,
      secure_error_handling: 0,
      integration_resilience: integrationProblems,
      vault_secret_management: process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? 0 : 1,
      mtls_service_mesh: process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN ? 1 : 0,
      siem_monitoring: 0,
    };

    const controls = SECURITY_CONTROL_CROSSWALK_DEFINITIONS.map((definition) => {
      const input = {
        implemented: !definition.acceptedDeferral,
        acceptedDeferral: !!definition.acceptedDeferral,
        evidenceSignals: evidenceSignals[definition.code] ?? 0,
        openRisks: openRisks[definition.code] ?? 0,
      };
      return {
        ...definition,
        status: enterpriseClosureStatus(input),
        signals: input,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      status: combineReadinessStatus(controls.map((control) => control.status)),
      scope: {
        restricted: !this.isUnrestricted(scope),
        assetVisibility: assetIds === 'all' ? 'all' : assetIds.size,
      },
      summary: {
        controls: controls.length,
        ready: controls.filter((control) => control.status === 'ready').length,
        watch: controls.filter((control) => control.status === 'watch').length,
        blocked: controls.filter((control) => control.status === 'blocked').length,
        acceptedDeferrals: controls.filter((control) => control.acceptedDeferral).length,
        openRisks: controls.reduce((sum, control) => sum + control.signals.openRisks, 0),
      },
      controls,
      frameworkCoverage: ['NCA ECC', 'PDPL', 'NDI', 'DSP'].map((framework) => ({
        framework,
        controls: controls.filter((control) => control.frameworks.includes(framework)).length,
        ready: controls.filter((control) => control.frameworks.includes(framework) && control.status === 'ready').length,
      })),
    };
  }

  async productionAcceptancePackage(user: AuthUser) {
    const readiness = await this.productionReadiness(user);
    const readinessByCode = new Map(readiness.checks.map((check) => [check.code, check.status]));
    const items = PRODUCTION_ACCEPTANCE_DEFINITIONS.map((definition) => {
      const mappedStatus =
        definition.family === 'performance'
          ? 'watch'
          : definition.code === 'module_acceptance'
            ? readiness.status
            : definition.code === 'hypercare_support'
              ? readiness.summary.activeEscalations > 0 ? 'watch' : 'ready'
              : definition.code === 'recovery_target'
                ? readinessByCode.get('audit_chain') === 'blocked' ? 'blocked' : 'watch'
                : 'ready';
      return {
        ...definition,
        status: mappedStatus,
        evidenceSignals: definition.evidence.length,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      status: combineReadinessStatus([readiness.status, ...items.map((item) => item.status)]),
      readiness,
      summary: {
        items: items.length,
        ready: items.filter((item) => item.status === 'ready').length,
        watch: items.filter((item) => item.status === 'watch').length,
        blocked: items.filter((item) => item.status === 'blocked').length,
        acceptedDeferrals: items.filter((item) => item.acceptedDeferral).length,
      },
      items,
      environments: ['DEV', 'TEST', 'UAT', 'PRE-PROD', 'PROD', 'DR'].map((name) => ({
        name,
        status: name === 'DEV' || name === 'UAT' ? 'ready' : 'watch',
        entry: name === 'DEV' ? 'Local build, tests, seed data, and health check pass.' : 'Promote only after previous environment exit criteria pass.',
        exit: name === 'DR' ? 'Recovery runbook exercised and evidence captured.' : 'Smoke checks, access checks, workflow checks, and known issues updated.',
      })),
    };
  }

  async errorExperienceReadiness(user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const [
      validationImportErrors,
      integrationErrors,
      failedEvents,
      retryEvents,
      deadLetterEvents,
      auditRows,
    ] = await Promise.all([
      this.prisma.integrationImportError.count(),
      this.prisma.integrationImportBatch.count({
        where: { status: { in: [IntegrationBatchStatus.completed_with_errors, IntegrationBatchStatus.failed] } },
      }),
      this.prisma.integrationEvent.count({ where: { status: IntegrationEventStatus.failed } }),
      this.prisma.integrationEvent.count({ where: { status: IntegrationEventStatus.retry_scheduled } }),
      this.prisma.integrationEvent.count({ where: { status: IntegrationEventStatus.dead_letter } }),
      this.prisma.auditLog.count(),
    ]);

    const evidenceSignals: Record<string, number> = {
      validation_errors: 1,
      session_errors: 1,
      permission_errors: 1,
      conflict_errors: 1,
      rate_limit_errors: 1,
      import_errors: validationImportErrors + integrationErrors + 1,
      system_errors: auditRows + 1,
    };
    const openRisks: Record<string, number> = {
      validation_errors: 0,
      session_errors: 0,
      permission_errors: 0,
      conflict_errors: 0,
      rate_limit_errors: 0,
      import_errors: integrationErrors + deadLetterEvents,
      system_errors: failedEvents + retryEvents + deadLetterEvents,
    };

    const categories = ERROR_EXPERIENCE_DEFINITIONS.map((definition) => {
      const input = {
        implemented: true,
        evidenceSignals: evidenceSignals[definition.code] ?? 0,
        openRisks: openRisks[definition.code] ?? 0,
      };
      return {
        ...definition,
        status: enterpriseClosureStatus(input),
        signals: input,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      status: combineReadinessStatus(categories.map((category) => category.status)),
      scope: {
        restricted: !this.isUnrestricted(scope),
        assetVisibility: assetIds === 'all' ? 'all' : assetIds.size,
      },
      summary: {
        categories: categories.length,
        ready: categories.filter((category) => category.status === 'ready').length,
        watch: categories.filter((category) => category.status === 'watch').length,
        blocked: categories.filter((category) => category.status === 'blocked').length,
        importErrors: validationImportErrors + integrationErrors,
        systemSignals: failedEvents + retryEvents + deadLetterEvents,
      },
      categories,
      envelope: {
        requiredFields: ['statusCode', 'code', 'error', 'message', 'userMessage', 'retryable', 'method', 'path', 'timestamp', 'requestId', 'correlationId'],
        publicCodes: ['VAL-400', 'VAL-422', 'SES-401', 'PER-403', 'BUS-404', 'BUS-409', 'RATE-429', 'INT-400', 'SYS-500'],
      },
    };
  }

  async operatingModel(user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const assetWhere = this.assetScopeWhere(scope);
    const caseWhere = this.workflowCaseScopeWhere(assetIds, user);
    const taskWhere: Prisma.WorkflowTaskWhereInput = {
      status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      case: caseWhere,
    };
    const domainWhere: Prisma.DataDomainWhereInput =
      scope.domains === 'all'
        ? { deletedAt: null, isActive: true }
        : { deletedAt: null, isActive: true, id: { in: scope.domains } };
    const systemWhere: Prisma.SystemPlatformWhereInput =
      scope.orgUnits === 'all'
        ? { deletedAt: null, isActive: true }
        : { deletedAt: null, isActive: true, ownerOrgUnitId: { in: scope.orgUnits } };
    const dqScopeWhere = this.dataQualityIssueScopeWhere(assetIds, user.email);
    const dqOpenStatuses = [
      DataQualityIssueStatus.open,
      DataQualityIssueStatus.triaged,
      DataQualityIssueStatus.in_progress,
      DataQualityIssueStatus.resolved,
    ];

    const [
      governedAssets,
      assignedAssets,
      dataDomains,
      systemPlatforms,
      activePeople,
      activeCases,
      openTasks,
      sampledTasks,
      openQualityIssues,
      auditRows,
      activeCalendarTemplates,
      activeEscalations,
    ] = await Promise.all([
      this.prisma.dataAsset.count({ where: assetWhere }),
      this.prisma.dataAsset.count({ where: { ...assetWhere, ownerStatus: 'assigned' } }),
      this.prisma.dataDomain.count({ where: domainWhere }),
      this.prisma.systemPlatform.count({ where: systemWhere }),
      this.prisma.person.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.workflowCase.count({ where: { AND: [caseWhere, { status: { not: CaseStatus.closed } }] } }),
      this.prisma.workflowTask.count({ where: taskWhere }),
      this.prisma.workflowTask.findMany({
        where: taskWhere,
        select: { id: true, status: true, dueDate: true, completedAt: true },
        take: 1000,
      }),
      this.prisma.dataQualityIssue.count({
        where: { AND: [{ deletedAt: null }, dqScopeWhere, { status: { in: dqOpenStatuses } }] },
      }),
      this.prisma.auditLog.count(),
      this.prisma.complianceCalendarTemplate.count({
        where: { status: ComplianceCalendarStatus.active },
      }),
      this.prisma.governanceEscalation.count({
        where: {
          workflowCase: caseWhere,
          status: { in: [GovernanceEscalationStatus.open, GovernanceEscalationStatus.acknowledged] },
        },
      }),
    ]);

    const { holidayDates, recurringHolidayDates } = await this.holidayConfig();
    const now = new Date();
    const overdueTasks = sampledTasks.filter((task) =>
      ksaSlaSignal(task, now, holidayDates, recurringHolidayDates) === 'overdue',
    ).length;
    const ownershipCoverage = governedAssets > 0 ? Math.round((assignedAssets / governedAssets) * 100) : 0;
    const workflowSlaHealth = openTasks > 0 ? Math.max(0, Math.round(100 - (overdueTasks / openTasks) * 100)) : 100;
    const qualityPressurePct = governedAssets > 0 ? Math.round((openQualityIssues / governedAssets) * 100) : 0;
    const cadenceCoverage = OPERATING_CEREMONY_DEFINITIONS.length
      ? Math.min(100, Math.round((activeCalendarTemplates / OPERATING_CEREMONY_DEFINITIONS.length) * 100))
      : 100;

    const kpiValueByCode: Record<string, { value: number; unit: string; metricStatus: 'ready' | 'watch' | 'blocked' }> = {
      ownership_coverage: {
        value: ownershipCoverage,
        unit: '%',
        metricStatus: ownershipCoverage >= 80 ? 'ready' : 'watch',
      },
      workflow_sla_health: {
        value: workflowSlaHealth,
        unit: '%',
        metricStatus: overdueTasks === 0 ? 'ready' : 'watch',
      },
      quality_pressure: {
        value: qualityPressurePct,
        unit: '%',
        metricStatus: qualityPressurePct <= 10 ? 'ready' : 'watch',
      },
      audit_evidence_readiness: {
        value: auditRows,
        unit: 'records',
        metricStatus: auditRows > 0 ? 'ready' : 'watch',
      },
      operating_cadence_readiness: {
        value: cadenceCoverage,
        unit: '%',
        metricStatus: cadenceCoverage >= 100 ? 'ready' : 'watch',
      },
    };

    const dgpoSizing = dgpoSizingGuidance({
      governedAssets,
      dataDomains,
      systemPlatforms,
      activeCases,
      openTasks,
    });

    const bodies = OPERATING_BODY_DEFINITIONS.map((body) => {
      const definitionStatus = operatingDefinitionStatus(body);
      const pressure =
        body.code === 'dgsc'
          ? activeEscalations
          : body.code === 'data_council'
            ? openQualityIssues
            : body.code === 'dmo'
              ? openTasks
              : body.code === 'domain_council'
                ? activeCases
                : 0;
      const status = combineReadinessStatus([
        definitionStatus,
        operatingPressureStatus({
          bodyCode: body.code,
          pressure,
          governedAssets,
          dataDomains,
          recommendedFte: dgpoSizing.recommendedFte,
        }),
      ]);
      return { ...body, status, operatingPressure: pressure };
    });

    const kpiTraceability = EXECUTIVE_KPI_DEFINITIONS.map((definition) => {
      const metric = kpiValueByCode[definition.code] ?? { value: 0, unit: 'count', metricStatus: 'watch' as const };
      return {
        ...definition,
        value: metric.value,
        unit: metric.unit,
        status: combineReadinessStatus([kpiTraceabilityStatus(definition), metric.metricStatus]),
      };
    });

    const charterLifecycle = {
      code: 'charter_lifecycle',
      status: lifecycleReadiness(CHARTER_LIFECYCLE_STEPS),
      steps: CHARTER_LIFECYCLE_STEPS,
    };
    const policyLifecycle = {
      code: 'policy_lifecycle',
      status: lifecycleReadiness(POLICY_LIFECYCLE_STEPS),
      steps: POLICY_LIFECYCLE_STEPS,
    };
    const status = combineReadinessStatus([
      ...bodies.map((body) => body.status),
      ...kpiTraceability.map((kpi) => kpi.status),
      charterLifecycle.status,
      policyLifecycle.status,
    ]);

    return {
      generatedAt: now.toISOString(),
      status,
      scope: {
        restricted: !this.isUnrestricted(scope),
        assetVisibility: assetIds === 'all' ? 'all' : assetIds.size,
      },
      summary: {
        governedAssets,
        assignedAssets,
        dataDomains,
        systemPlatforms,
        activePeople,
        activeCases,
        openTasks,
        overdueTasks,
        openQualityIssues,
        activeEscalations,
      },
      bodies,
      ceremonies: OPERATING_CEREMONY_DEFINITIONS.map((ceremony) => ({
        ...ceremony,
        status: ceremony.outputs.length > 0 ? 'ready' : 'watch',
      })),
      lifecycles: [charterLifecycle, policyLifecycle],
      decisionFlow: [
        { from: 'working_group', to: 'domain_council', decision: 'Prepare recommendation and domain impact' },
        { from: 'domain_council', to: 'data_council', decision: 'Resolve cross-domain or policy-impacting decisions' },
        { from: 'data_council', to: 'dgsc', decision: 'Escalate executive risk, funding, or exception acceptance' },
      ],
      dgpoSizing,
      kpiTraceability,
      gapRegister: [
        {
          code: 'external_minutes_repository',
          status: 'deferred',
          reason: 'DGOP tracks decisions and evidence internally; external board-pack repository integration remains optional.',
        },
        {
          code: 'formal_hr_capacity_model',
          status: 'deferred',
          reason: 'DGPO sizing guidance is calculated in-platform; HR-grade capacity planning remains outside this sprint.',
        },
      ],
    };
  }

  async platformArchitecture(user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const caseWhere = this.workflowCaseScopeWhere(assetIds, user);
    const now = new Date();
    const [
      workflowTemplates,
      workflowCases,
      workflowTasks,
      overdueTasks,
      evidenceRecords,
      approvedEvidence,
      auditPacks,
      ndiSpecs,
      governedAssets,
      activePeople,
      integrationConnectors,
      integrationEvents,
      integrationProblemEvents,
      failedBatches,
      roleDataMaps,
      abacDecisionLogs,
      maskingPolicies,
      notifications,
      escalations,
      auditRows,
      reconciliationReports,
      auditChain,
    ] = await Promise.all([
      this.prisma.workflowTemplate.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.workflowCase.count({ where: caseWhere }),
      this.prisma.workflowTask.count({ where: { case: caseWhere } }),
      this.prisma.workflowTask.count({
        where: {
          case: caseWhere,
          status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.ndiEvidence.count({ where: { deletedAt: null } }),
      this.prisma.ndiEvidence.count({ where: { deletedAt: null, status: NdiEvidenceStatus.approved } }),
      this.prisma.ndiAuditPack.count(),
      this.prisma.ndiSpecification.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.dataAsset.count({ where: this.assetScopeWhere(scope) }),
      this.prisma.person.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.integrationConnector.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.integrationEvent.count(),
      this.prisma.integrationEvent.count({
        where: { status: { in: [IntegrationEventStatus.failed, IntegrationEventStatus.retry_scheduled, IntegrationEventStatus.dead_letter] } },
      }),
      this.prisma.integrationImportBatch.count({
        where: { status: { in: [IntegrationBatchStatus.completed_with_errors, IntegrationBatchStatus.failed] } },
      }),
      this.prisma.roleDataAccessMap.count({ where: { isActive: true } }),
      this.prisma.abacDecisionLog.count(),
      this.prisma.maskingPolicy.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.governanceNotification.count(),
      this.prisma.governanceEscalation.count({
        where: {
          workflowCase: caseWhere,
          status: { in: [GovernanceEscalationStatus.open, GovernanceEscalationStatus.acknowledged] },
        },
      }),
      this.prisma.auditLog.count(),
      this.prisma.integrationReconciliationReport.count(),
      this.audit.verifyChain(1000),
    ]);

    const dataSignals: Record<string, number> = {
      workflow_engine: workflowTemplates + workflowCases + workflowTasks,
      evidence_engine: evidenceRecords + approvedEvidence + auditPacks,
      ndi_scoring_engine: ndiSpecs + evidenceRecords,
      unified_search_service: governedAssets + activePeople + workflowCases + ndiSpecs,
      integration_adapter_service: integrationConnectors + integrationEvents + reconciliationReports,
      scope_abac_engine: roleDataMaps + abacDecisionLogs,
      masking_service: maskingPolicies,
      notification_sla_engine: notifications + escalations + workflowTasks,
      audit_chain: auditRows,
      reporting_service: reconciliationReports + auditPacks + ndiSpecs,
    };
    const openRisks: Record<string, number> = {
      workflow_engine: overdueTasks,
      evidence_engine: Math.max(0, evidenceRecords - approvedEvidence),
      ndi_scoring_engine: ndiSpecs > 0 && evidenceRecords === 0 ? 1 : 0,
      unified_search_service: 0,
      integration_adapter_service: integrationProblemEvents + failedBatches,
      scope_abac_engine: roleDataMaps === 0 ? 1 : 0,
      masking_service: maskingPolicies === 0 ? 1 : 0,
      notification_sla_engine: escalations,
      audit_chain: auditChain.valid ? 0 : 1,
      reporting_service: 0,
    };

    const serviceCodes = new Set(PLATFORM_SERVICE_DEFINITIONS.map((definition) => definition.code));
    const services = PLATFORM_SERVICE_DEFINITIONS.map((definition) => {
      const input = {
        implemented: true,
        dataSignals: dataSignals[definition.code] ?? 0,
        openRisks: openRisks[definition.code] ?? 0,
        wiredDependencies: definition.dependencies.filter((dependency) => serviceCodes.has(dependency)).length,
        requiredDependencies: definition.dependencies.length,
      };
      return {
        ...definition,
        status: platformServiceStatus(input),
        signals: input,
      };
    });

    const boundedContexts = [...new Set(services.map((service) => service.boundedContext))].map((boundedContext) => ({
      code: boundedContext,
      services: services.filter((service) => service.boundedContext === boundedContext).length,
      status: platformArchitectureStatus(
        services.filter((service) => service.boundedContext === boundedContext).map((service) => service.status),
      ),
    }));

    return {
      generatedAt: now.toISOString(),
      status: platformArchitectureStatus(services.map((service) => service.status)),
      scope: {
        restricted: !this.isUnrestricted(scope),
        assetVisibility: assetIds === 'all' ? 'all' : assetIds.size,
      },
      summary: {
        services: services.length,
        ready: services.filter((service) => service.status === 'ready').length,
        watch: services.filter((service) => service.status === 'watch').length,
        blocked: services.filter((service) => service.status === 'blocked').length,
        boundedContexts: boundedContexts.length,
        openRisks: services.reduce((sum, service) => sum + service.signals.openRisks, 0),
      },
      services,
      boundedContexts,
      dependencyMap: services.flatMap((service) =>
        service.dependencies.map((dependency) => ({
          from: service.code,
          to: dependency,
          status: serviceCodes.has(dependency) ? 'wired' : 'missing',
        })),
      ),
    };
  }

  async recalculateSla(user: AuthUser) {
    await this.ensureDefaultCalendarTemplates();
    const { holidayDates, recurringHolidayDates } = await this.holidayConfig();
    const tasks = await this.prisma.workflowTask.findMany({
      where: await this.scopedTaskWhere(user),
      include: taskInclude,
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    let notifications = 0;
    let escalations = 0;
    let clearedNotifications = 0;
    let resolvedEscalations = 0;
    const now = new Date();
    const scopedTaskIds = tasks.map((task) => task.id);
    const activeNotificationTaskIds = new Set<string>();
    const activeEscalationTaskIds = new Set<string>();
    for (const task of tasks) {
      const signal = ksaSlaSignal(task, now, holidayDates, recurringHolidayDates);
      if (signal !== 'at_risk' && signal !== 'overdue') continue;
      activeNotificationTaskIds.add(task.id);
      const overdueBusinessDays = task.dueDate ? Math.max(0, businessDaysBetween(task.dueDate, now, holidayDates, recurringHolidayDates)) : 0;
      const severity = notificationSeverity(signal, overdueBusinessDays);
      const notificationKey = workflowTaskSignalKey(task.id, 'notification');
      const existingNotice = await this.prisma.governanceNotification.findUnique({
        where: { dedupeKey: notificationKey },
        select: { id: true },
      });
      if (!existingNotice) {
        await this.prisma.governanceNotification.create({
          data: {
            dedupeKey: notificationKey,
            title: signal === 'overdue' ? `Workflow task overdue: ${task.title}` : `Workflow task at risk: ${task.title}`,
            message: `${task.case.code} needs attention using KSA business-day SLA.`,
            severity,
            sourceType: 'workflow_task',
            sourceId: task.id,
            assigneeUserId: task.assigneeUserId ?? null,
            targetRoleCode: task.assigneeUserId ? null : 'dmo_admin',
            workflowCaseId: task.caseId,
            workflowTaskId: task.id,
            emailTo: task.assignee?.email ?? null,
            createdBy: user.email,
          },
        });
        notifications++;
      } else {
        await this.prisma.governanceNotification.update({
          where: { id: existingNotice.id },
          data: {
            title: signal === 'overdue' ? `Workflow task overdue: ${task.title}` : `Workflow task at risk: ${task.title}`,
            message: `${task.case.code} needs attention using KSA business-day SLA.`,
            severity,
            assigneeUserId: task.assigneeUserId ?? null,
            targetRoleCode: task.assigneeUserId ? null : 'dmo_admin',
            workflowCaseId: task.caseId,
            workflowTaskId: task.id,
            emailTo: task.assignee?.email ?? null,
          },
        });
      }
      if (signal === 'overdue') {
        activeEscalationTaskIds.add(task.id);
        const level = escalationLevel(overdueBusinessDays);
        const escalationKey = workflowTaskSignalKey(task.id, 'escalation');
        const existing = await this.prisma.governanceEscalation.findUnique({
          where: { dedupeKey: escalationKey },
          select: { id: true, status: true },
        });
        if (
          existing &&
          (existing.status === GovernanceEscalationStatus.open ||
            existing.status === GovernanceEscalationStatus.acknowledged)
        ) {
          await this.prisma.governanceEscalation.update({
            where: { id: existing.id },
            data: { level, penaltyPoints: escalationPenalty(overdueBusinessDays), dueAt: task.dueDate, updatedBy: user.email },
          });
        } else if (!existing) {
          await this.prisma.governanceEscalation.create({
            data: {
              dedupeKey: escalationKey,
              code: await this.nextCode('governanceEscalation', 'ESC'),
              level,
              sourceType: 'workflow_task',
              sourceId: task.id,
              reason: `${task.case.code} is ${overdueBusinessDays} KSA business day(s) overdue.`,
              penaltyPoints: escalationPenalty(overdueBusinessDays),
              ownerRoleCode: this.ownerRoleForLevel(level),
              dueAt: task.dueDate,
              workflowCaseId: task.caseId,
              workflowTaskId: task.id,
              createdBy: user.email,
            },
          });
          escalations++;
        }
      }
    }
    if (scopedTaskIds.length) {
      const cleared = await this.prisma.governanceNotification.updateMany({
        where: {
          sourceType: 'workflow_task',
          workflowTaskId: { in: scopedTaskIds },
          status: { not: GovernanceNotificationStatus.archived },
          ...(activeNotificationTaskIds.size
            ? { NOT: { workflowTaskId: { in: [...activeNotificationTaskIds] } } }
            : {}),
        },
        data: { status: GovernanceNotificationStatus.archived },
      });
      clearedNotifications = cleared.count;
      const resolved = await this.prisma.governanceEscalation.updateMany({
        where: {
          workflowTaskId: { in: scopedTaskIds },
          status: { in: [GovernanceEscalationStatus.open, GovernanceEscalationStatus.acknowledged] },
          ...(activeEscalationTaskIds.size
            ? { NOT: { workflowTaskId: { in: [...activeEscalationTaskIds] } } }
            : {}),
        },
        data: { status: GovernanceEscalationStatus.resolved, updatedBy: user.email },
      });
      resolvedEscalations = resolved.count;
    }
    await this.audit.log({
      actor: user.email,
      action: 'governance_operations.sla_recalculate',
      entityType: 'workflow_task',
      entityId: 'bulk',
      metadata: { notifications, escalations, clearedNotifications, resolvedEscalations },
    });
    return { notifications, escalations, clearedNotifications, resolvedEscalations, workspace: await this.workspace(user) };
  }

  async generateCalendarOccurrences(user: AuthUser) {
    await this.ensureDefaultCalendarTemplates();
    const workflow = this.workflow;
    if (!workflow) throw new BadRequestException('Workflow engine is unavailable');
    const { holidayDates, recurringHolidayDates } = await this.holidayConfig();
    const now = new Date();
    const templates = await this.prisma.complianceCalendarTemplate.findMany({
      where: { status: ComplianceCalendarStatus.active, nextRunAt: { lte: now } },
    });
    let created = 0;
    for (const template of templates) {
      const dueAt = addKsaBusinessDays(template.nextRunAt, template.defaultSlaBusinessDays, holidayDates, recurringHolidayDates);
      const key = template.nextRunAt.toISOString().slice(0, 10).replace(/-/g, '');
      const code = `${template.code}-${key}`;
      const exists = await this.prisma.complianceCalendarOccurrence.findUnique({ where: { code }, select: { id: true } });
      if (!exists) {
        await this.prisma.$transaction(async (tx) => {
          const workflowCase = await workflow.openRoutedCase({
            roleCodes: user.roles,
            actor: user.email,
            title: template.title,
            description: `Recurring compliance calendar item: ${template.type}.`,
            type: 'compliance_calendar',
            status: CaseStatus.submitted,
            initialDueDate: dueAt,
            initialTaskTitle: template.title,
            preferredCode: await this.nextWorkflowCode(tx, 'WF-CAL'),
          }, tx);
          await tx.workflowEvent.create({
            data: {
              caseId: workflowCase.id,
              actor: user.email,
              action: 'workflow.create',
              toStatus: CaseStatus.submitted,
              comment: 'Created from recurring compliance calendar.',
            },
          });
          await tx.complianceCalendarOccurrence.create({
            data: {
              templateId: template.id,
              code,
              title: template.title,
              dueAt,
              workflowCaseId: workflowCase.id,
              createdBy: user.email,
            },
          });
        });
        created++;
      }
      await this.prisma.complianceCalendarTemplate.update({
        where: { id: template.id },
        data: { lastRunAt: now, nextRunAt: this.nextCalendarRun(template.nextRunAt, template.cadence), updatedBy: user.email },
      });
    }
    await this.audit.log({
      actor: user.email,
      action: 'governance_operations.calendar_generate',
      entityType: 'compliance_calendar_occurrence',
      entityId: 'bulk',
      metadata: { created },
    });
    return { created, workspace: await this.workspace(user) };
  }

  async createTemplate(dto: CreateComplianceCalendarTemplateDto, actor: string) {
    const nextRunAt = this.parseDate(dto.nextRunAt);
    const row = await this.prisma.complianceCalendarTemplate.create({
      data: {
        code: await this.nextCode('complianceCalendarTemplate', 'CAL'),
        title: dto.title,
        type: dto.type,
        cadence: dto.cadence,
        ownerRoleCode: dto.ownerRoleCode ?? null,
        nextRunAt,
        defaultSlaBusinessDays: dto.defaultSlaBusinessDays ?? 5,
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'governance_operations.calendar_template.create', entityType: 'compliance_calendar_template', entityId: row.id, metadata: { code: row.code } });
    return row;
  }

  async updateTemplate(id: string, dto: UpdateComplianceCalendarTemplateDto, actor: string) {
    const existing = await this.prisma.complianceCalendarTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('compliance_calendar_template not found');
    const row = await this.prisma.complianceCalendarTemplate.update({
      where: { id },
      data: {
        title: dto.title,
        cadence: dto.cadence,
        ownerRoleCode: dto.ownerRoleCode,
        nextRunAt: dto.nextRunAt ? this.parseDate(dto.nextRunAt) : undefined,
        defaultSlaBusinessDays: dto.defaultSlaBusinessDays,
        status: dto.status,
        updatedBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'governance_operations.calendar_template.update', entityType: 'compliance_calendar_template', entityId: id });
    return row;
  }

  async createHoliday(dto: CreateKsaHolidayDto, actor: string) {
    const row = await this.prisma.ksaHoliday.create({
      data: {
        date: this.parseDate(dto.date),
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        isRecurring: dto.isRecurring ?? false,
        createdBy: actor,
      },
    });
    await this.audit.log({ actor, action: 'governance_operations.holiday.create', entityType: 'ksa_holiday', entityId: row.id, metadata: { date: row.date.toISOString() } });
    return row;
  }

  async notificationDigest(user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const where = this.notificationVisibilityWhere(assetIds, user);
    const [notifications, activeEscalations] = await Promise.all([
      this.prisma.governanceNotification.findMany({
        where,
        include: notificationInclude,
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      }),
      this.prisma.governanceEscalation.count({
        where: {
          AND: [
            this.workflowLinkedEscalationScopeWhere(assetIds, user),
            { status: { in: [GovernanceEscalationStatus.open, GovernanceEscalationStatus.acknowledged] } },
          ],
        },
      }),
    ]);
    return this.notificationLayer(notifications, activeEscalations);
  }

  async createNotification(dto: CreateGovernanceNotificationDto, user: AuthUser) {
    const title = this.requireTrimmed(dto.title, 'title');
    const message = this.requireTrimmed(dto.message, 'message');
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const target = await this.resolveNotificationCreateData(dto, user, assetIds);
    if (target.dedupeKey) {
      const existing = await this.prisma.governanceNotification.findUnique({
        where: { dedupeKey: target.dedupeKey },
        select: { id: true },
      });
      if (existing) throw new ConflictException('governance_notification already exists');
    }
    try {
      const row = await this.prisma.governanceNotification.create({
        data: {
          dedupeKey: target.dedupeKey,
          title,
          message,
          severity: dto.severity ?? GovernanceNotificationSeverity.info,
          sourceType: target.sourceType,
          sourceId: target.sourceId,
          targetRoleCode: target.targetRoleCode,
          assigneeUserId: target.assigneeUserId,
          workflowCaseId: target.workflowCaseId,
          workflowTaskId: target.workflowTaskId,
          emailTo: target.emailTo,
          createdBy: user.email,
        },
        include: notificationInclude,
      });
      await this.audit.log({
        actor: user.email,
        action: 'governance_operations.notification.create',
        entityType: 'governance_notification',
        entityId: row.id,
        metadata: {
          severity: row.severity,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          targetRoleCode: row.targetRoleCode,
          assigneeUserId: row.assigneeUserId,
          workflowCaseId: row.workflowCaseId,
          workflowTaskId: row.workflowTaskId,
        },
      });
      return this.enrichNotification(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('governance_notification already exists');
      }
      throw error;
    }
  }

  async readNotification(id: string, user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const row = await this.prisma.governanceNotification.findFirst({
      where: {
        AND: [
          { id },
          this.notificationVisibilityWhere(assetIds, user),
        ],
      },
    });
    if (!row) throw new NotFoundException('governance_notification not found');
    const updated = await this.prisma.governanceNotification.update({
      where: { id },
      data: { status: GovernanceNotificationStatus.read, readAt: new Date() },
    });
    await this.audit.log({
      actor: user.email,
      action: 'governance_operations.notification.read',
      entityType: 'governance_notification',
      entityId: id,
      metadata: { previousStatus: row.status, targetRoleCode: row.targetRoleCode },
    });
    return updated;
  }

  async updateNotification(id: string, dto: UpdateNotificationDto, user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const row = await this.prisma.governanceNotification.findFirst({
      where: {
        AND: [
          { id },
          this.notificationVisibilityWhere(assetIds, user),
        ],
      },
    });
    if (!row) throw new NotFoundException('governance_notification not found');
    const updated = await this.prisma.governanceNotification.update({
      where: { id },
      data: {
        status: dto.status,
        readAt:
          dto.status === GovernanceNotificationStatus.read || dto.status === GovernanceNotificationStatus.archived
            ? row.readAt ?? new Date()
            : null,
      },
      include: notificationInclude,
    });
    await this.audit.log({
      actor: user.email,
      action: 'governance_operations.notification.update',
      entityType: 'governance_notification',
      entityId: id,
      metadata: { previousStatus: row.status, status: dto.status },
    });
    return this.enrichNotification(updated);
  }

  async dispatchNotifications(dto: DispatchNotificationsDto, user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const where: Prisma.GovernanceNotificationWhereInput = {
      AND: [
        this.notificationVisibilityWhere(assetIds, user),
        { status: GovernanceNotificationStatus.unread },
      ],
    };
    const notifications = await this.prisma.governanceNotification.findMany({
      where,
      include: notificationInclude,
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    });
    const layer = this.notificationLayer(notifications);
    await this.audit.log({
      actor: user.email,
      action: 'governance_operations.notification.dispatch_plan',
      entityType: 'governance_notification',
      entityId: 'bulk',
      metadata: {
        dryRun: dto.dryRun ?? true,
        planned: notifications.length,
        externalDeliveryEnabled: this.externalNotificationDeliveryEnabled(),
        channels: layer.summary.byChannel,
        priorities: layer.summary.byPriority,
      },
    });
    return {
      dryRun: dto.dryRun ?? true,
      dispatched: 0,
      planned: notifications.length,
      externalDeliveryEnabled: this.externalNotificationDeliveryEnabled(),
      note: 'External channels are planned for connector delivery; in-app notifications remain the persisted system of record.',
      ...layer,
    };
  }

  async updateEscalation(id: string, dto: UpdateEscalationDto, user: AuthUser) {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    const row = await this.prisma.governanceEscalation.findFirst({
      where: {
        AND: [
          { id },
          this.workflowLinkedEscalationScopeWhere(assetIds, user),
        ],
      },
    });
    if (!row) throw new NotFoundException('governance_escalation not found');
    const updated = await this.prisma.governanceEscalation.update({
      where: { id },
      data: {
        status: dto.status,
        acknowledgedAt: dto.status === GovernanceEscalationStatus.acknowledged ? new Date() : undefined,
        resolvedAt: dto.status === GovernanceEscalationStatus.resolved ? new Date() : undefined,
        updatedBy: user.email,
      },
    });
    await this.audit.log({ actor: user.email, action: 'governance_operations.escalation.update', entityType: 'governance_escalation', entityId: id, metadata: { status: dto.status } });
    return updated;
  }

  private async ensureDefaultCalendarTemplates() {
    const nextMonth = new Date();
    nextMonth.setUTCDate(1);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    nextMonth.setUTCHours(9, 0, 0, 0);
    const nextYear = new Date(Date.UTC(nextMonth.getUTCFullYear() + 1, 0, 15, 9));
    const seeds: Array<{ code: string; title: string; type: ComplianceCalendarType; cadence: string; ownerRoleCode: string; nextRunAt: Date; defaultSlaBusinessDays: number }> = [
      { code: 'CAL-ROPA', title: 'Processing activity review', type: ComplianceCalendarType.processing_activity_review, cadence: 'quarterly', ownerRoleCode: 'privacy_officer', nextRunAt: nextMonth, defaultSlaBusinessDays: 10 },
      { code: 'CAL-XBORDER', title: 'Cross-border transfer monitoring', type: ComplianceCalendarType.cross_border_transfer_monitoring, cadence: 'monthly', ownerRoleCode: 'privacy_officer', nextRunAt: nextMonth, defaultSlaBusinessDays: 5 },
      { code: 'CAL-DPIA', title: 'Annual DPIA review', type: ComplianceCalendarType.annual_dpia_review, cadence: 'annual', ownerRoleCode: 'privacy_officer', nextRunAt: nextYear, defaultSlaBusinessDays: 15 },
      { code: 'CAL-DQ', title: 'Monthly DQ scorecard review', type: ComplianceCalendarType.monthly_dq_scorecard_review, cadence: 'monthly', ownerRoleCode: 'dq_steward', nextRunAt: nextMonth, defaultSlaBusinessDays: 5 },
    ];
    for (const seed of seeds) {
      const existing = await this.prisma.complianceCalendarTemplate.findUnique({ where: { code: seed.code }, select: { id: true } });
      if (!existing) {
        await this.prisma.complianceCalendarTemplate.create({
          data: { ...seed, createdBy: 'system' },
        });
      }
    }
  }

  private escalationGraph(escalations: Array<{
    id: string;
    code: string;
    level: GovernanceEscalationLevel;
    status: GovernanceEscalationStatus;
    penaltyPoints: number;
    workflowCase: { code: string; title: string } | null;
    workflowTask: { title: string; dueDate: Date | null } | null;
  }>) {
    const levels = [
      GovernanceEscalationLevel.domain_council,
      GovernanceEscalationLevel.data_stewardship_council,
      GovernanceEscalationLevel.data_governance_board,
      GovernanceEscalationLevel.executive_steering_committee,
    ];
    const nodes: Record<string, unknown>[] = levels.map((level, index) => ({
      id: `level:${level}`,
      type: 'level',
      label: ESCALATION_LEVEL_LABELS[level],
      status: escalations.some((row) => row.level === level) ? 'review' : 'healthy',
      count: escalations.filter((row) => row.level === level).length,
      x: 8 + index * 28,
      y: 18,
    }));
    const edges: Record<string, unknown>[] = [];
    for (let index = 0; index < levels.length - 1; index++) {
      edges.push({ id: `level:${levels[index]}->${levels[index + 1]}`, from: `level:${levels[index]}`, to: `level:${levels[index + 1]}`, label: 'escalates to', tone: 'muted' });
    }
    escalations.slice(0, 12).forEach((row, index) => {
      const nodeId = `escalation:${row.id}`;
      nodes.push({
        id: nodeId,
        type: 'escalation',
        label: row.workflowCase?.code ?? row.code,
        sublabel: row.workflowTask?.title ?? row.workflowCase?.title ?? row.status,
        status: row.level === GovernanceEscalationLevel.executive_steering_committee ? 'critical' : 'warning',
        count: row.penaltyPoints,
        x: 8 + (index % 4) * 28,
        y: 58 + Math.floor(index / 4) * 18,
      });
      edges.push({ id: `edge:${row.id}`, from: `level:${row.level}`, to: nodeId, label: 'owns', tone: 'warning' });
    });
    return { nodes, edges };
  }

  private ownerRoleForLevel(level: GovernanceEscalationLevel): string {
    if (level === GovernanceEscalationLevel.executive_steering_committee) return 'executive';
    if (level === GovernanceEscalationLevel.data_governance_board) return 'dmo_admin';
    if (level === GovernanceEscalationLevel.data_stewardship_council) return 'enterprise_data_steward';
    return 'data_owner';
  }

  private nextCalendarRun(current: Date, cadence: string): Date {
    const next = new Date(current);
    if (cadence === 'annual') next.setUTCFullYear(next.getUTCFullYear() + 1);
    else if (cadence === 'quarterly') next.setUTCMonth(next.getUTCMonth() + 3);
    else if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  private parseDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid date value');
    return parsed;
  }

  private async nextCode(model: 'governanceEscalation' | 'complianceCalendarTemplate', prefix: string): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const where = { code: { startsWith: `${prefix}-${day}` } };
    const count =
      model === 'governanceEscalation'
        ? await this.prisma.governanceEscalation.count({ where })
        : await this.prisma.complianceCalendarTemplate.count({ where });
    return `${prefix}-${day}-${String(count + 1).padStart(3, '0')}`;
  }

  private async nextWorkflowCode(tx: Prisma.TransactionClient, prefix: string): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await tx.workflowCase.count({ where: { code: { startsWith: `${prefix}-${day}` } } });
    return `${prefix}-${day}-${String(count + 1).padStart(3, '0')}`;
  }
}
