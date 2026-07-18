import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  ApprovalStatus,
  AssignmentTargetType,
  CaseStatus,
  Prisma,
  TaskDecision,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import { AssignmentsService } from '../ownership/assignments.service';
import { AuthUser } from '../auth/auth.types';
import { parsePageParams, toPaged } from '../common/pagination';
import {
  AddTaskDto,
  CreateCaseDto,
  DecisionDto,
  SubmitAssignmentDto,
  UpdateCaseDto,
  UpdateTaskDto,
  WorkflowRoutePreviewDto,
} from './workflow.dto';
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  buildWorkflowCaseTypeRegistry,
  buildWorkflowEscalationTemplates,
  buildWorkflowNotificationRules,
  buildWorkflowSlaTemplates,
  firstActionableWorkflowStage,
  isActionableWorkflowStage,
  routeGateForOpenStagePeers,
  selectWorkflowTransitionForDecision,
  selectWorkflowTemplate,
  WORKFLOW_CASE_TYPES,
  WORKFLOW_TASK_TYPES,
  workflowHealth,
  type WorkflowRouteCandidate,
  type WorkflowStageRouteNode,
  type WorkflowTemplateSeed,
} from './workflow.logic';

export type SlaStatus = 'none' | 'on_track' | 'at_risk' | 'overdue' | 'done';

const AT_RISK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // within 2 days of due date
const DMO_ADMIN_CODE = 'dmo_admin';
const ADMIN_ROLES = ['system_admin', DMO_ADMIN_CODE];
const DATA_OWNER_CODE = 'data_owner';
type PrismaWriter = PrismaService | Prisma.TransactionClient;
const FINAL_CASE_STATUSES: readonly CaseStatus[] = [
  CaseStatus.closed,
  CaseStatus.implemented,
  CaseStatus.rejected,
];
const WORKFLOW_CASE_DEFAULT_PAGE_SIZE = 50;
const WORKFLOW_TASK_DEFAULT_PAGE_SIZE = 50;
const WORKFLOW_GRAPH_CASE_LIMIT = 200;
const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  [CaseStatus.draft]: [CaseStatus.submitted, CaseStatus.closed],
  [CaseStatus.submitted]: [CaseStatus.under_review, CaseStatus.awaiting_information, CaseStatus.rejected, CaseStatus.closed],
  [CaseStatus.under_review]: [
    CaseStatus.awaiting_information,
    CaseStatus.decision_made,
    CaseStatus.approved,
    CaseStatus.rejected,
    CaseStatus.closed,
  ],
  [CaseStatus.awaiting_information]: [CaseStatus.under_review, CaseStatus.rejected, CaseStatus.closed],
  [CaseStatus.decision_made]: [CaseStatus.approved, CaseStatus.rejected, CaseStatus.closed],
  [CaseStatus.approved]: [CaseStatus.implemented, CaseStatus.closed],
  [CaseStatus.rejected]: [CaseStatus.closed],
  [CaseStatus.implemented]: [CaseStatus.closed],
  [CaseStatus.closed]: [],
};

const taskInclude = {
  assignee: { select: { id: true, email: true, displayName: true } },
  templateStage: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      kind: true,
      sortOrder: true,
      isDecision: true,
      isFinal: true,
    },
  },
};

const caseInclude = {
  template: { select: { id: true, code: true, caseType: true, nameEn: true, nameAr: true } },
  asset: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
  },
  assignment: {
    include: {
      roleType: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      person: { select: { id: true, fullNameEn: true, fullNameAr: true } },
    },
  },
  tasks: { include: taskInclude, orderBy: { createdAt: 'asc' as const } },
};

const templateInclude = {
  domain: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  stages: { orderBy: { sortOrder: 'asc' as const } },
  transitions: {
    include: {
      fromStage: { select: { id: true, code: true } },
      toStage: { select: { id: true, code: true } },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
  _count: { select: { cases: true, stages: true } },
};

type WorkflowTemplateWithRoute = Prisma.WorkflowTemplateGetPayload<{ include: typeof templateInclude }>;
type WorkflowRouteSelection = { template: WorkflowTemplateWithRoute; domainId: string | null };
type WorkflowStageWithRoute = WorkflowTemplateWithRoute['stages'][number];
type WorkflowTransitionWithRoute = WorkflowTemplateWithRoute['transitions'][number];
type RouteAdvancePlan = {
  fromStage: WorkflowStageWithRoute;
  transition?: WorkflowTransitionWithRoute | null;
  nextStage?: WorkflowStageWithRoute | null;
  finalStatus?: CaseStatus | null;
  toStatus?: CaseStatus | null;
};
type WorkflowWriter = PrismaService | Prisma.TransactionClient;

@Injectable()
export class WorkflowService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly assignments: AssignmentsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaultTemplates();
      const backfilled = await this.backfillUnroutedOpenCases();
      const reassigned = await this.assignUnownedRoutedTasks();
      const normalizedSla = await this.normalizeImmediateSlaDueDates();
      if (backfilled > 0) {
        this.logger.log(`Backfilled ${backfilled} unrouted workflow cases into route templates`);
      }
      if (reassigned > 0) {
        this.logger.log(`Assigned ${reassigned} routed workflow tasks to eligible role holders`);
      }
      if (normalizedSla > 0) {
        this.logger.log(`Normalized ${normalizedSla} immediate workflow task due dates`);
      }
    } catch (err) {
      this.logger.error('Failed to initialize default workflow templates', err as Error);
    }
  }

  // ---------- SLA ----------
  /** Derives an SLA badge from a task's due date and completion state. */
  slaOf(task: { status: TaskStatus; dueDate: Date | null; completedAt: Date | null }): SlaStatus {
    if (task.status === TaskStatus.completed || task.status === TaskStatus.cancelled) return 'done';
    if (!task.dueDate) return 'none';
    const remaining = task.dueDate.getTime() - Date.now();
    if (remaining < 0) return 'overdue';
    if (remaining <= AT_RISK_WINDOW_MS) return 'at_risk';
    return 'on_track';
  }

  private withSla<T extends { status: TaskStatus; dueDate: Date | null; completedAt: Date | null }>(
    task: T,
  ): T & { slaStatus: SlaStatus } {
    return { ...task, slaStatus: this.slaOf(task) };
  }

  // ---------- templates / routing ----------
  private async ensureDefaultTemplates(): Promise<void> {
    for (const seed of DEFAULT_WORKFLOW_TEMPLATES) {
      const existing = await this.prisma.workflowTemplate.findUnique({
        where: { code: seed.code },
        select: { id: true },
      });
      if (!existing) {
        try {
          await this.createTemplateSeed(seed);
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            continue;
          }
          throw err;
        }
      }
    }
  }

  private async createTemplateSeed(seed: WorkflowTemplateSeed): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const template = await tx.workflowTemplate.create({
        data: {
          code: seed.code,
          caseType: seed.caseType,
          nameEn: seed.nameEn,
          nameAr: seed.nameAr,
          description: seed.description,
          trigger: seed.trigger,
          defaultSlaDays: seed.defaultSlaDays,
          isSystem: true,
          createdBy: 'system',
        },
      });
      const stageByCode = new Map<string, string>();
      for (const [index, stage] of seed.stages.entries()) {
        const created = await tx.workflowTemplateStage.create({
          data: {
            templateId: template.id,
            code: stage.code,
            nameEn: stage.nameEn,
            nameAr: stage.nameAr,
            description: stage.description ?? null,
            kind: stage.kind,
            taskType: stage.taskType,
            assigneeRoleCode: stage.assigneeRoleCode ?? null,
            dueDays: stage.dueDays,
            sortOrder: index + 1,
            isStart: stage.isStart ?? false,
            isDecision: stage.isDecision ?? false,
            isFinal: stage.isFinal ?? false,
          },
          select: { id: true },
        });
        stageByCode.set(stage.code, created.id);
      }
      for (const [index, transition] of seed.transitions.entries()) {
        const fromStageId = stageByCode.get(transition.from);
        const toStageId = stageByCode.get(transition.to);
        if (!fromStageId || !toStageId) continue;
        await tx.workflowTemplateTransition.create({
          data: {
            templateId: template.id,
            fromStageId,
            toStageId,
            labelEn: transition.labelEn,
            labelAr: transition.labelAr,
            decision: transition.decision ?? null,
            isHappyPath: transition.isHappyPath ?? true,
            sortOrder: index + 1,
          },
        });
      }
    });
  }

  private async backfillUnroutedOpenCases(limit = 250): Promise<number> {
    const templates = await this.listTemplates(['system_admin']);
    const candidates = templates.map((template) => ({
      id: template.id,
      code: template.code,
      caseType: template.caseType,
      domainId: template.domainId,
      isActive: template.isActive,
    }));
    const cases = await this.prisma.workflowCase.findMany({
      where: {
        templateId: null,
        status: { notIn: [...FINAL_CASE_STATUSES] },
        type: { in: [...WORKFLOW_CASE_TYPES] },
      },
      select: {
        id: true,
        code: true,
        type: true,
        status: true,
        assetId: true,
        createdBy: true,
        asset: { select: { domainId: true } },
        tasks: {
          where: { status: { in: [TaskStatus.pending, TaskStatus.in_progress] } },
          select: { id: true, templateStageId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    let backfilled = 0;
    for (const wfCase of cases) {
      const selected = selectWorkflowTemplate(
        { caseType: wfCase.type, domainId: wfCase.asset?.domainId ?? null },
        candidates,
      );
      const template = selected ? templates.find((row) => row.id === selected.id) : null;
      if (!template) continue;
      const firstStage = firstActionableWorkflowStage(template.stages);
      await this.prisma.$transaction(async (tx) => {
        await tx.workflowCase.update({
          where: { id: wfCase.id },
          data: { templateId: template.id, type: template.caseType },
        });
        const openUnroutedTaskIds = wfCase.tasks
          .filter((task) => !task.templateStageId)
          .map((task) => task.id);
        if (firstStage && openUnroutedTaskIds.length) {
          await tx.workflowTask.updateMany({
            where: { id: { in: openUnroutedTaskIds }, templateStageId: null },
            data: { templateStageId: firstStage.id },
          });
        } else if (firstStage && wfCase.tasks.length === 0) {
          await this.createStageTask(tx, wfCase.id, firstStage, 'system', { assetId: wfCase.assetId });
        }
        await tx.workflowEvent.create({
          data: {
            caseId: wfCase.id,
            actor: 'system',
            action: 'route.template.backfilled',
            comment: template.nameEn,
          },
        });
        await this.audit.log(
          {
            actor: 'system',
            action: 'workflow_case.route_backfill',
            entityType: 'workflow_case',
            entityId: wfCase.id,
            metadata: { code: wfCase.code, templateId: template.id, templateCode: template.code },
          },
          tx,
        );
      });
      backfilled++;
    }
    return backfilled;
  }

  private async assignUnownedRoutedTasks(limit = 250): Promise<number> {
    const tasks = await this.prisma.workflowTask.findMany({
      where: {
        assigneeUserId: null,
        status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
        templateStage: { is: { assigneeRoleCode: { not: null }, isActive: true } },
        case: { templateId: { not: null }, status: { notIn: [...FINAL_CASE_STATUSES] } },
      },
      select: {
        id: true,
        caseId: true,
        title: true,
        case: { select: { assetId: true } },
        templateStage: { select: { nameEn: true, assigneeRoleCode: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    let assigned = 0;
    for (const task of tasks) {
      const roleCode = task.templateStage?.assigneeRoleCode;
      if (!roleCode) continue;
      const didAssign = await this.prisma.$transaction(async (tx) => {
        const current = await tx.workflowTask.findUnique({
          where: { id: task.id },
          select: {
            id: true,
            caseId: true,
            assigneeUserId: true,
            status: true,
            case: { select: { assetId: true, status: true } },
            templateStage: { select: { nameEn: true, assigneeRoleCode: true } },
          },
        });
        if (
          !current ||
          current.assigneeUserId ||
          (current.status !== TaskStatus.pending && current.status !== TaskStatus.in_progress) ||
          FINAL_CASE_STATUSES.includes(current.case.status) ||
          !current.templateStage?.assigneeRoleCode
        ) {
          return false;
        }
        const assigneeUserId = await this.assigneeForRole(
          tx,
          current.templateStage.assigneeRoleCode,
          current.case.assetId,
        );
        if (!assigneeUserId) return false;
        await tx.workflowTask.update({
          where: { id: current.id },
          data: { assigneeUserId },
        });
        await tx.workflowEvent.create({
          data: {
            caseId: current.caseId,
            taskId: current.id,
            actor: 'system',
            action: 'task.auto_assigned',
            comment: `${current.templateStage.assigneeRoleCode} -> ${assigneeUserId}`,
          },
        });
        await this.audit.log(
          {
            actor: 'system',
            action: 'workflow_task.auto_assign',
            entityType: 'workflow_task',
            entityId: current.id,
            metadata: {
              roleCode: current.templateStage.assigneeRoleCode,
              assigneeUserId,
              fallbackQueue: roleCode !== current.templateStage.assigneeRoleCode ? roleCode : null,
            },
          },
          tx,
        );
        return true;
      });
      if (didAssign) assigned++;
    }
    return assigned;
  }

  private async normalizeImmediateSlaDueDates(limit = 250): Promise<number> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const tasks = await this.prisma.workflowTask.findMany({
      where: {
        status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
        dueDate: { gte: startOfToday, lt: now },
        templateStage: { is: { dueDays: 0, isActive: true } },
        case: { status: { notIn: [...FINAL_CASE_STATUSES] } },
      },
      select: { id: true, caseId: true },
      orderBy: { dueDate: 'asc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    for (const task of tasks) {
      await this.prisma.$transaction(async (tx) => {
        await tx.workflowTask.update({
          where: { id: task.id },
          data: { dueDate: endOfToday },
        });
        await tx.workflowEvent.create({
          data: {
            caseId: task.caseId,
            taskId: task.id,
            actor: 'system',
            action: 'task.sla.normalized',
            comment: 'Immediate task remains due today.',
          },
        });
      });
    }
    return tasks.length;
  }

  private templateScopeWhere(roleCodes: string[]): Promise<Prisma.WorkflowTemplateWhereInput> {
    return this.scope.resolve(roleCodes).then((scope) => {
      if (scope.domains === 'all') return { deletedAt: null, isActive: true };
      return {
        deletedAt: null,
        isActive: true,
        OR: [{ domainId: null }, { domainId: { in: scope.domains } }],
      };
    });
  }

  private async routeCandidates(roleCodes: string[]): Promise<WorkflowRouteCandidate[]> {
    const where = await this.templateScopeWhere(roleCodes);
    const rows = await this.prisma.workflowTemplate.findMany({
      where,
      select: { id: true, code: true, caseType: true, domainId: true, isActive: true },
      orderBy: [{ domainId: 'desc' }, { code: 'asc' }],
    });
    return rows;
  }

  private async resolveRouteTemplate(
    dto: WorkflowRoutePreviewDto,
    roleCodes: string[],
    options: { seedIfMissing?: boolean } = {},
  ): Promise<WorkflowRouteSelection> {
    if (options.seedIfMissing) await this.ensureDefaultTemplates();
    const domainId = dto.domainId ?? (dto.assetId ? await this.assetDomainId(roleCodes, dto.assetId) : null);
    const selected = selectWorkflowTemplate(
      { caseType: dto.caseType, domainId, templateId: dto.templateId },
      await this.routeCandidates(roleCodes),
    );
    if (!selected) throw new BadRequestException('No workflow route template is available for this request');
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: selected.id, ...(await this.templateScopeWhere(roleCodes)) },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('workflow route template not found');
    return { template, domainId };
  }

  private async assetDomainId(roleCodes: string[], assetId: string): Promise<string | null> {
    await this.assertAssetVisible(roleCodes, assetId);
    const asset = await this.prisma.dataAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      select: { domainId: true },
    });
    if (!asset) throw new BadRequestException('Linked data asset not found');
    return asset.domainId ?? null;
  }

  async listTemplates(roleCodes: string[]) {
    return this.prisma.workflowTemplate.findMany({
      where: await this.templateScopeWhere(roleCodes),
      include: templateInclude,
      orderBy: [{ caseType: 'asc' }, { code: 'asc' }],
    });
  }

  async routePreview(dto: WorkflowRoutePreviewDto, roleCodes: string[]) {
    const { template, domainId } = await this.resolveRouteTemplate(dto, roleCodes);
    return {
      caseType: dto.caseType || template.caseType,
      domainId,
      template,
      stages: template.stages,
      transitions: template.transitions,
      warnings: template.stages.some((stage) => !!stage.assigneeRoleCode)
        ? []
        : ['No default assignee roles are configured for this route'],
    };
  }

  async graph(roleCodes: string[], viewer?: AuthUser) {
    const [templates, casesResult] = await Promise.all([
      this.listTemplates(roleCodes),
      this.listCases(roleCodes, { page: 1, pageSize: WORKFLOW_GRAPH_CASE_LIMIT }, viewer),
    ]);
    const cases = Array.isArray(casesResult) ? casesResult : casesResult.data;
    const totalCases = Array.isArray(casesResult) ? cases.length : casesResult.total;
    const openStatuses = new Set<CaseStatus>([
      CaseStatus.draft,
      CaseStatus.submitted,
      CaseStatus.under_review,
      CaseStatus.awaiting_information,
      CaseStatus.decision_made,
      CaseStatus.approved,
    ]);
    const activeCases = cases.filter((row) => openStatuses.has(row.status as CaseStatus));
    const overdueTasks = cases.flatMap((row) => row.tasks).filter((task) => task.slaStatus === 'overdue').length;
    const nodes: Record<string, unknown>[] = [];
    const edges: Record<string, unknown>[] = [];
    const rowGap = templates.length > 1 ? 66 / (templates.length - 1) : 0;

    templates.forEach((template, templateIndex) => {
      const y = Math.round(12 + templateIndex * rowGap);
      const templateCases = cases.filter((row) => row.templateId === template.id || (!row.templateId && row.type === template.caseType));
      const openForTemplate = templateCases.filter((row) => openStatuses.has(row.status as CaseStatus)).length;
      const overdueForTemplate = templateCases.flatMap((row) => row.tasks).filter((task) => task.slaStatus === 'overdue').length;
      const health = workflowHealth(openForTemplate, overdueForTemplate);
      const templateNodeId = `template:${template.id}`;
      nodes.push({
        id: templateNodeId,
        type: 'template',
        refId: template.id,
        labelEn: template.nameEn,
        labelAr: template.nameAr,
        sublabelEn: `${openForTemplate} open cases`,
        sublabelAr: `${openForTemplate} حالات مفتوحة`,
        status: health,
        count: openForTemplate,
        x: 6,
        y,
      });

      const stageCount = Math.max(template.stages.length, 1);
      for (const [stageIndex, stage] of template.stages.entries()) {
        const x = Math.round(24 + stageIndex * (48 / Math.max(stageCount - 1, 1)));
        const stageNodeId = `stage:${stage.id}`;
        nodes.push({
          id: stageNodeId,
          type: 'stage',
          refId: stage.id,
          labelEn: stage.nameEn,
          labelAr: stage.nameAr,
          sublabelEn: stage.assigneeRoleCode ? `Default: ${stage.assigneeRoleCode}` : stage.kind,
          sublabelAr: stage.assigneeRoleCode ? `افتراضي: ${stage.assigneeRoleCode}` : stage.kind,
          status: stage.isFinal ? 'healthy' : stage.isDecision ? 'review' : 'neutral',
          count: stage.dueDays,
          x,
          y,
        });
        if (stage.isStart) {
          edges.push({
            id: `${templateNodeId}->${stageNodeId}`,
            from: templateNodeId,
            to: stageNodeId,
            labelEn: 'starts',
            labelAr: 'يبدأ',
            tone: 'primary',
          });
        }
      }

      for (const transition of template.transitions) {
        edges.push({
          id: `transition:${transition.id}`,
          from: `stage:${transition.fromStageId}`,
          to: `stage:${transition.toStageId}`,
          labelEn: transition.labelEn,
          labelAr: transition.labelAr,
          tone: transition.isHappyPath ? 'primary' : 'warning',
        });
      }

      const domainNodeId = `domain:${template.id}:${template.domainId ?? 'all'}`;
      nodes.push({
        id: domainNodeId,
        type: 'domain',
        refId: template.domainId,
        labelEn: template.domain?.nameEn ?? 'All data domains',
        labelAr: template.domain?.nameAr ?? 'كل مجالات البيانات',
        sublabelEn: template.domain?.code ?? 'shared route',
        sublabelAr: template.domain?.code ?? 'مسار مشترك',
        status: template.domainId ? 'healthy' : 'neutral',
        count: template._count.cases,
        x: 88,
        y,
      });
      const lastStage = template.stages[template.stages.length - 1];
      if (lastStage) {
        edges.push({
          id: `stage:${lastStage.id}->${domainNodeId}`,
          from: `stage:${lastStage.id}`,
          to: domainNodeId,
          labelEn: 'governs',
          labelAr: 'يحكم',
          tone: 'muted',
        });
      }
    });

    activeCases.slice(0, 10).forEach((row, index) => {
      const x = Math.round(8 + index * (82 / Math.max(Math.min(activeCases.length, 10) - 1, 1)));
      const nodeId = `case:${row.id}`;
      nodes.push({
        id: nodeId,
        type: 'case',
        refId: row.id,
        labelEn: row.code,
        labelAr: row.code,
        sublabelEn: row.title,
        sublabelAr: row.title,
        status: row.tasks.some((task) => task.slaStatus === 'overdue') ? 'critical' : 'review',
        count: row.openTasks ?? 0,
        x,
        y: 92,
      });
      const linked = templates.find((template) => template.id === row.templateId || (!row.templateId && template.caseType === row.type));
      if (linked) {
        edges.push({
          id: `case-edge:${row.id}`,
          from: `template:${linked.id}`,
          to: nodeId,
          labelEn: 'active case',
          labelAr: 'حالة نشطة',
          tone: 'case',
        });
      }
    });

    return {
      summary: {
        templates: templates.length,
        stages: templates.reduce((sum, template) => sum + template.stages.length, 0),
        totalCases,
        displayedCases: cases.length,
        caseLimit: WORKFLOW_GRAPH_CASE_LIMIT,
        truncated: totalCases > cases.length,
        activeCases: activeCases.length,
        overdueTasks,
        domainsCovered: new Set(templates.map((template) => template.domainId ?? 'all')).size,
      },
      templates,
      nodes,
      edges,
    };
  }

  async configuration(roleCodes: string[], viewer?: AuthUser) {
    await this.ensureDefaultTemplates();
    const [templates, casesResult] = await Promise.all([
      this.listTemplates(roleCodes),
      this.listCases(roleCodes, { page: 1, pageSize: 500 }, viewer),
    ]);
    const cases = Array.isArray(casesResult) ? casesResult : casesResult.data;
    const totalCases = Array.isArray(casesResult) ? cases.length : casesResult.total;
    const openStatuses = new Set<CaseStatus>([
      CaseStatus.draft,
      CaseStatus.submitted,
      CaseStatus.under_review,
      CaseStatus.awaiting_information,
      CaseStatus.decision_made,
      CaseStatus.approved,
    ]);
    const activeCases = cases.filter((row) => openStatuses.has(row.status as CaseStatus));
    const activeTasks = activeCases.flatMap((row) =>
      row.tasks.filter((task) => task.status === TaskStatus.pending || task.status === TaskStatus.in_progress),
    );
    const overdueTasks = activeTasks.filter((task) => task.slaStatus === 'overdue').length;
    const unassignedTasks = activeTasks.filter((task) => !task.assigneeUserId).length;
    const caseTypeRegistry = buildWorkflowCaseTypeRegistry(templates);
    const slaTemplates = buildWorkflowSlaTemplates(templates);
    const notificationRules = buildWorkflowNotificationRules(templates);
    const escalationTemplates = buildWorkflowEscalationTemplates(templates);
    const blockedRoutes = caseTypeRegistry.filter((row) => row.status === 'blocked').length;
    const watchRoutes = caseTypeRegistry.filter((row) => row.status === 'watch').length;
    const status =
      blockedRoutes > 0
        ? 'blocked'
        : overdueTasks > 0 || unassignedTasks > 0 || watchRoutes > 0
          ? 'watch'
          : 'ready';

    return {
      generatedAt: new Date().toISOString(),
      status,
      summary: {
        templates: templates.length,
        caseTypes: caseTypeRegistry.length,
        activeRoutes: caseTypeRegistry.filter((row) => row.hasActiveRoute).length,
        totalCases,
        sampledCases: cases.length,
        activeCases: activeCases.length,
        activeTasks: activeTasks.length,
        overdueTasks,
        unassignedTasks,
        notificationRules: notificationRules.length,
        escalationTemplates: escalationTemplates.length,
      },
      caseTypeRegistry,
      slaTemplates,
      notificationRules,
      escalationTemplates,
      universalCaseManagement: {
        statusModel: Object.values(CaseStatus).map((statusValue) => ({
          status: statusValue,
          final: FINAL_CASE_STATUSES.includes(statusValue),
          allowedNext: CASE_TRANSITIONS[statusValue],
        })),
        taskStatusModel: Object.values(TaskStatus),
        controls: [
          { code: 'delegation', status: 'ready', evidence: 'Tasks can be reassigned and auto-assigned by role scope.' },
          { code: 'backup_steward_assignment', status: unassignedTasks > 0 ? 'watch' : 'ready', evidence: 'Unassigned tasks are surfaced as operator risk.' },
          { code: 'approval_history', status: 'ready', evidence: 'Workflow events record decisions, transitions, and comments.' },
          { code: 'effective_dates', status: 'ready', evidence: 'Assignment approvals preserve effective ownership dates.' },
          { code: 'segregation_of_duties', status: 'ready', evidence: 'Submitters cannot decide their own assignment approval cases.' },
        ],
        pageContracts: [
          { route: '/governance/workflow', api: '/api/workflow/tasks/mine', roleAction: 'workflow_tasks.view' },
          { route: '/governance/workflow', api: '/api/workflow/cases', roleAction: 'workflow_cases.view' },
          { route: '/governance/workflow', api: '/api/workflow/route-preview', roleAction: 'workflow_cases.view' },
          { route: '/governance/workflow/cases/:id', api: '/api/workflow/cases/:id', roleAction: 'workflow_cases.view' },
          { route: '/governance/workflow/cases/:id', api: '/api/workflow/tasks/:id/decision', roleAction: 'workflow_tasks.edit' },
        ],
      },
    };
  }

  async caseManagement(roleCodes: string[], viewer?: AuthUser) {
    const configuration = await this.configuration(roleCodes, viewer);
    return {
      generatedAt: configuration.generatedAt,
      status: configuration.status,
      summary: configuration.summary,
      caseTypeRegistry: configuration.caseTypeRegistry,
      universalCaseManagement: configuration.universalCaseManagement,
      backlogCoverage: configuration.caseTypeRegistry.map((row) => ({
        caseType: row.caseType,
        status: row.status,
        activeRoute: row.hasActiveRoute,
        routeCodes: row.routeCodes,
        acceptance: row.hasActiveRoute
          ? 'Implemented as a configurable routed case type.'
          : 'Mapped to backlog; no active route configured yet.',
      })),
    };
  }

  // ---------- data scope ----------
  /** Asset ids the requester may see, or 'all' when unrestricted. */
  private dataAssetScopeWhere(scope: Awaited<ReturnType<ScopeService['resolve']>>): Prisma.DataAssetWhereInput {
    const where: Prisma.DataAssetWhereInput = { deletedAt: null, isActive: true };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [
        { classificationId: null },
        { classification: { rank: { lte: scope.maxClassRank } } },
      ];
    }
    return where;
  }

  private async visibleAssetIds(roleCodes: string[], client: PrismaWriter = this.prisma): Promise<Set<string> | 'all'> {
    const scope = await this.scope.resolve(roleCodes);
    if (scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null) {
      return 'all';
    }
    const assets = await client.dataAsset.findMany({
      where: this.dataAssetScopeWhere(scope),
      select: { id: true },
    });
    return new Set(assets.map((a) => a.id));
  }

  private async roleCodesCanSeeAsset(
    roleCodes: string[],
    assetId: string,
    client: PrismaWriter = this.prisma,
  ): Promise<boolean> {
    const scope = await this.scope.resolve(roleCodes);
    if (scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null) return true;
    const asset = await client.dataAsset.findFirst({
      where: { id: assetId, ...this.dataAssetScopeWhere(scope) },
      select: { id: true },
    });
    return Boolean(asset);
  }

  private async assertAssetVisible(roleCodes: string[], assetId: string): Promise<void> {
    const assetIds = await this.visibleAssetIds(roleCodes);
    if (assetIds !== 'all' && !assetIds.has(assetId)) {
      throw new NotFoundException('workflow case not found');
    }
  }

  private async assertCaseVisible(roleCodes: string[], wfCase: { assetId: string | null }): Promise<void> {
    if (!wfCase.assetId) return;
    await this.assertAssetVisible(roleCodes, wfCase.assetId);
  }

  private async workflowCaseVisibilityWhere(
    roleCodes: string[],
    viewer?: AuthUser,
  ): Promise<Prisma.WorkflowCaseWhereInput> {
    const assetIds = await this.visibleAssetIds(roleCodes);
    if (assetIds === 'all') return {};

    const visible: Prisma.WorkflowCaseWhereInput[] = [];
    if (assetIds.size > 0) visible.push({ assetId: { in: [...assetIds] } });
    if (viewer) {
      visible.push(
        { AND: [{ assetId: null }, { createdBy: viewer.email }] },
        { AND: [{ assetId: null }, { tasks: { some: { assigneeUserId: viewer.id } } }] },
      );
    }
    return visible.length ? { OR: visible } : { id: { equals: '__no_visible_workflow_cases__' } };
  }

  private assertCaseCanChange(status: CaseStatus): void {
    if (FINAL_CASE_STATUSES.includes(status)) {
      throw new BadRequestException('Closed, implemented, or rejected cases cannot be modified');
    }
  }

  private assertCaseTransition(from: CaseStatus, to: CaseStatus): void {
    if (from === to) return;
    if (!CASE_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Invalid workflow case transition from ${from} to ${to}`);
    }
  }

  private assertKnownCaseStatus(status: string): CaseStatus {
    if (!Object.values(CaseStatus).includes(status as CaseStatus)) {
      throw new BadRequestException('Invalid workflow case status');
    }
    return status as CaseStatus;
  }

  private assertKnownCaseType(type: string): string {
    if (!WORKFLOW_CASE_TYPES.includes(type)) {
      throw new BadRequestException('Invalid workflow case type');
    }
    return type;
  }

  private assertKnownTaskStatus(status: string): TaskStatus {
    if (!Object.values(TaskStatus).includes(status as TaskStatus)) {
      throw new BadRequestException('Invalid workflow task status');
    }
    return status as TaskStatus;
  }

  private assertKnownTaskType(type: string): string {
    if (!WORKFLOW_TASK_TYPES.includes(type as (typeof WORKFLOW_TASK_TYPES)[number])) {
      throw new BadRequestException('Invalid workflow task type');
    }
    return type;
  }

  private caseTransitionPath(from: CaseStatus, to: CaseStatus): CaseStatus[] {
    if (from === to) return [];
    const queue: { status: CaseStatus; path: CaseStatus[] }[] = [{ status: from, path: [] }];
    const seen = new Set<CaseStatus>([from]);
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of CASE_TRANSITIONS[current.status]) {
        if (seen.has(next)) continue;
        const path = [...current.path, next];
        if (next === to) return path;
        seen.add(next);
        queue.push({ status: next, path });
      }
    }
    throw new BadRequestException(`Invalid workflow case transition from ${from} to ${to}`);
  }

  private async syncAssetOwner(
    client: Prisma.TransactionClient,
    assignment: { targetType: AssignmentTargetType; targetId: string },
  ): Promise<void> {
    if (assignment.targetType !== AssignmentTargetType.asset) return;
    const asset = await client.dataAsset.findFirst({
      where: { id: assignment.targetId, deletedAt: null },
      select: { id: true },
    });
    if (!asset) return;
    const now = new Date();
    const owner = await client.stewardshipAssignment.findFirst({
      where: {
        targetType: AssignmentTargetType.asset,
        targetId: assignment.targetId,
        isPrimary: true,
        isActive: true,
        approvalStatus: ApprovalStatus.approved,
        deletedAt: null,
        effectiveDate: { lte: now },
        OR: [{ expiryDate: null }, { expiryDate: { gte: now } }],
        roleType: { code: DATA_OWNER_CODE },
      },
      include: { person: true },
      orderBy: { effectiveDate: 'desc' },
    });
    await client.dataAsset.update({
      where: { id: assignment.targetId },
      data: owner
        ? { ownerStatus: 'assigned', ownerName: owner.person.fullNameEn }
        : { ownerStatus: 'unassigned', ownerName: null },
    });
  }

  // ---------- cases ----------
  async listCases(
    roleCodes: string[],
    filters: { status?: string; type?: string; page?: string | number; pageSize?: string | number },
    viewer?: AuthUser,
  ) {
    const filterWhere: Prisma.WorkflowCaseWhereInput = {};
    if (filters.status) filterWhere.status = this.assertKnownCaseStatus(String(filters.status));
    if (filters.type) filterWhere.type = this.assertKnownCaseType(filters.type);
    const visibilityWhere = await this.workflowCaseVisibilityWhere(roleCodes, viewer);
    const where: Prisma.WorkflowCaseWhereInput = { AND: [filterWhere, visibilityWhere] };
    const page = parsePageParams(filters.page, filters.pageSize);
    const skip = page?.skip ?? 0;
    const take = page?.take ?? WORKFLOW_CASE_DEFAULT_PAGE_SIZE;
    const [rows, total] = await Promise.all([
      this.prisma.workflowCase.findMany({
        where,
        include: caseInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.workflowCase.count({ where }),
    ]);
    const data = rows.map((c) => ({
        ...c,
        tasks: c.tasks.map((t) => this.withSla(t)),
        openTasks: c.tasks.filter((t) => t.status === TaskStatus.pending || t.status === TaskStatus.in_progress).length,
      }));
    return page ? toPaged(data, total, page) : data;
  }

  async getCase(roleCodes: string[], id: string, viewer?: AuthUser) {
    const wfCase = await this.prisma.workflowCase.findFirst({
      where: { AND: [{ id }, await this.workflowCaseVisibilityWhere(roleCodes, viewer)] },
      include: caseInclude,
    });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    const events = await this.prisma.workflowEvent.findMany({
      where: { caseId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...wfCase,
      tasks: wfCase.tasks.map((t) => this.withSla(t)),
      events,
    };
  }

  /** Generates the next human-friendly case code, retrying on the rare collision. */
  private async nextCaseCode(): Promise<string> {
    const count = await this.prisma.workflowCase.count();
    for (let i = 1; i <= 50; i++) {
      const code = `WFC-${String(count + i).padStart(4, '0')}`;
      const exists = await this.prisma.workflowCase.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `WFC-${Date.now()}`;
  }

  private async nextCaseCodeForClient(
    client: Prisma.TransactionClient,
    preferredCode?: string | null,
  ): Promise<string> {
    if (preferredCode) {
      const existing = await client.workflowCase.findUnique({ where: { code: preferredCode } });
      if (!existing) return preferredCode;
    }
    const count = await client.workflowCase.count();
    for (let i = 1; i <= 50; i++) {
      const code = `WFC-${String(count + i).padStart(4, '0')}`;
      const exists = await client.workflowCase.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `WFC-${Date.now()}`;
  }

  private dueDateForStage(stage: WorkflowStageRouteNode, override?: Date | null): Date | null {
    if (override !== undefined) return override;
    const dueDate = new Date();
    const dueDays = Math.max(stage.dueDays ?? 0, 0);
    dueDate.setDate(dueDate.getDate() + dueDays);
    if (dueDays === 0) dueDate.setHours(23, 59, 59, 999);
    return dueDate;
  }

  private async createStageTask(
    client: Prisma.TransactionClient,
    caseId: string,
    stage: WorkflowStageWithRoute,
    actor: string,
    options: { assetId?: string | null; assigneeUserId?: string | null; dueDate?: Date | null; title?: string | null } = {},
  ) {
    const assigneeUserId =
      options.assigneeUserId !== undefined
        ? options.assigneeUserId
        : await this.assigneeForRole(client, stage.assigneeRoleCode, options.assetId ?? null);
    const task = await client.workflowTask.create({
      data: {
        caseId,
        title: options.title || stage.nameEn,
        type: stage.taskType,
        status: TaskStatus.pending,
        assigneeUserId: assigneeUserId ?? null,
        dueDate: this.dueDateForStage(stage, options.dueDate),
        templateStageId: stage.id,
      },
    });
    await client.workflowEvent.create({
      data: {
        caseId,
        taskId: task.id,
        actor,
        action: 'route.stage.activated',
        comment: stage.nameEn,
      },
    });
    return task;
  }

  async openRoutedCase(
    input: {
      roleCodes: string[];
      actor: string;
      title: string;
      description?: string | null;
      type?: string | null;
      assetId?: string | null;
      assignmentId?: string | null;
      templateId?: string | null;
      status?: CaseStatus;
      preferredCode?: string | null;
      initialStageCode?: string | null;
      initialAssigneeUserId?: string | null;
      initialDueDate?: Date | null;
      initialTaskTitle?: string | null;
    },
    client?: Prisma.TransactionClient,
  ) {
    if (client) return this.openRoutedCaseWithClient(client, input);
    return this.prisma.$transaction((tx) => this.openRoutedCaseWithClient(tx, input));
  }

  private async openRoutedCaseWithClient(
    client: Prisma.TransactionClient,
    input: {
      roleCodes: string[];
      actor: string;
      title: string;
      description?: string | null;
      type?: string | null;
      assetId?: string | null;
      assignmentId?: string | null;
      templateId?: string | null;
      status?: CaseStatus;
      preferredCode?: string | null;
      initialStageCode?: string | null;
      initialAssigneeUserId?: string | null;
      initialDueDate?: Date | null;
      initialTaskTitle?: string | null;
    },
  ) {
    if (input.assetId) {
      const asset = await client.dataAsset.findFirst({
        where: { id: input.assetId, deletedAt: null },
      });
      if (!asset) throw new BadRequestException('Linked data asset not found');
      await this.assertAssetVisible(input.roleCodes, input.assetId);
    }
    let route: WorkflowRouteSelection | null = null;
    try {
      route = await this.resolveRouteTemplate(
        { caseType: input.type, assetId: input.assetId, templateId: input.templateId },
        input.roleCodes,
        { seedIfMissing: true },
      );
    } catch (err) {
      throw err;
    }
    if (!route) throw new BadRequestException('No workflow route template is available for this request');
    const code = await this.nextCaseCodeForClient(client, input.preferredCode);
    const wfCase = await client.workflowCase.create({
      data: {
        code,
        title: input.title,
        description: input.description ?? null,
        type: input.type ?? route?.template.caseType ?? 'general',
        status: input.status ?? CaseStatus.draft,
        templateId: route?.template.id ?? null,
        assetId: input.assetId ?? null,
        assignmentId: input.assignmentId ?? null,
        createdBy: input.actor,
      },
    });
    if (route?.template) {
      const firstStage = input.initialStageCode
        ? route.template.stages.find((stage) => stage.code === input.initialStageCode)
        : firstActionableWorkflowStage(route.template.stages);
      if (input.initialStageCode && !firstStage) {
        throw new BadRequestException('Requested workflow route stage is not configured');
      }
      if (firstStage) {
        if (!isActionableWorkflowStage(firstStage)) {
          throw new BadRequestException('Requested workflow route stage cannot create a task');
        }
        await this.createStageTask(client, wfCase.id, firstStage, input.actor, {
          assetId: wfCase.assetId,
          assigneeUserId: input.initialAssigneeUserId,
          dueDate: input.initialDueDate,
          title: input.initialTaskTitle,
        });
      }
      await client.workflowEvent.create({
        data: {
          caseId: wfCase.id,
          actor: input.actor,
          action: 'route.template.applied',
          comment: route.template.nameEn,
        },
      });
    }
    await client.workflowEvent.create({
      data: {
        caseId: wfCase.id,
        actor: input.actor,
        action: 'case.created',
        toStatus: input.status ?? CaseStatus.draft,
      },
    });
    const created = await client.workflowCase.findUnique({
      where: { id: wfCase.id },
      include: caseInclude,
    });
    if (!created) throw new BadRequestException('Could not create workflow case');
    return created;
  }

  async createCase(dto: CreateCaseDto, roleCodes: string[], actor: string) {
    const created = await this.openRoutedCase({
      roleCodes,
      actor,
      title: dto.title,
      description: dto.description,
      type: dto.type,
      assetId: dto.assetId,
      templateId: dto.templateId,
    });
    await this.audit.log({
      actor,
      action: 'workflow_case.create',
      entityType: 'workflow_case',
      entityId: created.id,
      metadata: { code: created.code, templateId: created.templateId ?? null },
    });
    return created;
  }

  async updateCase(id: string, dto: UpdateCaseDto, roleCodes: string[], actor: string) {
    const existing = await this.prisma.workflowCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(roleCodes, existing);
    this.assertCaseCanChange(existing.status);
    if (dto.status !== undefined) {
      if (existing.templateId && dto.status !== existing.status) {
        throw new BadRequestException('Routed workflow status is controlled by task decisions');
      }
      this.assertCaseTransition(existing.status, dto.status);
    }
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data['title'] = dto.title;
    if (dto.description !== undefined) data['description'] = dto.description;
    if (dto.status !== undefined) data['status'] = dto.status;
    const updated = await this.prisma.workflowCase.update({
      where: { id },
      data,
      include: caseInclude,
    });
    if (dto.status !== undefined && dto.status !== existing.status) {
      await this.event(id, actor, 'case.status', {
        fromStatus: existing.status,
        toStatus: dto.status,
      });
    }
    await this.audit.log({
      actor,
      action: 'workflow_case.update',
      entityType: 'workflow_case',
      entityId: id,
    });
    return updated;
  }

  async recordDomainCaseProgress(
    input: {
      caseId: string;
      roleCodes: string[];
      actor: string;
      targetStatus: CaseStatus;
      eventAction: string;
      comment?: string | null;
      completeOpenTasks?: boolean;
    },
    client?: Prisma.TransactionClient,
  ) {
    const run = async (writer: WorkflowWriter) => {
      const existing = await writer.workflowCase.findUnique({ where: { id: input.caseId } });
      if (!existing) throw new NotFoundException('workflow case not found');
      await this.assertCaseVisible(input.roleCodes, existing);

      const now = new Date();
      if (input.completeOpenTasks) {
        await writer.workflowTask.updateMany({
          where: {
            caseId: input.caseId,
            status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
          },
          data: { status: TaskStatus.completed, completedAt: now },
        });
      }

      let current = existing.status;
      for (const next of this.caseTransitionPath(current, input.targetStatus)) {
        await writer.workflowCase.update({ where: { id: input.caseId }, data: { status: next } });
        await writer.workflowEvent.create({
          data: {
            caseId: input.caseId,
            actor: input.actor,
            action: 'case.status',
            fromStatus: current,
            toStatus: next,
            comment: input.comment ?? input.eventAction,
          },
        });
        current = next;
      }

      await writer.workflowEvent.create({
        data: {
          caseId: input.caseId,
          actor: input.actor,
          action: input.eventAction,
          comment: input.comment ?? null,
        },
      });
      await this.audit.log(
        {
          actor: input.actor,
          action: 'workflow_case.domain_progress',
          entityType: 'workflow_case',
          entityId: input.caseId,
          metadata: {
            eventAction: input.eventAction,
            fromStatus: existing.status,
            toStatus: input.targetStatus,
            completedOpenTasks: Boolean(input.completeOpenTasks),
          },
        },
        writer,
      );
      return writer.workflowCase.findUnique({ where: { id: input.caseId }, include: caseInclude });
    };
    if (client) return run(client);
    return this.prisma.$transaction((tx) => run(tx));
  }

  async recordDomainTaskDecision(
    input: {
      taskId: string;
      roleCodes: string[];
      actor: string;
      decision: TaskDecision;
      comment?: string | null;
      eventAction: string;
    },
    client?: Prisma.TransactionClient,
  ) {
    const run = async (writer: Prisma.TransactionClient) => {
      const task = await writer.workflowTask.findUnique({
        where: { id: input.taskId },
        include: { case: true },
      });
      if (!task) throw new NotFoundException('workflow task not found');
      await this.assertCaseVisible(input.roleCodes, task.case);
      this.assertCaseCanChange(task.case.status);
      if (task.status === TaskStatus.completed || task.status === TaskStatus.cancelled) {
        throw new BadRequestException('This task has already been decided');
      }

      await this.assertRouteGateReady(writer, task);
      const routePlan = await this.planRouteAdvance(writer, task, input.decision);
      const decided = await writer.workflowTask.update({
        where: { id: input.taskId },
        data: {
          status: TaskStatus.completed,
          decision: input.decision,
          decisionComment: input.comment ?? null,
          completedAt: new Date(),
        },
        include: taskInclude,
      });
      await writer.workflowEvent.create({
        data: {
          caseId: task.caseId,
          taskId: input.taskId,
          actor: input.actor,
          action: input.eventAction,
          comment: input.comment ?? null,
        },
      });
      await this.applyRouteAdvance(writer, task, routePlan, input.actor, input.decision);
      await this.audit.log(
        {
          actor: input.actor,
          action: 'workflow_task.domain_decision',
          entityType: 'workflow_task',
          entityId: input.taskId,
          metadata: { eventAction: input.eventAction, decision: input.decision },
        },
        writer,
      );
      return this.withSla(decided);
    };
    if (client) return run(client);
    return this.prisma.$transaction((tx) => run(tx));
  }

  async submitCase(id: string, roleCodes: string[], actor: string) {
    const existing = await this.prisma.workflowCase.findUnique({
      where: { id },
      include: { tasks: true },
    });
    if (!existing) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(roleCodes, existing);
    if (existing.status !== CaseStatus.draft) {
      throw new BadRequestException('Only a draft case can be submitted');
    }
    if (existing.tasks.length === 0) {
      throw new BadRequestException('Add at least one task before submitting');
    }
    const updated = await this.prisma.workflowCase.update({
      where: { id },
      data: { status: CaseStatus.submitted },
      include: caseInclude,
    });
    await this.event(id, actor, 'case.submitted', {
      fromStatus: CaseStatus.draft,
      toStatus: CaseStatus.submitted,
    });
    await this.audit.log({
      actor,
      action: 'workflow_case.submit',
      entityType: 'workflow_case',
      entityId: id,
      metadata: { fromStatus: CaseStatus.draft, toStatus: CaseStatus.submitted },
    });
    return updated;
  }

  // ---------- tasks ----------
  async addTask(caseId: string, dto: AddTaskDto, roleCodes: string[], actor: string) {
    const wfCase = await this.prisma.workflowCase.findUnique({ where: { id: caseId } });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(roleCodes, wfCase);
    this.assertCaseCanChange(wfCase.status);
    if (dto.assigneeUserId) await this.assertUser(dto.assigneeUserId);
    const type = dto.type ? this.assertKnownTaskType(dto.type) : 'review';
    const task = await this.prisma.workflowTask.create({
      data: {
        caseId,
        title: dto.title,
        type,
        status: TaskStatus.pending,
        assigneeUserId: dto.assigneeUserId ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      include: taskInclude,
    });
    await this.event(caseId, actor, 'task.added', {
      taskId: task.id,
      comment: task.assignee ? `Assigned to ${task.assignee.displayName}` : undefined,
    });
    return this.withSla(task);
  }

  async updateTask(id: string, dto: UpdateTaskDto, roleCodes: string[], actor: string) {
    const existing = await this.prisma.workflowTask.findUnique({ where: { id }, include: { case: true } });
    if (!existing) throw new NotFoundException('workflow task not found');
    await this.assertCaseVisible(roleCodes, existing.case);
    this.assertCaseCanChange(existing.case.status);
    if (existing.status === TaskStatus.completed || existing.status === TaskStatus.cancelled) {
      throw new BadRequestException('A completed or cancelled task cannot be modified');
    }
    if (dto.assigneeUserId) await this.assertUser(dto.assigneeUserId);
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data['title'] = dto.title;
    if (dto.assigneeUserId !== undefined) data['assigneeUserId'] = dto.assigneeUserId || null;
    if (dto.dueDate !== undefined) data['dueDate'] = dto.dueDate ? new Date(dto.dueDate) : null;
    const updated = await this.prisma.workflowTask.update({
      where: { id },
      data,
      include: taskInclude,
    });
    if (dto.assigneeUserId !== undefined) {
      await this.event(existing.caseId, actor, 'task.reassigned', {
        taskId: id,
        comment: updated.assignee ? `Reassigned to ${updated.assignee.displayName}` : 'Unassigned',
      });
    }
    return this.withSla(updated);
  }

  async listMyTasks(user: AuthUser, filters: { status?: string; page?: string | number; pageSize?: string | number }) {
    const where: Prisma.WorkflowTaskWhereInput = {
      assigneeUserId: user.id,
      case: await this.workflowCaseVisibilityWhere(user.roles, user),
    };
    if (filters.status === 'open') {
      where['status'] = { in: [TaskStatus.pending, TaskStatus.in_progress] };
    } else if (filters.status) {
      where.status = this.assertKnownTaskStatus(filters.status);
    }
    const page = parsePageParams(filters.page, filters.pageSize);
    const skip = page?.skip ?? 0;
    const take = page?.take ?? WORKFLOW_TASK_DEFAULT_PAGE_SIZE;
    const rows = await this.prisma.workflowTask.findMany({
      where,
      include: {
        ...taskInclude,
        case: { select: { id: true, code: true, title: true, type: true, status: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
    const data = rows.map((t) => this.withSla(t));
    if (!page) return data;
    const total = await this.prisma.workflowTask.count({ where });
    return toPaged(data, total, page);
  }

  async getTask(id: string, roleCodes: string[]) {
    const task = await this.prisma.workflowTask.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        case: { select: { id: true, code: true, title: true, type: true, status: true, assetId: true } },
      },
    });
    if (!task) throw new NotFoundException('workflow task not found');
    await this.assertCaseVisible(roleCodes, task.case);
    return this.withSla(task);
  }

  private caseStatusForActiveStage(stage: WorkflowStageWithRoute): CaseStatus {
    if (stage.isFinal || stage.kind === 'implementation') return CaseStatus.approved;
    return CaseStatus.under_review;
  }

  private finalStatusForDecision(decision: TaskDecision): CaseStatus {
    return decision === TaskDecision.rejected ? CaseStatus.rejected : CaseStatus.implemented;
  }

  private async assertRouteGateReady(
    client: Prisma.TransactionClient,
    task: { id: string; caseId: string; templateStageId: string | null },
  ): Promise<void> {
    if (!task.templateStageId) return;
    const openPeerTasks = await client.workflowTask.count({
      where: {
        caseId: task.caseId,
        templateStageId: task.templateStageId,
        id: { not: task.id },
        status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      },
    });
    const gate = routeGateForOpenStagePeers(openPeerTasks);
    if (!gate.allowed) throw new BadRequestException(gate.reason);
  }

  private async planRouteAdvance(
    client: Prisma.TransactionClient,
    task: {
      templateStageId: string | null;
      case: { id: string; templateId: string | null; status: CaseStatus };
    },
    decision: TaskDecision,
  ): Promise<RouteAdvancePlan | null> {
    if (!task.templateStageId || !task.case.templateId) return null;
    const template = await client.workflowTemplate.findUnique({
      where: { id: task.case.templateId },
      include: templateInclude,
    });
    if (!template) return null;
    const fromStage = template.stages.find((stage) => stage.id === task.templateStageId);
    if (!fromStage) return null;
    const transition = selectWorkflowTransitionForDecision(
      template.transitions,
      fromStage.id,
      decision,
    );
    if (!transition) {
      if (fromStage.isFinal) {
        return { fromStage, finalStatus: this.finalStatusForDecision(decision) };
      }
      if (decision === TaskDecision.rejected) {
        throw new BadRequestException('This route stage does not support rejection');
      }
      throw new BadRequestException('No next workflow route transition is configured for this stage');
    }
    const nextStage = template.stages.find((stage) => stage.id === transition.toStageId);
    if (!nextStage) {
      throw new BadRequestException('The next workflow route stage is not configured');
    }
    if (!isActionableWorkflowStage(nextStage)) {
      if (nextStage.isFinal) {
        return {
          fromStage,
          transition,
          finalStatus: this.finalStatusForDecision(decision),
        };
      }
      throw new BadRequestException('The next workflow route stage cannot create a task');
    }
    return {
      fromStage,
      transition,
      nextStage,
      toStatus: this.caseStatusForActiveStage(nextStage),
    };
  }

  private async applyRouteAdvance(
    client: Prisma.TransactionClient,
    task: { caseId: string; case: { status: CaseStatus; assetId?: string | null } },
    plan: RouteAdvancePlan | null,
    actor: string,
    decision: TaskDecision,
  ): Promise<void> {
    if (!plan) return;
    const targetStageName = plan.nextStage?.nameEn ?? plan.transition?.toStage?.code ?? 'Route complete';
    if (plan.transition) {
      await client.workflowEvent.create({
        data: {
          caseId: task.caseId,
          actor,
          action: 'route.transition',
          comment: `${plan.fromStage.nameEn} -> ${targetStageName}`,
        },
      });
    }
    if (plan.nextStage) {
      await this.createStageTask(client, task.caseId, plan.nextStage, actor, { assetId: task.case.assetId ?? null });
      if (plan.toStatus && plan.toStatus !== task.case.status) {
        await client.workflowCase.update({
          where: { id: task.caseId },
          data: { status: plan.toStatus },
        });
        await client.workflowEvent.create({
          data: {
            caseId: task.caseId,
            actor,
            action: 'case.status',
            fromStatus: task.case.status,
            toStatus: plan.toStatus,
            comment: `Route advanced after ${decision}`,
          },
        });
      }
      return;
    }
    if (plan.finalStatus) {
      await client.workflowCase.update({
        where: { id: task.caseId },
        data: { status: plan.finalStatus },
      });
      await client.workflowEvent.createMany({
        data: [
          {
            caseId: task.caseId,
            actor,
            action: 'case.status',
            fromStatus: task.case.status,
            toStatus: plan.finalStatus,
            comment: `Route completed after ${decision}`,
          },
          {
            caseId: task.caseId,
            actor,
            action: 'route.completed',
            comment: plan.fromStage.nameEn,
          },
        ],
      });
    }
  }

  /**
   * Records an approve/reject decision on a task. Only the assignee or an admin may decide.
   * For assignment-approval cases the linked assignment is activated or rejected accordingly.
   */
  async decideTask(id: string, dto: DecisionDto, user: AuthUser) {
    const task = await this.prisma.workflowTask.findUnique({
      where: { id },
      include: { case: true },
    });
    if (!task) throw new NotFoundException('workflow task not found');
    await this.assertCaseVisible(user.roles, task.case);
    this.assertCaseCanChange(task.case.status);
    if (task.status === TaskStatus.completed || task.status === TaskStatus.cancelled) {
      throw new BadRequestException('This task has already been decided');
    }
    const isAdmin = user.roles.some((r) => ADMIN_ROLES.includes(r));
    if (!isAdmin && task.assigneeUserId !== user.id) {
      throw new ForbiddenException('Only the assigned user can decide this task');
    }

    // Segregation of duties: the person who opened an approval case cannot also
    // decide it, regardless of role. This keeps proposer and approver separate.
    const isApprovalTask =
      task.case.type === 'owner_assignment_approval' ||
      task.case.type === 'steward_assignment_approval';
    if (isApprovalTask && task.case.createdBy === user.email) {
      throw new ForbiddenException('You cannot decide an approval you submitted');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.assertRouteGateReady(tx, task);
      const routePlan = isApprovalTask
        ? null
        : await this.planRouteAdvance(tx, task, dto.decision);
      const decided = await tx.workflowTask.update({
        where: { id },
        data: {
          status: TaskStatus.completed,
          decision: dto.decision,
          decisionComment: dto.comment ?? null,
          completedAt: new Date(),
        },
        include: taskInclude,
      });
      await tx.workflowEvent.create({
        data: {
          caseId: task.caseId,
          taskId: id,
          actor: user.email,
          action: `decision.${dto.decision}`,
          comment: dto.comment ?? null,
        },
      });

      // Wire approval decisions back to the proposed assignment + case lifecycle atomically.
      if (isApprovalTask && task.case.assignmentId) {
        const approved = dto.decision === TaskDecision.approved;
        const assignment = await tx.stewardshipAssignment.findFirst({
          where: { id: task.case.assignmentId, deletedAt: null },
          include: { roleType: true, person: true },
        });
        if (!assignment) throw new BadRequestException('assignment not found for approval workflow');
        await tx.stewardshipAssignment.update({
          where: { id: assignment.id },
          data: {
            approvalStatus: approved ? ApprovalStatus.approved : ApprovalStatus.rejected,
            reviewedBy: user.email,
            reviewedAt: new Date(),
            isActive: approved ? assignment.isActive : false,
          },
        });
        await this.syncAssetOwner(tx, assignment);
        const finalStatus = approved ? CaseStatus.implemented : CaseStatus.rejected;
        await tx.workflowCase.update({
          where: { id: task.caseId },
          data: { status: finalStatus },
        });
        await tx.workflowEvent.create({
          data: {
            caseId: task.caseId,
            actor: user.email,
            action: 'case.status',
            fromStatus: task.case.status,
            toStatus: finalStatus,
            comment: approved ? 'Assignment activated' : 'Proposed assignment rejected',
          },
        });
        await this.audit.log(
          {
            actor: user.email,
            action: `assignment.${approved ? ApprovalStatus.approved : ApprovalStatus.rejected}`,
            entityType: 'stewardship_assignment',
            entityId: assignment.id,
          },
          tx,
        );
      }

      if (!isApprovalTask) {
        await this.applyRouteAdvance(tx, task, routePlan, user.email, dto.decision);
      }

      await this.audit.log(
        {
          actor: user.email,
          action: `workflow_task.${dto.decision}`,
          entityType: 'workflow_task',
          entityId: id,
        },
        tx,
      );
      return decided;
    });
    return this.withSla(updated);
  }

  // ---------- assignment approval entry point ----------
  /**
   * Routes a stewardship assignment through approval: marks it pending (non-authoritative)
   * and opens a case with an approval task for the chosen approver.
   */
  async submitAssignmentForApproval(dto: SubmitAssignmentDto, roleCodes: string[], actor: string) {
    const assignment = await this.assignments.getAssignment(dto.assignmentId);
    if (assignment.targetType === 'asset') {
      await this.assertAssetVisible(roleCodes, assignment.targetId);
    }
    if (assignment.approvalStatus === ApprovalStatus.pending) {
      throw new BadRequestException('This assignment is already awaiting approval');
    }
    await this.assertUser(dto.approverUserId);

    // Segregation of duties: the approver must be someone other than the person
    // who submits the request and other than the person being assigned.
    const submitter = await this.prisma.user.findFirst({ where: { email: actor } });
    if (submitter && submitter.id === dto.approverUserId) {
      throw new BadRequestException('The approver must be different from the submitter');
    }
    if (assignment.person.userId && assignment.person.userId === dto.approverUserId) {
      throw new BadRequestException('The approver cannot be the person being assigned');
    }

    const isOwner = assignment.roleType.code === 'data_owner';
    const caseType = isOwner ? 'owner_assignment_approval' : 'steward_assignment_approval';
    const assetId = assignment.targetType === 'asset' ? assignment.targetId : null;
    const personName = assignment.person.fullNameEn;
    const wfCase = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.stewardshipAssignment.update({
        where: { id: dto.assignmentId },
        data: {
          approvalStatus: ApprovalStatus.pending,
          reviewedBy: actor,
          reviewedAt: new Date(),
        },
      });
      await this.syncAssetOwner(tx, pending);

      const created = await this.openRoutedCase({
        roleCodes,
        actor,
        title: `Approve ${assignment.roleType.nameEn} assignment for ${personName}`,
        description: `Proposed ${assignment.roleType.nameEn}: ${personName}.`,
        type: caseType,
        status: CaseStatus.submitted,
        assetId,
        assignmentId: dto.assignmentId,
        initialStageCode: isOwner ? 'owner-decision' : 'approval',
        initialAssigneeUserId: dto.approverUserId,
        initialDueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        initialTaskTitle: 'Approve or reject the proposed assignment',
      }, tx);
      await this.audit.log(
        {
          actor,
          action: `assignment.${ApprovalStatus.pending}`,
          entityType: 'stewardship_assignment',
          entityId: dto.assignmentId,
        },
        tx,
      );
      await this.audit.log(
        {
          actor,
          action: 'assignment.submit_for_approval',
          entityType: 'stewardship_assignment',
          entityId: dto.assignmentId,
          metadata: { caseId: created.id, code: created.code, templateId: created.templateId ?? null },
        },
        tx,
      );
      return created;
    });
    return this.getCase(['system_admin'], wfCase.id);
  }

  // ---------- helpers ----------
  private async assertUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!user) throw new BadRequestException('Assignee user account not found');
  }

  private async assigneeForRole(
    client: Prisma.TransactionClient,
    roleCode?: string | null,
    assetId?: string | null,
  ): Promise<string | null> {
    if (!roleCode) return null;
    const directAssignee = await this.firstAssigneeForRole(client, roleCode, assetId);
    if (directAssignee) return directAssignee;
    if (roleCode !== DMO_ADMIN_CODE) {
      return this.firstAssigneeForRole(client, DMO_ADMIN_CODE, assetId);
    }
    return null;
  }

  private async firstAssigneeForRole(
    client: Prisma.TransactionClient,
    roleCode: string,
    assetId?: string | null,
  ): Promise<string | null> {
    const matches = await client.userRole.findMany({
      where: {
        role: { code: roleCode, deletedAt: null, isActive: true },
        user: { isActive: true },
      },
      orderBy: { assignedAt: 'asc' },
      take: 25,
      select: {
        userId: true,
        user: {
          select: {
            userRoles: {
              select: {
                role: { select: { code: true, deletedAt: true, isActive: true } },
              },
            },
          },
        },
      },
    });
    if (!assetId) return matches[0]?.userId ?? null;

    for (const match of matches) {
      const candidateRoleCodes = match.user.userRoles
        .map((userRole) => userRole.role)
        .filter((role) => role.isActive && !role.deletedAt)
        .map((role) => role.code);
      if (await this.roleCodesCanSeeAsset(candidateRoleCodes, assetId, client)) {
        return match.userId;
      }
    }
    return null;
  }

  private async event(
    caseId: string,
    actor: string,
    action: string,
    extra: { taskId?: string; fromStatus?: string; toStatus?: string; comment?: string } = {},
  ): Promise<void> {
    await this.prisma.workflowEvent.create({
      data: {
        caseId,
        taskId: extra.taskId ?? null,
        actor,
        action,
        fromStatus: extra.fromStatus ?? null,
        toStatus: extra.toStatus ?? null,
        comment: extra.comment ?? null,
      },
    });
  }
}
