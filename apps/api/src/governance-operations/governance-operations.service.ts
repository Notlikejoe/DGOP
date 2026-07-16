import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  CaseStatus,
  ComplianceCalendarStatus,
  ComplianceCalendarType,
  GovernanceEscalationLevel,
  GovernanceEscalationStatus,
  GovernanceNotificationStatus,
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
  CreateKsaHolidayDto,
  UpdateComplianceCalendarTemplateDto,
  UpdateEscalationDto,
} from './governance-operations.dto';
import {
  ESCALATION_LEVEL_LABELS,
  addKsaBusinessDays,
  businessDaysBetween,
  dateKey,
  escalationLevel,
  escalationPenalty,
  ksaSlaSignal,
  notificationSeverity,
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

function workflowTaskSignalKey(taskId: string, kind: 'notification' | 'escalation'): string {
  return `workflow_task:${taskId}:${kind}`;
}

@Injectable()
export class GovernanceOperationsService implements OnModuleInit, OnModuleDestroy {
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

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.GOVERNANCE_OPERATIONS_SCHEDULER === 'false') return;
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
      await this.recalculateSla(this.systemUser);
      await this.generateCalendarOccurrences(this.systemUser);
    } catch (error) {
      console.warn('Governance operations scheduler failed', error instanceof Error ? error.message : error);
    } finally {
      this.slaWorkerRunning = false;
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
      visible.push({ AND: [{ assetId: null }, { createdBy: user.email }] });
      visible.push({ AND: [{ assetId: null }, { tasks: { some: { assigneeUserId: user.id } } }] });
    }
    return visible.length ? { OR: visible } : { id: '__no_visible_governance_operations__' };
  }

  private async scopedTaskWhere(user: AuthUser): Promise<Prisma.WorkflowTaskWhereInput> {
    const scope = await this.scope.resolve(user.roles);
    const assetIds = await this.visibleAssetIds(scope);
    return {
      status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      case: this.workflowCaseScopeWhere(assetIds, user),
    };
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
    await this.ensureDefaultCalendarTemplates();
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
        where: {
          OR: [
            { assigneeUserId: user.id },
            { targetRoleCode: { in: user.roles } },
            { AND: [{ assigneeUserId: null }, { targetRoleCode: null }] },
          ],
        },
        include: {
          workflowCase: { select: { id: true, code: true, title: true, status: true } },
          workflowTask: { select: { id: true, title: true, status: true, dueDate: true } },
        },
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
        include: { occurrences: { orderBy: { dueAt: 'asc' }, take: 5 } },
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
      notifications,
      escalations,
      templates,
      occurrences,
      holidays,
      graph: this.escalationGraph(escalations),
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
    const now = new Date();
    for (const task of tasks) {
      const signal = ksaSlaSignal(task, now, holidayDates, recurringHolidayDates);
      if (signal !== 'at_risk' && signal !== 'overdue') continue;
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
    await this.audit.log({
      actor: user.email,
      action: 'governance_operations.sla_recalculate',
      entityType: 'workflow_task',
      entityId: 'bulk',
      metadata: { notifications, escalations },
    });
    return { notifications, escalations, workspace: await this.workspace(user) };
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

  async readNotification(id: string, user: AuthUser) {
    const row = await this.prisma.governanceNotification.findFirst({
      where: {
        id,
        OR: [{ assigneeUserId: user.id }, { targetRoleCode: { in: user.roles } }, { AND: [{ assigneeUserId: null }, { targetRoleCode: null }] }],
      },
    });
    if (!row) throw new NotFoundException('governance_notification not found');
    return this.prisma.governanceNotification.update({
      where: { id },
      data: { status: GovernanceNotificationStatus.read, readAt: new Date() },
    });
  }

  async updateEscalation(id: string, dto: UpdateEscalationDto, user: AuthUser) {
    const row = await this.prisma.governanceEscalation.findUnique({ where: { id } });
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
