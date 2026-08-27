import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  ApprovalStatus,
  AssignmentTargetType,
  CaseStatus,
  Prisma,
  TaskDecision,
  TaskStatus,
  WorkflowAttachmentKind,
  WorkflowDelegationStatus,
  GovernanceNotificationChannel,
  GovernanceNotificationDeliveryStatus,
  GovernanceNotificationSeverity,
  WorkflowSlaBreachPolicy,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import { AssignmentsService } from '../ownership/assignments.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { AuthUser } from '../auth/auth.types';
import { parsePageParams, toPaged } from '../common/pagination';
import { formatBusinessSequence, nextAvailableBusinessCode } from '../common/business-sequence';
import { sanitizeAttachmentFilename } from '../common/download';
import { boundedEnvInteger } from '../common/runtime-safety';
import {
  AddTaskDto,
  AddWorkflowCommentDto,
  CreateWorkflowDelegationDto,
  CreateWorkflowTemplateDto,
  CreateCaseDto,
  DecisionDto,
  ListWorkflowDesignerTestRunsDto,
  SaveWorkflowBpmnDto,
  SaveWorkflowTaskFormDraftDto,
  SubmitWorkflowTaskFormDto,
  SubmitAssignmentDto,
  WorkflowCaseControlDto,
  WorkflowTemplateReviewDto,
  WorkflowTemplateLifecycleDto,
  WorkflowDesignerTestRunDto,
  WorkflowTemplateMigrationExecuteDto,
  WorkflowTemplateRollbackDto,
  UpdateWorkflowDelegationDto,
  UpdateCaseDto,
  UpdateTaskDto,
  UploadWorkflowAttachmentDto,
  UpsertWorkflowVariableDto,
  UpsertWorkflowSlaTemplateDto,
  WorkflowOperationsReportQueryDto,
  WorkflowDesignerMigrationPreviewDto,
  WorkflowDesignerSimulationDto,
  WorkflowRoutePreviewDto,
} from './workflow.dto';
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  PRODUCTION_PILOT_GUARDRAILS,
  WORKFLOW_ACCEPTANCE_CRITERIA,
  WORKFLOW_AUDIT_EVENT_CATALOG,
  buildWorkflowCaseTypeRegistry,
  buildWorkflowEscalationTemplates,
  buildWorkflowMvpReadinessGate,
  buildWorkflowNotificationRules,
  buildWorkflowSlaTemplates,
  buildWorkflowVersionDiff,
  buildWorkflowVariableContext,
  evaluateWorkflowDmnTable,
  firstActionableWorkflowStage,
  isAutomatedWorkflowStage,
  isActionableWorkflowStage,
  isRoutingOnlyWorkflowStage,
  isWorkflowDefaultPath,
  normalizeWorkflowConnectorType,
  routeGateForOpenStagePeers,
  selectWorkflowTransitionForDecision,
  selectWorkflowTemplate,
  validateWorkflowFormData,
  workflowFormAttachmentFieldNames,
  workflowEndOutcomes,
  workflowFormRequiredFields,
  workflowNodePalette,
  WORKFLOW_CONNECTOR_TYPES,
  WORKFLOW_CASE_TYPES,
  WORKFLOW_DEFAULT_VARIABLES,
  WORKFLOW_DESIGNER_LIFECYCLE,
  WORKFLOW_RETURN_FOR_CLARIFICATION,
  WORKFLOW_TASK_TYPES,
  WORKFLOW_VARIABLE_TYPES,
  workflowHealth,
  type WorkflowDecisionValue,
  type WorkflowRouteCandidate,
  type WorkflowStageRouteNode,
  type WorkflowTemplateSeed,
} from './workflow.logic';
import { validateWorkflowAutomationConfig } from './workflow.automation';
import {
  parseBpmnXml,
  simulateWorkflowRoute,
  templateToBpmnXml,
  validateWorkflowRoute,
  WORKFLOW_BPMN_LAYOUT_VERSION,
  type WorkflowBpmnStage,
  type WorkflowBpmnTemplate,
  type WorkflowBpmnTransition,
  type WorkflowBpmnValidation,
} from './workflow.bpmn';

export type SlaStatus = 'none' | 'on_track' | 'at_risk' | 'overdue' | 'done';

const AT_RISK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // within 2 days of due date
const DMO_ADMIN_CODE = 'dmo_admin';
const ADMIN_ROLES = ['system_admin', DMO_ADMIN_CODE];
const DATA_OWNER_CODE = 'data_owner';
type PrismaWriter = PrismaService | Prisma.TransactionClient;
const CASE_STATUS_SUSPENDED = 'suspended' as CaseStatus;
const CASE_STATUS_CANCELLED = 'cancelled' as CaseStatus;
const CASE_STATUS_FAILED = 'failed' as CaseStatus;
const FINAL_CASE_STATUSES: readonly CaseStatus[] = [
  CaseStatus.closed,
  CaseStatus.implemented,
  CaseStatus.rejected,
  CASE_STATUS_CANCELLED,
  CASE_STATUS_FAILED,
];
const WORKFLOW_CASE_DEFAULT_PAGE_SIZE = 50;
const WORKFLOW_TASK_DEFAULT_PAGE_SIZE = 50;
const WORKFLOW_GRAPH_CASE_LIMIT = 200;
const WORKFLOW_TEST_RUN_DEFAULT_PAGE_SIZE = 10;
const WORKFLOW_TEST_RUN_CREATE_ATTEMPTS = 5;
const WORKFLOW_REPORT_CASE_LIMIT = 2_000;
const SYSTEM_ROUTE_GRAPH_REVISIONS: Readonly<Record<string, string>> = Object.fromEntries(
  DEFAULT_WORKFLOW_TEMPLATES.map((seed) => [seed.code, 'v6-volume2-complete-3']),
);
const WORKFLOW_ROUTE_TYPE_PRIORITY = [
  'owner_assignment_approval',
  'steward_assignment_approval',
  'data_quality_issue',
  'metadata_certification',
  'asset_lifecycle_decision',
  'business_impact_assessment',
  'compliance_calendar',
  'privacy_dpia',
  'privacy_dsr',
  'privacy_breach',
  'foi_request',
  'foi_appeal',
  'data_sharing_request',
  'open_data_publication_approval',
  'dlp_incident',
  'classification_change_request',
  'architecture_review',
  'business_glossary_term',
  'general',
] as const;
const WORKFLOW_ROUTE_TYPE_RANK = new Map<string, number>(
  WORKFLOW_ROUTE_TYPE_PRIORITY.map((type, index) => [type, index]),
);
const CASE_TRANSITIONS: Record<string, CaseStatus[]> = {
  [CaseStatus.draft]: [CaseStatus.submitted, CASE_STATUS_CANCELLED, CaseStatus.closed],
  [CaseStatus.submitted]: [CaseStatus.under_review, CaseStatus.awaiting_information, CaseStatus.rejected, CASE_STATUS_SUSPENDED, CASE_STATUS_CANCELLED, CASE_STATUS_FAILED, CaseStatus.closed],
  [CaseStatus.under_review]: [
    CaseStatus.awaiting_information,
    CaseStatus.decision_made,
    CaseStatus.approved,
    CaseStatus.rejected,
    CASE_STATUS_SUSPENDED,
    CASE_STATUS_CANCELLED,
    CASE_STATUS_FAILED,
    CaseStatus.closed,
  ],
  [CaseStatus.awaiting_information]: [CaseStatus.under_review, CaseStatus.rejected, CASE_STATUS_SUSPENDED, CASE_STATUS_CANCELLED, CaseStatus.closed],
  [CaseStatus.decision_made]: [CaseStatus.approved, CaseStatus.rejected, CASE_STATUS_SUSPENDED, CASE_STATUS_CANCELLED, CaseStatus.closed],
  [CaseStatus.approved]: [CaseStatus.implemented, CASE_STATUS_SUSPENDED, CASE_STATUS_CANCELLED, CaseStatus.closed],
  [CaseStatus.rejected]: [CaseStatus.closed],
  [CaseStatus.implemented]: [CaseStatus.closed],
  [CASE_STATUS_SUSPENDED]: [CaseStatus.submitted, CaseStatus.under_review, CaseStatus.awaiting_information, CaseStatus.decision_made, CaseStatus.approved, CASE_STATUS_CANCELLED, CASE_STATUS_FAILED],
  [CASE_STATUS_CANCELLED]: [],
  [CASE_STATUS_FAILED]: [],
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
      assigneeRoleCode: true,
      formSchemaJson: true,
      gatewayConfigJson: true,
      sortOrder: true,
      isDecision: true,
      isFinal: true,
    },
  },
};

const decisionStageSelect = {
  id: true,
  code: true,
  nameEn: true,
  evidenceRequirementsJson: true,
  formSchemaJson: true,
  gatewayConfigJson: true,
  assigneeRoleCode: true,
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
    where: { isActive: true },
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
type WorkflowTokenLineageContext = {
  parentTokenId?: string | null;
  rootTokenId?: string | null;
  sourceTransitionId?: string | null;
  branchKey?: string | null;
  branchIndex?: number | null;
  joinKey?: string | null;
  joinStack?: string[];
};
type RouteAdvancePlan = {
  fromStage: WorkflowStageWithRoute;
  transition?: WorkflowTransitionWithRoute | null;
  passThroughStages?: WorkflowStageWithRoute[];
  nextStage?: WorkflowStageWithRoute | null;
  parallelBranches?: Array<{
    stage: WorkflowStageWithRoute;
    transition: WorkflowTransitionWithRoute;
    branchKey: string;
    branchIndex: number;
    joinKey: string;
  }>;
  mergeWaitStage?: WorkflowStageWithRoute | null;
  finalStatus?: CaseStatus | null;
  toStatus?: CaseStatus | null;
};
type WorkflowWriter = PrismaService | Prisma.TransactionClient;

export interface WorkflowAttachmentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const WORKFLOW_ATTACHMENT_OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

@Injectable()
export class WorkflowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowService.name);
  private executionWorker: ReturnType<typeof setInterval> | null = null;
  private executionWorkerRunning = false;
  private readonly attachmentStorageDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly assignments: AssignmentsService,
    private readonly integrations: IntegrationsService,
  ) {
    const configured = process.env.WORKFLOW_ATTACHMENT_STORAGE_DIR || 'storage/workflow-attachments';
    this.attachmentStorageDir = isAbsolute(configured) ? resolve(configured) : resolve(process.cwd(), configured);
    if (!existsSync(this.attachmentStorageDir)) mkdirSync(this.attachmentStorageDir, { recursive: true });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaultTemplates();
      if (this.shouldRunStartupMaintenance()) {
        const result = await this.runMaintenanceInternal();
        if (result.unroutedCases > 0) {
          this.logger.log(`Backfilled ${result.unroutedCases} unrouted workflow cases into route templates`);
        }
        if (result.reassignedTasks > 0) {
          this.logger.log(`Assigned ${result.reassignedTasks} routed workflow tasks to eligible role holders`);
        }
        if (result.normalizedSlaTasks > 0) {
          this.logger.log(`Normalized ${result.normalizedSlaTasks} immediate workflow task due dates`);
        }
        if (result.designerTestRuns > 0) {
          this.logger.log(`Seeded ${result.designerTestRuns} isolated workflow designer test runs`);
        }
      }
    } catch (err) {
      this.logger.error('Failed to initialize default workflow templates', err as Error);
    }
    if (process.env.WORKFLOW_EXECUTION_SCHEDULER !== 'false') {
      const intervalMs = boundedEnvInteger('WORKFLOW_EXECUTION_SCHEDULER_MS', 60_000, 60_000, 3_600_000);
      this.executionWorker = setInterval(() => void this.processRunnableExecutions(), intervalMs);
      void this.processRunnableExecutions();
    }
  }

  onModuleDestroy(): void {
    if (this.executionWorker) clearInterval(this.executionWorker);
    this.executionWorker = null;
  }

  private shouldRunStartupMaintenance(): boolean {
    const explicit = process.env.DGOP_WORKFLOW_STARTUP_MAINTENANCE?.trim().toLowerCase();
    if (explicit) return ['1', 'true', 'yes', 'on'].includes(explicit);
    return process.env.NODE_ENV !== 'production';
  }

  private async runMaintenanceInternal() {
    const unroutedCases = await this.backfillUnroutedOpenCases();
    const reassignedTasks = await this.assignUnownedRoutedTasks();
    const normalizedSlaTasks = await this.normalizeImmediateSlaDueDates();
    const signedTemplates = await this.signUnsignedWorkflowModels();
    const designerTestRuns = await this.seedDesignerTestRunEvidence();
    const executions = await this.processRunnableExecutions();
    return { unroutedCases, reassignedTasks, normalizedSlaTasks, signedTemplates, designerTestRuns, executions };
  }

  async runMaintenance(user: AuthUser) {
    if (!user.roles.some((role) => ADMIN_ROLES.includes(role))) {
      throw new ForbiddenException('Only workflow administrators can run workflow maintenance');
    }
    await this.ensureDefaultTemplates();
    const result = await this.runMaintenanceInternal();
    await this.audit.log({
      actor: user.email,
      action: 'workflow.maintenance.run',
      entityType: 'workflow_engine',
      metadata: result,
    });
    return result;
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
      } else if (SYSTEM_ROUTE_GRAPH_REVISIONS[seed.code]) {
        await this.reconcileManagedSystemRoute(existing.id, seed, SYSTEM_ROUTE_GRAPH_REVISIONS[seed.code]);
      }
    }
  }

  private async reconcileManagedSystemRoute(
    templateId: string,
    seed: WorkflowTemplateSeed,
    seedRevision: string,
  ): Promise<void> {
    const current = await this.prisma.workflowTemplate.findUnique({
      where: { id: templateId },
      include: templateInclude,
    });
    if (!current?.isSystem || current.deletedAt || current.createdBy !== 'system') return;
    const designer = this.jsonRecord(current.designerJson);
    const activeStages = current.stages.filter((stage) => stage.isActive);
    const expectedStageTypes = new Map(
      seed.stages.map((stage) => [
        stage.code,
        stage.nodeType ?? (stage.taskType === 'approval' ? 'approval_task' : 'user_task'),
      ]),
    );
    const stageGraphMatches = activeStages.length === seed.stages.length && activeStages.every(
      (stage) => expectedStageTypes.get(stage.code) === stage.nodeType,
    );
    const expectedTransitions = new Set(seed.transitions.map((transition) => [
      transition.from,
      transition.to,
      transition.decision ?? '',
      normalizeWorkflowConnectorType(transition.connectorType),
    ].join('|')));
    const stageCodeById = new Map(activeStages.map((stage) => [stage.id, stage.code]));
    const transitionGraphMatches = current.transitions.length === seed.transitions.length && current.transitions.every(
      (transition) => expectedTransitions.has([
        stageCodeById.get(transition.fromStageId) ?? '',
        stageCodeById.get(transition.toStageId) ?? '',
        transition.decision ?? '',
        normalizeWorkflowConnectorType(transition.connectorType),
      ].join('|')),
    );
    const graphMatches = stageGraphMatches && transitionGraphMatches;
    const stageLocalizationMatches = activeStages.every((stage) =>
      seed.stages.some((candidate) => candidate.code === stage.code && candidate.nameAr === stage.nameAr),
    );
    const transitionLocalizationMatches = current.transitions.every((transition) => {
      const from = stageCodeById.get(transition.fromStageId) ?? '';
      const to = stageCodeById.get(transition.toStageId) ?? '';
      return seed.transitions.some((candidate) =>
        candidate.from === from && candidate.to === to &&
        (candidate.decision ?? null) === (transition.decision ?? null) &&
        candidate.labelAr === transition.labelAr,
      );
    });
    const localizationMatches = current.nameAr === seed.nameAr && stageLocalizationMatches && transitionLocalizationMatches;
    if (
      designer['seedRevision'] === seedRevision &&
      this.jsonRecord(current.securityJson)['bpmnLayoutVersion'] === WORKFLOW_BPMN_LAYOUT_VERSION &&
      graphMatches &&
      localizationMatches
    ) return;
    const source = String(designer['source'] ?? 'generated_from_route');
    const isManagedSource = source.startsWith('route_seed') || ['generated_from_route', 'maintenance_signature'].includes(source);
    if (!isManagedSource) return;
    if (current.lastPublishedBy && current.lastPublishedBy !== 'system') return;

    const bpmnTemplate = this.bpmnTemplateFromSeed(seed);
    const validation = validateWorkflowRoute(bpmnTemplate.stages, bpmnTemplate.transitions);
    if (validation.status === 'blocked') {
      this.logger.error(`System route seed ${seed.code} is blocked: ${validation.errors.join(' ')}`);
      return;
    }
    const bpmnXml = templateToBpmnXml(bpmnTemplate);
    const designerJson = {
      source: 'route_seed_upgrade',
      seedRevision,
      bpmnLayoutVersion: WORKFLOW_BPMN_LAYOUT_VERSION,
      managedBy: 'system',
    };
    const security = this.secureWorkflowModel(bpmnXml, designerJson, 'system');
    const latestVersion = await this.prisma.workflowTemplateVersion.findFirst({
      where: { templateId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = Math.max(current.designerVersion, latestVersion?.version ?? 0) + 1;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const stageByCode = new Map<string, string>();
      for (const [index, stage] of seed.stages.entries()) {
        const saved = await tx.workflowTemplateStage.upsert({
          where: { templateId_code: { templateId, code: stage.code } },
          create: {
            templateId,
            code: stage.code,
            nameEn: stage.nameEn,
            nameAr: stage.nameAr,
            description: stage.description ?? null,
            kind: stage.kind,
            nodeType: stage.nodeType ?? (stage.taskType === 'approval' ? 'approval_task' : 'user_task'),
            taskType: stage.taskType,
            assignmentStrategy: stage.assignmentStrategy ?? 'role',
            assignmentConfigJson: (stage.assignmentConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            assigneeRoleCode: stage.assigneeRoleCode ?? null,
            dueDays: stage.dueDays,
            formSchemaJson: (stage.formSchemaJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            slaConfigJson: (stage.slaConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            notificationRulesJson: (stage.notificationRulesJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            evidenceRequirementsJson: (stage.evidenceRequirementsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            automationConfigJson: (stage.automationConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            gatewayConfigJson: (stage.gatewayConfigJson ?? (stage.isFinal ? { outcomes: workflowEndOutcomes() } : Prisma.JsonNull)) as Prisma.InputJsonValue,
            parallelGroup: stage.parallelGroup ?? null,
            sortOrder: index + 1,
            isStart: stage.isStart ?? false,
            isDecision: stage.isDecision ?? false,
            isFinal: stage.isFinal ?? false,
            isActive: true,
          },
          update: {
            nameEn: stage.nameEn,
            nameAr: stage.nameAr,
            description: stage.description ?? null,
            kind: stage.kind,
            nodeType: stage.nodeType ?? (stage.taskType === 'approval' ? 'approval_task' : 'user_task'),
            taskType: stage.taskType,
            assignmentStrategy: stage.assignmentStrategy ?? 'role',
            assignmentConfigJson: (stage.assignmentConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            assigneeRoleCode: stage.assigneeRoleCode ?? null,
            dueDays: stage.dueDays,
            formSchemaJson: (stage.formSchemaJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            slaConfigJson: (stage.slaConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            notificationRulesJson: (stage.notificationRulesJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            evidenceRequirementsJson: (stage.evidenceRequirementsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            automationConfigJson: (stage.automationConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            gatewayConfigJson: (stage.gatewayConfigJson ?? (stage.isFinal ? { outcomes: workflowEndOutcomes() } : Prisma.JsonNull)) as Prisma.InputJsonValue,
            parallelGroup: stage.parallelGroup ?? null,
            sortOrder: index + 1,
            isStart: stage.isStart ?? false,
            isDecision: stage.isDecision ?? false,
            isFinal: stage.isFinal ?? false,
            isActive: true,
          },
          select: { id: true },
        });
        stageByCode.set(stage.code, saved.id);
      }
      await tx.workflowTemplateStage.updateMany({
        where: { templateId, code: { notIn: seed.stages.map((stage) => stage.code) } },
        data: { isActive: false },
      });

      const existingTransitions = await tx.workflowTemplateTransition.findMany({ where: { templateId } });
      await tx.workflowTemplateTransition.updateMany({
        where: { templateId, isActive: true },
        data: { isActive: false, retiredAt: now, retiredBy: 'system' },
      });
      for (const [index, transition] of seed.transitions.entries()) {
        const fromStageId = stageByCode.get(transition.from);
        const toStageId = stageByCode.get(transition.to);
        if (!fromStageId || !toStageId) continue;
        const match = existingTransitions.find((candidate) =>
          candidate.fromStageId === fromStageId &&
          candidate.toStageId === toStageId &&
          (candidate.decision ?? null) === (transition.decision ?? null),
        );
        const data = {
          labelEn: transition.labelEn,
          labelAr: transition.labelAr,
          connectorType: normalizeWorkflowConnectorType(transition.connectorType),
          decision: transition.decision ?? null,
          isDefaultPath: Boolean(transition.isDefaultPath),
          isHappyPath: transition.isHappyPath ?? true,
          sortOrder: index + 1,
          isActive: true,
          retiredAt: null,
          retiredBy: null,
        };
        if (match) {
          await tx.workflowTemplateTransition.update({ where: { id: match.id }, data });
        } else {
          await tx.workflowTemplateTransition.create({ data: { templateId, fromStageId, toStageId, ...data } });
        }
      }

      await tx.workflowTemplate.update({
        where: { id: templateId },
        data: {
          caseType: seed.caseType,
          nameEn: seed.nameEn,
          nameAr: seed.nameAr,
          description: seed.description,
          trigger: seed.trigger,
          defaultSlaDays: seed.defaultSlaDays,
          bpmnXml,
          designerJson: designerJson as Prisma.InputJsonValue,
          designerVersion: nextVersion,
          lastPublishedAt: now,
          lastPublishedBy: 'system',
          modelSignature: security.modelSignature,
          signatureAlgorithm: security.signatureAlgorithm,
          securityJson: security.securityJson as Prisma.InputJsonValue,
        },
      });
      await tx.workflowTemplateVersion.create({
        data: {
          templateId,
          version: nextVersion,
          source: 'route_seed_upgrade',
          changeSummary: `Managed Volume 2 route graph upgrade ${seedRevision}`,
          bpmnXml,
          designerJson: designerJson as Prisma.InputJsonValue,
          validationJson: validation as unknown as Prisma.InputJsonValue,
          modelSignature: security.modelSignature,
          signatureAlgorithm: security.signatureAlgorithm,
          encryptedSnapshotJson: security.encryptedSnapshotJson as Prisma.InputJsonValue,
          securityJson: security.securityJson as Prisma.InputJsonValue,
          createdBy: 'system',
        },
      });
      await this.audit.log({
        actor: 'system',
        action: 'workflow_template.system_route.upgrade',
        entityType: 'workflow_template',
        entityId: templateId,
        metadata: { code: seed.code, seedRevision, version: nextVersion },
      }, tx);
    });
  }

  private bpmnTemplateFromSeed(seed: WorkflowTemplateSeed): WorkflowBpmnTemplate {
    return {
      id: `system-seed:${seed.code}`,
      code: seed.code,
      caseType: seed.caseType,
      nameEn: seed.nameEn,
      nameAr: seed.nameAr,
      description: seed.description,
      defaultSlaDays: seed.defaultSlaDays,
      stages: seed.stages.map((stage, index) => ({
        ...stage,
        nodeType: stage.nodeType ?? (stage.taskType === 'approval' ? 'approval_task' : 'user_task'),
        assignmentStrategy: stage.assignmentStrategy ?? 'role',
        assignmentConfigJson: stage.assignmentConfigJson ?? null,
        sortOrder: index + 1,
        isStart: stage.isStart ?? false,
        isDecision: stage.isDecision ?? false,
        isFinal: stage.isFinal ?? false,
        isActive: true,
      })),
      transitions: seed.transitions.map((transition, index) => ({
        fromStageId: transition.from,
        toStageId: transition.to,
        labelEn: transition.labelEn,
        labelAr: transition.labelAr,
        connectorType: normalizeWorkflowConnectorType(transition.connectorType),
        decision: transition.decision ?? null,
        isDefaultPath: Boolean(transition.isDefaultPath),
        isHappyPath: transition.isHappyPath ?? true,
        sortOrder: index + 1,
      })),
    };
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
            nodeType: stage.nodeType ?? (stage.taskType === 'approval' ? 'approval_task' : 'user_task'),
            taskType: stage.taskType,
            assignmentStrategy: stage.assignmentStrategy ?? 'role',
            assignmentConfigJson: (stage.assignmentConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            assigneeRoleCode: stage.assigneeRoleCode ?? null,
            dueDays: stage.dueDays,
            formSchemaJson: (stage.formSchemaJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            slaConfigJson: (stage.slaConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            notificationRulesJson: (stage.notificationRulesJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            evidenceRequirementsJson: (stage.evidenceRequirementsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            automationConfigJson: (stage.automationConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            gatewayConfigJson: (stage.gatewayConfigJson ?? (stage.isFinal ? { outcomes: workflowEndOutcomes() } : Prisma.JsonNull)) as Prisma.InputJsonValue,
            parallelGroup: stage.parallelGroup ?? null,
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
            connectorType: normalizeWorkflowConnectorType(transition.connectorType),
            decision: transition.decision ?? null,
            isDefaultPath: Boolean(transition.isDefaultPath),
            isHappyPath: transition.isHappyPath ?? true,
            sortOrder: index + 1,
          },
        });
      }
    });
  }

  private async signUnsignedWorkflowModels(limit = 250): Promise<number> {
    const templates = await this.prisma.workflowTemplate.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ modelSignature: null }, { signatureAlgorithm: null }],
      },
      include: templateInclude,
      orderBy: { updatedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    let signed = 0;
    for (const template of templates) {
      const bpmnXml = template.bpmnXml ?? templateToBpmnXml(this.toBpmnTemplate(template));
      const designerJson = template.designerJson ?? {
        source: template.bpmnXml ? 'saved_bpmn' : 'generated_from_route',
        signedByMaintenance: true,
        bpmnLayoutVersion: WORKFLOW_BPMN_LAYOUT_VERSION,
      };
      const security = this.secureWorkflowModel(bpmnXml, designerJson, 'system');
      await this.prisma.$transaction(async (tx) => {
        await tx.workflowTemplate.update({
          where: { id: template.id },
          data: {
            bpmnXml,
            designerJson: designerJson as Prisma.InputJsonValue,
            modelSignature: security.modelSignature,
            signatureAlgorithm: security.signatureAlgorithm,
            securityJson: security.securityJson as Prisma.InputJsonValue,
          },
        });
        const latest = await tx.workflowTemplateVersion.findFirst({
          where: { templateId: template.id },
          orderBy: { version: 'desc' },
        });
        if (latest && !latest.modelSignature) {
          await tx.workflowTemplateVersion.update({
            where: { id: latest.id },
            data: {
              modelSignature: security.modelSignature,
              signatureAlgorithm: security.signatureAlgorithm,
              encryptedSnapshotJson: security.encryptedSnapshotJson as Prisma.InputJsonValue,
              securityJson: security.securityJson as Prisma.InputJsonValue,
            },
          });
        } else if (!latest) {
          await tx.workflowTemplateVersion.create({
            data: {
              templateId: template.id,
              version: template.designerVersion ?? 1,
              source: 'maintenance_signature',
              changeSummary: 'Initial signed workflow model snapshot',
              bpmnXml,
              designerJson: designerJson as Prisma.InputJsonValue,
              validationJson: this.currentRouteValidation(template) as unknown as Prisma.InputJsonValue,
              modelSignature: security.modelSignature,
              signatureAlgorithm: security.signatureAlgorithm,
              encryptedSnapshotJson: security.encryptedSnapshotJson as Prisma.InputJsonValue,
              securityJson: security.securityJson as Prisma.InputJsonValue,
              createdBy: 'system',
            },
          });
        }
        await this.audit.log(
          {
            actor: 'system',
            action: 'workflow_template.model.sign',
            entityType: 'workflow_template',
            entityId: template.id,
            metadata: { code: template.code, algorithm: security.signatureAlgorithm },
          },
          tx,
        );
      });
      signed++;
    }
    return signed;
  }

  private async seedDesignerTestRunEvidence(limit = 100): Promise<number> {
    const templates = await this.prisma.workflowTemplate.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        testRuns: { none: { status: { not: 'reset' } } },
      },
      include: templateInclude,
      orderBy: [{ isSystem: 'desc' }, { caseType: 'asc' }, { code: 'asc' }],
      take: Math.min(Math.max(limit, 1), 250),
    });
    let seeded = 0;
    for (const template of templates) {
      const route = this.currentDesignerRoute(template);
      if (route.validation.status === 'blocked') continue;
      const simulation = simulateWorkflowRoute(route.stages, route.transitions, {});
      if (simulation.status === 'blocked') continue;
      await this.prisma.$transaction(async (tx) => {
        const latest = await tx.workflowDesignerTestRun.aggregate({
          where: { templateId: template.id },
          _max: { runNumber: true },
        });
        const created = await tx.workflowDesignerTestRun.create({
          data: {
            templateId: template.id,
            runNumber: (latest._max.runNumber ?? 0) + 1,
            environment: 'demo',
            status: simulation.status,
            bpmnXml: route.bpmnXml,
            validationJson: route.validation as unknown as Prisma.InputJsonValue,
            inputJson: {
              environment: 'demo',
              variables: { source: 'startup_maintenance' },
              decisions: {},
              isolation: {
                mode: 'designer_test_space',
                productionCasesCreated: 0,
                productionTasksCreated: 0,
                productionRuntimeTokensCreated: 0,
              },
            } as Prisma.InputJsonValue,
            simulationJson: simulation as unknown as Prisma.InputJsonValue,
            executedPathJson: {
              path: simulation.path,
              blockers: simulation.blockers,
              warnings: simulation.warnings,
              summary: simulation.summary,
            } as Prisma.InputJsonValue,
            createdBy: 'system',
          },
        });
        await this.audit.log(
          {
            actor: 'system',
            action: 'workflow_template.test_run.execute',
            entityType: 'workflow_template',
            entityId: template.id,
            metadata: {
              runId: created.id,
              runNumber: created.runNumber,
              status: created.status,
              environment: created.environment,
              source: 'startup_maintenance',
              pathLength: simulation.path.length,
              productionCasesCreated: 0,
              productionTasksCreated: 0,
            },
          },
          tx,
        );
      });
      seeded++;
    }
    return seeded;
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
            data: {
              templateStageId: firstStage.id,
              assigneeRoleCode: firstStage.assigneeRoleCode ?? null,
            },
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
        OR: [
          { assigneeRoleCode: { not: null } },
          { templateStage: { is: { assigneeRoleCode: { not: null }, isActive: true } } },
        ],
        case: { templateId: { not: null }, status: { notIn: [...FINAL_CASE_STATUSES] } },
      },
      select: {
        id: true,
        caseId: true,
        title: true,
        assigneeRoleCode: true,
        case: { select: { assetId: true } },
        templateStage: { select: { nameEn: true, assigneeRoleCode: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    let assigned = 0;
    for (const task of tasks) {
      const roleCode = task.assigneeRoleCode ?? task.templateStage?.assigneeRoleCode;
      if (!roleCode) continue;
      const didAssign = await this.prisma.$transaction(async (tx) => {
        const current = await tx.workflowTask.findUnique({
          where: { id: task.id },
          select: {
            id: true,
            caseId: true,
            assigneeUserId: true,
            assigneeRoleCode: true,
            status: true,
            case: { select: { assetId: true, status: true } },
            templateStage: { select: { nameEn: true, assigneeRoleCode: true } },
          },
        });
        const targetRoleCode = current?.assigneeRoleCode ?? current?.templateStage?.assigneeRoleCode;
        if (
          !current ||
          current.assigneeUserId ||
          (current.status !== TaskStatus.pending && current.status !== TaskStatus.in_progress) ||
          FINAL_CASE_STATUSES.includes(current.case.status) ||
          !targetRoleCode
        ) {
          return false;
        }
        const assigneeUserId = await this.assigneeForRole(
          tx,
          targetRoleCode,
          current.case.assetId,
        );
        if (!assigneeUserId) return false;
        await tx.workflowTask.update({
          where: { id: current.id },
          data: { assigneeUserId, assigneeRoleCode: targetRoleCode },
        });
        await tx.workflowEvent.create({
          data: {
            caseId: current.caseId,
            taskId: current.id,
            actor: 'system',
            action: 'task.auto_assigned',
            comment: `${targetRoleCode} -> ${assigneeUserId}`,
          },
        });
        await this.audit.log(
          {
            actor: 'system',
            action: 'workflow_task.auto_assign',
            entityType: 'workflow_task',
            entityId: current.id,
            metadata: {
              roleCode: targetRoleCode,
              assigneeUserId,
              fallbackQueue: roleCode !== targetRoleCode ? roleCode : null,
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

  private templateScopeWhere(roleCodes: string[], activeOnly = false): Promise<Prisma.WorkflowTemplateWhereInput> {
    return this.scope.resolve(roleCodes).then((scope) => {
      if (scope.domains === 'all') return { deletedAt: null, ...(activeOnly ? { isActive: true } : {}) };
      return {
        deletedAt: null,
        ...(activeOnly ? { isActive: true } : {}),
        OR: [{ domainId: null }, { domainId: { in: scope.domains } }],
      };
    });
  }

  private async routeCandidates(roleCodes: string[]): Promise<WorkflowRouteCandidate[]> {
    const where = await this.templateScopeWhere(roleCodes, true);
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
      where: { id: selected.id, ...(await this.templateScopeWhere(roleCodes, true)) },
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
    const templates = await this.prisma.workflowTemplate.findMany({
      where: await this.templateScopeWhere(roleCodes),
      include: templateInclude,
      orderBy: [{ isSystem: 'desc' }, { caseType: 'asc' }, { code: 'asc' }],
    });
    return this.sortWorkflowTemplates(templates);
  }

  private sortWorkflowTemplates<T extends { caseType: string; code: string; nameEn: string; isSystem: boolean }>(
    templates: T[],
  ): T[] {
    return [...templates].sort((a, b) => {
      const typeDelta = (WORKFLOW_ROUTE_TYPE_RANK.get(a.caseType) ?? 999) - (WORKFLOW_ROUTE_TYPE_RANK.get(b.caseType) ?? 999);
      if (typeDelta !== 0) return typeDelta;
      const systemDelta = Number(b.isSystem) - Number(a.isSystem);
      if (systemDelta !== 0) return systemDelta;
      const nameDelta = a.nameEn.localeCompare(b.nameEn);
      if (nameDelta !== 0) return nameDelta;
      return a.code.localeCompare(b.code);
    });
  }

  async createDesignerTemplate(dto: CreateWorkflowTemplateDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    const code = await this.uniqueTemplateCode(dto.code ?? dto.nameEn);
    const initialStages = this.initialDesignerStages();
    const initialTransitions = [
      {
        fromStageId: 'intake',
        toStageId: 'review',
        labelEn: 'Ready for review',
        labelAr: 'Ready for review',
        connectorType: 'sequence',
        decision: null,
        isDefaultPath: false,
        isHappyPath: true,
        sortOrder: 1,
      },
      {
        fromStageId: 'review',
        toStageId: 'closure',
        labelEn: 'Complete route',
        labelAr: 'Complete route',
        connectorType: 'success',
        decision: 'approved',
        isDefaultPath: false,
        isHappyPath: true,
        sortOrder: 2,
      },
      {
        fromStageId: 'review',
        toStageId: 'intake',
        labelEn: 'Return for clarification',
        labelAr: 'Return for clarification',
        connectorType: 'return',
        decision: WORKFLOW_RETURN_FOR_CLARIFICATION,
        isDefaultPath: false,
        isHappyPath: false,
        sortOrder: 3,
      },
      {
        fromStageId: 'review',
        toStageId: 'closure',
        labelEn: 'Reject and close',
        labelAr: 'Reject and close',
        connectorType: 'failure',
        decision: 'rejected',
        isDefaultPath: true,
        isHappyPath: false,
        sortOrder: 4,
      },
    ];
    const parsed = dto.bpmnXml ? this.parseDesignerBpmn(dto.bpmnXml) : null;
    const validation = parsed?.validation ?? validateWorkflowRoute(initialStages, initialTransitions);
    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.workflowTemplate.create({
        data: {
          code,
          caseType: dto.caseType,
          nameEn: dto.nameEn.trim(),
          nameAr: (dto.nameAr ?? dto.nameEn).trim(),
          description: dto.description ?? null,
          trigger: dto.trigger ?? 'manual',
          domainId: dto.domainId ?? null,
          defaultSlaDays: dto.defaultSlaDays ?? 5,
          createdBy: user.email,
          isActive: false,
        },
      });
      await this.applyPublishedBpmnRoute(
        tx,
        template.id,
        parsed?.stages ?? initialStages,
        parsed?.transitions ?? initialTransitions,
        user.email,
      );
      const saved = await tx.workflowTemplate.findUnique({ where: { id: template.id }, include: templateInclude });
      if (!saved) throw new BadRequestException('Could not create workflow route');
      const bpmnXml = dto.bpmnXml ?? templateToBpmnXml(this.toBpmnTemplate(saved));
      const security = this.secureWorkflowModel(bpmnXml, parsed?.designerJson ?? { source: 'starter', stages: initialStages }, user.email);
      await tx.workflowTemplate.update({
        where: { id: template.id },
        data: {
          bpmnXml,
          designerJson: (parsed?.designerJson ?? { source: 'starter', stages: initialStages }) as Prisma.InputJsonValue,
          modelSignature: security.modelSignature,
          signatureAlgorithm: security.signatureAlgorithm,
          securityJson: this.workflowLifecycleMetadata('draft', user.email, security.securityJson, {
            createdBy: user.email,
            changeSummary: 'Initial workflow draft',
            reviewStatus: 'not_submitted',
          }) as Prisma.InputJsonValue,
        },
      });
      await tx.workflowTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          source: dto.bpmnXml ? 'import_draft' : 'draft',
          changeSummary: 'Initial workflow draft',
          bpmnXml,
          designerJson: (parsed?.designerJson ?? { source: 'starter', stages: initialStages }) as Prisma.InputJsonValue,
          validationJson: validation as unknown as Prisma.InputJsonValue,
          modelSignature: security.modelSignature,
          signatureAlgorithm: security.signatureAlgorithm,
          encryptedSnapshotJson: security.encryptedSnapshotJson as Prisma.InputJsonValue,
          securityJson: this.workflowLifecycleMetadata('draft', user.email, security.securityJson, {
            createdBy: user.email,
            version: 1,
            reviewStatus: 'not_submitted',
          }) as Prisma.InputJsonValue,
          createdBy: user.email,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_template.create',
          entityType: 'workflow_template',
          entityId: template.id,
          metadata: { code, caseType: dto.caseType },
        },
        tx,
      );
      return tx.workflowTemplate.findUnique({ where: { id: template.id }, include: templateInclude });
    });
    if (!created) throw new BadRequestException('Could not create workflow route');
    return this.designerResponse(created);
  }

  async cloneWorkflowTemplate(id: string, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    const source = await this.assertTemplateVisible(id, user);
    const sourceBpmn = this.designerBpmnXmlForTemplate(source);
    const created = await this.createDesignerTemplate({
      caseType: source.caseType,
      nameEn: `${source.nameEn} copy`,
      nameAr: `${source.nameAr} - copy`,
      description: source.description,
      trigger: source.trigger,
      domainId: source.domainId,
      defaultSlaDays: source.defaultSlaDays,
      bpmnXml: sourceBpmn,
    }, user);
    const sourceVariables = await this.workflowVariableSnapshot(id);
    if (sourceVariables.length) {
      await this.prisma.workflowVariableDefinition.createMany({
        data: sourceVariables.map((variable) => ({
          registryKey: `${created.template.id}:${variable.code.toLowerCase()}`,
          templateId: created.template.id,
          ...variable,
          defaultValueJson: variable.defaultValueJson ?? Prisma.JsonNull,
          allowedValuesJson: variable.allowedValuesJson ?? Prisma.JsonNull,
          createdBy: user.email,
        })),
      });
      const cloneDesignerJson = { ...this.jsonRecord(created.designerJson), variableDefinitions: sourceVariables };
      const security = this.secureWorkflowModel(created.bpmnXml, cloneDesignerJson, user.email);
      await this.prisma.$transaction([
        this.prisma.workflowTemplate.update({
          where: { id: created.template.id },
          data: {
            designerJson: cloneDesignerJson as Prisma.InputJsonValue,
            modelSignature: security.modelSignature,
            signatureAlgorithm: security.signatureAlgorithm,
          },
        }),
        this.prisma.workflowTemplateVersion.update({
          where: { templateId_version: { templateId: created.template.id, version: 1 } },
          data: {
            designerJson: cloneDesignerJson as Prisma.InputJsonValue,
            modelSignature: security.modelSignature,
            signatureAlgorithm: security.signatureAlgorithm,
            encryptedSnapshotJson: security.encryptedSnapshotJson as Prisma.InputJsonValue,
          },
        }),
      ]);
    }
    await this.audit.log({
      actor: user.email,
      action: 'workflow_template.clone',
      entityType: 'workflow_template',
      entityId: created.template.id,
      metadata: { sourceTemplateId: id, sourceCode: source.code },
    });
    return this.getTemplateDesigner(created.template.id, user.roles);
  }

  async controlWorkflowTemplateLifecycle(id: string, dto: WorkflowTemplateLifecycleDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    const template = await this.assertTemplateVisible(id, user);
    const lifecycle = this.workflowLifecycle(template.securityJson);
    const currentState = String(lifecycle['state'] ?? (template.isActive ? 'active' : 'draft'));
    const reason = dto.reason?.trim() || null;
    if (dto.action !== 'activate' && !reason) throw new BadRequestException('A reason is required for this lifecycle action');
    const activeCases = await this.prisma.workflowCase.count({
      where: { templateId: id, status: { notIn: [...FINAL_CASE_STATUSES] } },
    });
    if (dto.action === 'activate' && !template.lastPublishedAt) {
      throw new BadRequestException('Only a published workflow version can be activated');
    }
    if (dto.action === 'suspend' && !template.isActive) throw new BadRequestException('Only an active workflow can be suspended');
    if (['retire', 'archive', 'delete_draft'].includes(dto.action) && activeCases > 0) {
      throw new BadRequestException(`Workflow has ${activeCases} active case(s) and cannot be ${dto.action.replace('_', ' ')}`);
    }
    if (dto.action === 'archive' && currentState !== 'retired') {
      throw new BadRequestException('Only a retired workflow can be archived');
    }
    if (dto.action === 'delete_draft' && (template.isSystem || currentState !== 'draft')) {
      throw new BadRequestException('Only a non-system draft workflow can be deleted');
    }
    const nextState = dto.action === 'activate' ? 'active' : dto.action === 'delete_draft' ? 'deleted' : dto.action;
    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        isActive: dto.action === 'activate',
        deletedAt: dto.action === 'delete_draft' ? new Date() : null,
        securityJson: this.workflowLifecycleMetadata(nextState, user.email, template.securityJson, {
          lifecycleReason: reason,
          lifecycleChangedBy: user.email,
          lifecycleChangedAt: new Date().toISOString(),
        }) as Prisma.InputJsonValue,
      },
      include: templateInclude,
    });
    await this.audit.log({
      actor: user.email,
      action: `workflow_template.${dto.action}`,
      entityType: 'workflow_template',
      entityId: id,
      metadata: { fromState: currentState, toState: nextState, reason, activeCases },
    });
    return dto.action === 'delete_draft' ? { id, deleted: true } : this.designerResponse(updated);
  }

  async getTemplateDesigner(id: string, roleCodes: string[]) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id, ...(await this.templateScopeWhere(roleCodes)) },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('workflow route template not found');
    return this.designerResponse(template);
  }

  async layoutTemplateBpmn(id: string, dto: SaveWorkflowBpmnDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id, ...(await this.templateScopeWhere(user.roles)) },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('workflow route template not found');
    const parsed = this.parseDesignerBpmn(dto.bpmnXml);
    const bpmnXml = templateToBpmnXml({
      ...this.toBpmnTemplate(template),
      stages: parsed.stages,
      transitions: parsed.transitions,
    });
    return {
      bpmnXml,
      validation: parsed.validation,
      designerJson: {
        ...this.jsonRecord(parsed.designerJson),
        source: 'designer_auto_layout',
        bpmnLayoutVersion: WORKFLOW_BPMN_LAYOUT_VERSION,
      },
    };
  }

  async saveTemplateBpmnDraft(id: string, dto: SaveWorkflowBpmnDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id, ...(await this.templateScopeWhere(user.roles)) },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('workflow route template not found');
    const parsed = this.parseDesignerBpmn(dto.bpmnXml);
    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        bpmnXml: dto.bpmnXml,
        designerJson: parsed.designerJson as Prisma.InputJsonValue,
        securityJson: this.workflowLifecycleMetadata('draft', user.email, template.securityJson, {
          lastDesignedBy: user.email,
          changeSummary: dto.changeSummary ?? null,
          validationStatus: parsed.validation.status,
          reviewStatus: 'not_submitted',
          reviewRequestedBy: null,
          reviewRequestedAt: null,
          reviewComment: null,
          reviewModelSignature: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewDecisionComment: null,
          approvedModelSignature: null,
        }) as Prisma.InputJsonValue,
      },
      include: templateInclude,
    });
    await this.audit.log({
      actor: user.email,
      action: 'workflow_template.bpmn_draft.save',
      entityType: 'workflow_template',
      entityId: id,
      metadata: { status: parsed.validation.status, errors: parsed.validation.errors.length, warnings: parsed.validation.warnings.length },
    });
    return this.designerResponse(updated, parsed.validation);
  }

  async submitTemplateReview(id: string, dto: WorkflowTemplateReviewDto, user: AuthUser) {
    this.assertWorkflowLifecycleRole(user, 'designer', 'Only workflow designers can submit workflow routes for review');
    const template = await this.assertTemplateVisible(id, user);
    const route = this.designerRouteFromPayload(template, dto.bpmnXml);
    route.validation = await this.validateTemplateVariableReferences(id, route.stages, route.transitions, route.validation);
    if (route.validation.status === 'blocked') {
      throw new BadRequestException(`Workflow route cannot be submitted for review: ${route.validation.errors.join(' ')}`);
    }
    const reviewModelSignature = this.workflowReviewSignature(route.bpmnXml);
    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        bpmnXml: route.bpmnXml,
        designerJson: route.designerJson as Prisma.InputJsonValue,
        securityJson: this.workflowLifecycleMetadata('under_review', user.email, template.securityJson, {
          lastDesignedBy: user.email,
          validationStatus: route.validation.status,
          reviewStatus: 'pending',
          reviewRequestedBy: user.email,
          reviewRequestedAt: new Date().toISOString(),
          reviewComment: dto.comment ?? null,
          reviewModelSignature,
          reviewedBy: null,
          reviewedAt: null,
          reviewDecisionComment: null,
          approvedModelSignature: null,
        }) as Prisma.InputJsonValue,
      },
      include: templateInclude,
    });
    await this.audit.log({
      actor: user.email,
      action: 'workflow_template.review.submit',
      entityType: 'workflow_template',
      entityId: id,
      metadata: {
        status: route.validation.status,
        warnings: route.validation.warnings.length,
        reviewModelSignature,
      },
    });
    return this.designerResponse(updated, route.validation);
  }

  async approveTemplateReview(id: string, dto: WorkflowTemplateReviewDto, user: AuthUser) {
    this.assertWorkflowLifecycleRole(user, 'reviewer', 'Only workflow reviewers can approve workflow route reviews');
    const template = await this.assertTemplateVisible(id, user);
    const route = this.currentDesignerRoute(template);
    const lifecycle = this.workflowLifecycle(template.securityJson);
    const reviewModelSignature = String(lifecycle['reviewModelSignature'] ?? '');
    if (lifecycle['reviewStatus'] !== 'pending' || !reviewModelSignature) {
      throw new BadRequestException('Workflow route must be submitted for review before approval');
    }
    if (reviewModelSignature !== this.workflowReviewSignature(route.bpmnXml)) {
      throw new BadRequestException('Workflow draft changed after review submission; submit it for review again');
    }
    const requestedBy = String(lifecycle['reviewRequestedBy'] ?? '');
    const sodOverride = this.workflowLifecycleSodOverride(user, requestedBy);
    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        securityJson: this.workflowLifecycleMetadata('under_review', user.email, template.securityJson, {
          reviewStatus: 'approved',
          reviewedBy: user.email,
          reviewedAt: new Date().toISOString(),
          reviewDecisionComment: dto.comment ?? null,
          approvedModelSignature: reviewModelSignature,
          sodOverride,
        }) as Prisma.InputJsonValue,
      },
      include: templateInclude,
    });
    await this.audit.log({
      actor: user.email,
      action: 'workflow_template.review.approve',
      entityType: 'workflow_template',
      entityId: id,
      metadata: {
        requestedBy,
        approvedModelSignature: reviewModelSignature,
        sodOverride,
      },
    });
    return this.designerResponse(updated, route.validation);
  }

  async publishTemplateBpmn(id: string, dto: SaveWorkflowBpmnDto, user: AuthUser) {
    this.assertWorkflowLifecycleRole(user, 'publisher', 'Only workflow publishers can publish workflow routes');
    const existing = await this.prisma.workflowTemplate.findFirst({
      where: { id, ...(await this.templateScopeWhere(user.roles)) },
      include: templateInclude,
    });
    if (!existing) throw new NotFoundException('workflow route template not found');
    const parsed = this.parseDesignerBpmn(dto.bpmnXml);
    parsed.validation = await this.validateTemplateVariableReferences(id, parsed.stages, parsed.transitions, parsed.validation);
    if (parsed.validation.status === 'blocked') {
      throw new BadRequestException(`BPMN route is not publishable: ${parsed.validation.errors.join(' ')}`);
    }
    const lifecycle = this.workflowLifecycle(existing.securityJson);
    const approvedModelSignature = String(lifecycle['approvedModelSignature'] ?? '');
    const candidateModelSignature = this.workflowReviewSignature(dto.bpmnXml);
    if (lifecycle['reviewStatus'] !== 'approved' || !approvedModelSignature) {
      throw new BadRequestException('Workflow route must be reviewed and approved before publication');
    }
    if (approvedModelSignature !== candidateModelSignature) {
      throw new BadRequestException('Workflow draft changed after approval; submit it for review again');
    }
    const reviewedBy = String(lifecycle['reviewedBy'] ?? '');
    const sodOverride = this.workflowLifecycleSodOverride(
      user,
      reviewedBy,
      String(lifecycle['reviewRequestedBy'] ?? ''),
      String(lifecycle['lastDesignedBy'] ?? ''),
    );
    const migration = await this.workflowTemplateMigrationPreview(id, dto, user);
    if (migration.summary.manualReviewCases > 0 && !dto.acknowledgeMigrationRisk) {
      throw new BadRequestException(
        `Cannot publish this route yet. ${migration.summary.manualReviewCases} active case(s) have open tasks on stages that would be retired. Resolve or migrate those cases first.`,
      );
    }
    const nextVersion = (existing.designerVersion ?? 1) + 1;
    const variableDefinitions = await this.workflowVariableSnapshot(id);
    const snapshotDesignerJson = { ...this.jsonRecord(parsed.designerJson), variableDefinitions };
    const security = this.secureWorkflowModel(dto.bpmnXml, snapshotDesignerJson, user.email);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.applyPublishedBpmnRoute(tx, id, parsed.stages, parsed.transitions, user.email);
      await tx.workflowTemplate.update({
        where: { id },
        data: {
          bpmnXml: dto.bpmnXml,
          designerJson: snapshotDesignerJson as Prisma.InputJsonValue,
          designerVersion: nextVersion,
          lastPublishedAt: new Date(),
          lastPublishedBy: user.email,
          modelSignature: security.modelSignature,
          signatureAlgorithm: security.signatureAlgorithm,
          isActive: true,
          securityJson: this.workflowLifecycleMetadata('active', user.email, security.securityJson, {
            lastDesignedBy: this.jsonRecord(this.jsonRecord(existing.securityJson)['workflowLifecycle'])['lastDesignedBy'] ?? existing.lastPublishedBy ?? existing.createdBy ?? null,
            publishedBy: user.email,
            version: nextVersion,
            changeSummary: dto.changeSummary ?? null,
            reviewStatus: 'published',
            reviewedBy: lifecycle['reviewedBy'] ?? null,
            reviewedAt: lifecycle['reviewedAt'] ?? null,
            reviewRequestedBy: lifecycle['reviewRequestedBy'] ?? null,
            reviewRequestedAt: lifecycle['reviewRequestedAt'] ?? null,
            approvedModelSignature,
            publishedReviewBy: lifecycle['reviewedBy'] ?? null,
            publishedReviewAt: lifecycle['reviewedAt'] ?? null,
            sodOverride,
          }) as Prisma.InputJsonValue,
          defaultSlaDays: Math.max(
            1,
            parsed.stages.reduce((sum, stage) => sum + Math.max(0, stage.dueDays), 0),
          ),
        },
      });
      await tx.workflowTemplateVersion.create({
        data: {
          templateId: id,
          version: nextVersion,
          source: 'designer',
          changeSummary: dto.changeSummary ?? null,
          bpmnXml: dto.bpmnXml,
          designerJson: snapshotDesignerJson as Prisma.InputJsonValue,
          validationJson: parsed.validation as unknown as Prisma.InputJsonValue,
          modelSignature: security.modelSignature,
          signatureAlgorithm: security.signatureAlgorithm,
          encryptedSnapshotJson: security.encryptedSnapshotJson as Prisma.InputJsonValue,
          securityJson: this.workflowLifecycleMetadata('published', user.email, security.securityJson, {
            publishedBy: user.email,
            version: nextVersion,
            changeSummary: dto.changeSummary ?? null,
            reviewStatus: 'published',
            reviewedBy: lifecycle['reviewedBy'] ?? null,
            reviewedAt: lifecycle['reviewedAt'] ?? null,
            reviewRequestedBy: lifecycle['reviewRequestedBy'] ?? null,
            reviewRequestedAt: lifecycle['reviewRequestedAt'] ?? null,
            approvedModelSignature,
            publishedReviewBy: lifecycle['reviewedBy'] ?? null,
            publishedReviewAt: lifecycle['reviewedAt'] ?? null,
            sodOverride,
          }) as Prisma.InputJsonValue,
          createdBy: user.email,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_template.bpmn.publish',
          entityType: 'workflow_template',
          entityId: id,
          metadata: {
            version: nextVersion,
            stageCount: parsed.validation.stageCount,
            transitionCount: parsed.validation.transitionCount,
            warnings: parsed.validation.warnings,
            migratedCases: 0,
            activeCasesPreservedOnOriginalVersion: migration.summary.activeCases,
            reviewedBy: lifecycle['reviewedBy'] ?? null,
            approvedModelSignature,
            sodOverride,
          },
        },
        tx,
      );
      return tx.workflowTemplate.findUnique({ where: { id }, include: templateInclude });
    });
    if (!updated) throw new BadRequestException('Could not publish workflow route');
    return this.designerResponse(updated, parsed.validation);
  }

  async simulateTemplateDesigner(id: string, dto: WorkflowDesignerSimulationDto, user: AuthUser) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id, ...(await this.templateScopeWhere(user.roles)) },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('workflow route template not found');
    const route = dto.bpmnXml?.trim()
      ? this.parseDesignerBpmn(dto.bpmnXml)
      : this.currentDesignerRoute(template);
    route.validation = await this.validateTemplateVariableReferences(id, route.stages, route.transitions, route.validation);
    const simulation = simulateWorkflowRoute(route.stages, route.transitions, dto.decisions ?? {});
    return route.validation.status === 'blocked'
      ? { ...simulation, status: 'blocked', blockers: [...new Set([...simulation.blockers, ...route.validation.errors])] }
      : simulation;
  }

  async executeDesignerTestRun(id: string, dto: WorkflowDesignerTestRunDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id, ...(await this.templateScopeWhere(user.roles)) },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('workflow route template not found');
    const route = this.designerRouteFromPayload(template, dto.bpmnXml);
    route.validation = await this.validateTemplateVariableReferences(id, route.stages, route.transitions, route.validation);
    const simulated = simulateWorkflowRoute(route.stages, route.transitions, dto.decisions ?? {});
    const simulation = route.validation.status === 'blocked'
      ? {
          ...simulated,
          status: 'blocked' as const,
          blockers: [...new Set([...simulated.blockers, ...route.validation.errors])],
        }
      : simulated;
    const inputJson = {
      environment: dto.environment ?? 'test',
      variables: dto.variables ?? {},
      decisions: dto.decisions ?? {},
      isolation: {
        mode: 'designer_test_space',
        productionCasesCreated: 0,
        productionTasksCreated: 0,
        productionRuntimeTokensCreated: 0,
      },
    };
    let run: Awaited<ReturnType<typeof this.prisma.workflowDesignerTestRun.create>> | null = null;
    for (let attempt = 0; attempt < WORKFLOW_TEST_RUN_CREATE_ATTEMPTS; attempt++) {
      try {
        run = await this.prisma.$transaction(async (tx) => {
          const latest = await tx.workflowDesignerTestRun.aggregate({
            where: { templateId: id },
            _max: { runNumber: true },
          });
          const created = await tx.workflowDesignerTestRun.create({
            data: {
              templateId: id,
              runNumber: (latest._max.runNumber ?? 0) + 1,
              environment: dto.environment ?? 'test',
              status: simulation.status,
              bpmnXml: route.bpmnXml,
              validationJson: route.validation as unknown as Prisma.InputJsonValue,
              inputJson: inputJson as Prisma.InputJsonValue,
              simulationJson: simulation as unknown as Prisma.InputJsonValue,
              executedPathJson: {
                path: simulation.path,
                blockers: simulation.blockers,
                warnings: simulation.warnings,
                summary: simulation.summary,
              } as Prisma.InputJsonValue,
              createdBy: user.email,
            },
          });
          await this.audit.log(
            {
              actor: user.email,
              action: 'workflow_template.test_run.execute',
              entityType: 'workflow_template',
              entityId: id,
              metadata: {
                runId: created.id,
                runNumber: created.runNumber,
                status: created.status,
                environment: created.environment,
                pathLength: simulation.path.length,
                productionCasesCreated: 0,
                productionTasksCreated: 0,
              },
            },
            tx,
          );
          return created;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 3_000,
          timeout: 8_000,
        });
        break;
      } catch (error) {
        const code = typeof error === 'object' && error ? String((error as { code?: unknown }).code ?? '') : '';
        const retryableCollision = code === 'P2002' || code === 'P2034';
        if (!retryableCollision || attempt === WORKFLOW_TEST_RUN_CREATE_ATTEMPTS - 1) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 20 * (attempt + 1) + Math.floor(Math.random() * 20)));
      }
    }
    if (!run) throw new ConflictException('Could not allocate an isolated workflow test run number');
    return this.designerTestRunResponse(run);
  }

  async listDesignerTestRuns(id: string, query: ListWorkflowDesignerTestRunsDto, user: AuthUser) {
    await this.assertTemplateVisible(id, user);
    const page = parsePageParams(query.page ?? 1, query.pageSize ?? WORKFLOW_TEST_RUN_DEFAULT_PAGE_SIZE)!;
    const where: Prisma.WorkflowDesignerTestRunWhereInput = { templateId: id };
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.workflowDesignerTestRun.findMany({
        where,
        orderBy: [{ runNumber: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.workflowDesignerTestRun.count({ where }),
    ]);
    return toPaged(rows.map((row) => this.designerTestRunResponse(row)), total, page);
  }

  async resetDesignerTestRun(templateId: string, runId: string, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    await this.assertTemplateVisible(templateId, user);
    const existing = await this.prisma.workflowDesignerTestRun.findFirst({
      where: { id: runId, templateId },
    });
    if (!existing) throw new NotFoundException('workflow test run not found');
    if (existing.status === 'reset') return this.designerTestRunResponse(existing);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.workflowDesignerTestRun.update({
        where: { id: runId },
        data: {
          status: 'reset',
          resetAt: new Date(),
          resetBy: user.email,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_template.test_run.reset',
          entityType: 'workflow_template',
          entityId: templateId,
          metadata: {
            runId,
            runNumber: existing.runNumber,
            previousStatus: existing.status,
            newStatus: row.status,
          },
        },
        tx,
      );
      return row;
    });
    return this.designerTestRunResponse(updated);
  }

  async workflowTemplateMigrationPreview(id: string, dto: WorkflowDesignerMigrationPreviewDto, user: AuthUser) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id, ...(await this.templateScopeWhere(user.roles)) },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('workflow route template not found');
    const next = dto.bpmnXml?.trim()
      ? this.parseDesignerBpmn(dto.bpmnXml)
      : this.currentDesignerRoute(template);
    const currentStages = new Map(template.stages.map((stage) => [stage.code, stage]));
    const nextStages = new Map(next.stages.map((stage) => [stage.code, stage]));
    const currentTransitionKeys = new Set(
      template.transitions.map((edge) => `${edge.fromStage.code}->${edge.toStage.code}:${edge.decision ?? edge.labelEn}`),
    );
    const nextTransitionKeys = new Set(
      next.transitions.map((edge) => `${edge.fromStageId}->${edge.toStageId}:${edge.decision ?? edge.labelEn}`),
    );
    const addedStages = [...nextStages.keys()].filter((code) => !currentStages.has(code));
    const retiredStages = [...currentStages.keys()].filter((code) => !nextStages.has(code));
    const addedTransitions = [...nextTransitionKeys].filter((key) => !currentTransitionKeys.has(key));
    const retiredTransitions = [...currentTransitionKeys].filter((key) => !nextTransitionKeys.has(key));
    const activeCases = await this.prisma.workflowCase.findMany({
      where: { templateId: id, status: { notIn: [...FINAL_CASE_STATUSES] } },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        tasks: {
          where: { status: { in: [TaskStatus.pending, TaskStatus.in_progress] } },
          select: {
            id: true,
            title: true,
            status: true,
            templateStage: { select: { code: true, nameEn: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const caseActions = activeCases.map((wfCase) => {
      const activeStageCodes = wfCase.tasks
        .map((task) => task.templateStage?.code)
        .filter((code): code is string => Boolean(code));
      const affectedStages = activeStageCodes.filter((code) => !nextStages.has(code));
      return {
        id: wfCase.id,
        code: wfCase.code,
        title: wfCase.title,
        status: wfCase.status,
        openTasks: wfCase.tasks.length,
        activeStageCodes,
        action: affectedStages.length ? 'manual_review' : 'continue',
        reason: affectedStages.length
          ? `Open task is on a retired stage: ${affectedStages.join(', ')}`
          : 'Open tasks remain on stages that exist in the new route.',
      };
    });
    const manualReviewCases = caseActions.filter((row) => row.action === 'manual_review').length;
    const risk = next.validation.status === 'blocked'
      ? 'blocked'
      : manualReviewCases > 0 || retiredStages.length > 0 || retiredTransitions.length > 0
        ? 'caution'
        : 'safe';
    return {
      risk,
      validation: next.validation,
      summary: {
        activeCases: activeCases.length,
        manualReviewCases,
        addedStages: addedStages.length,
        retiredStages: retiredStages.length,
        addedTransitions: addedTransitions.length,
        retiredTransitions: retiredTransitions.length,
      },
      stageChanges: { added: addedStages, retired: retiredStages },
      transitionChanges: { added: addedTransitions, retired: retiredTransitions },
      caseActions,
    };
  }

  async listTemplateVersions(id: string, user: AuthUser) {
    await this.assertTemplateVisible(id, user);
    const versions = await this.prisma.workflowTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        source: true,
        changeSummary: true,
        bpmnXml: true,
        designerJson: true,
        modelSignature: true,
        signatureAlgorithm: true,
        securityJson: true,
        createdBy: true,
        createdAt: true,
      },
    });
    return {
      templateId: id,
      versions: versions.map((version) => ({
        id: version.id,
        version: version.version,
        source: version.source,
        changeSummary: version.changeSummary,
        modelSignature: version.modelSignature,
        signatureAlgorithm: version.signatureAlgorithm,
        securityJson: version.securityJson,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
        signatureVerified: this.verifyWorkflowSnapshotSignature(version.bpmnXml, version.designerJson, version.modelSignature),
      })),
    };
  }

  async templateVersionDiff(id: string, versionNumber: number, user: AuthUser) {
    const template = await this.assertTemplateVisible(id, user);
    const version = await this.prisma.workflowTemplateVersion.findFirst({
      where: { templateId: id, version: versionNumber },
    });
    if (!version) throw new NotFoundException('workflow route version not found');
    const target = this.parseDesignerBpmn(version.bpmnXml);
    return {
      templateId: id,
      fromVersion: template.designerVersion ?? 1,
      toVersion: version.version,
      diff: buildWorkflowVersionDiff(
        this.currentBpmnComparableRoute(template),
        { stages: target.stages, transitions: target.transitions },
      ),
      security: {
        modelSignature: version.modelSignature,
        signatureAlgorithm: version.signatureAlgorithm,
        signedAt: version.createdAt,
      },
    };
  }

  async rollbackTemplateVersion(id: string, dto: WorkflowTemplateRollbackDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    await this.assertTemplateVisible(id, user);
    const version = await this.prisma.workflowTemplateVersion.findFirst({
      where: { templateId: id, version: dto.version },
    });
    if (!version) throw new NotFoundException('workflow route version not found');
    const parsed = this.parseDesignerBpmn(version.bpmnXml);
    if (parsed.validation.status === 'blocked') {
      throw new BadRequestException(`Rollback version is not publishable: ${parsed.validation.errors.join(' ')}`);
    }
    const existing = await this.prisma.workflowTemplate.findUnique({ where: { id }, include: templateInclude });
    if (!existing) throw new NotFoundException('workflow route template not found');
    const nextVersion = (existing.designerVersion ?? 1) + 1;
    const versionDesignerJson = this.jsonRecord(version.designerJson);
    const snapshotVariables = Array.isArray(versionDesignerJson['variableDefinitions'])
      ? versionDesignerJson['variableDefinitions'] as Array<Record<string, unknown>>
      : null;
    const rollbackDesignerJson = { ...this.jsonRecord(parsed.designerJson), ...(snapshotVariables ? { variableDefinitions: snapshotVariables } : {}) };
    const security = this.secureWorkflowModel(version.bpmnXml, rollbackDesignerJson, user.email);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.applyPublishedBpmnRoute(tx, id, parsed.stages, parsed.transitions, user.email);
      if (snapshotVariables) await this.restoreWorkflowVariableSnapshot(tx, id, snapshotVariables, user.email);
      await tx.workflowTemplate.update({
        where: { id },
        data: {
          bpmnXml: version.bpmnXml,
          designerJson: rollbackDesignerJson as Prisma.InputJsonValue,
          designerVersion: nextVersion,
          lastPublishedAt: new Date(),
          lastPublishedBy: user.email,
          modelSignature: security.modelSignature,
          signatureAlgorithm: security.signatureAlgorithm,
          securityJson: security.securityJson as Prisma.InputJsonValue,
        },
      });
      await tx.workflowTemplateVersion.create({
        data: {
          templateId: id,
          version: nextVersion,
          source: 'rollback',
          changeSummary: dto.changeSummary ?? `Rollback to version ${dto.version}`,
          bpmnXml: version.bpmnXml,
          designerJson: rollbackDesignerJson as Prisma.InputJsonValue,
          validationJson: parsed.validation as unknown as Prisma.InputJsonValue,
          modelSignature: security.modelSignature,
          signatureAlgorithm: security.signatureAlgorithm,
          encryptedSnapshotJson: security.encryptedSnapshotJson as Prisma.InputJsonValue,
          securityJson: security.securityJson as Prisma.InputJsonValue,
          createdBy: user.email,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_template.version.rollback',
          entityType: 'workflow_template',
          entityId: id,
          metadata: { rollbackTo: dto.version, newVersion: nextVersion, migratedCases: 0, migrationMode: 'explicit_only' },
        },
        tx,
      );
      return tx.workflowTemplate.findUnique({ where: { id }, include: templateInclude });
    });
    if (!updated) throw new BadRequestException('Could not rollback workflow route');
    return this.designerResponse(updated, parsed.validation);
  }

  async migrateTemplateActiveCases(id: string, dto: WorkflowTemplateMigrationExecuteDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    await this.assertTemplateVisible(id, user);
    const result = await this.prisma.$transaction((tx) =>
      this.migrateActiveCasesForTemplate(tx, id, user.email, {
        fallbackStageCode: dto.fallbackStageCode ?? null,
        dryRun: Boolean(dto.dryRun),
      }),
    );
    await this.audit.log({
      actor: user.email,
      action: dto.dryRun ? 'workflow_template.case_migration.preview' : 'workflow_template.case_migration.execute',
      entityType: 'workflow_template',
      entityId: id,
      metadata: result,
    });
    return result;
  }

  async processRuntimeExecutions(user: AuthUser) {
    if (!user.roles.some((role) => ADMIN_ROLES.includes(role))) {
      throw new ForbiddenException('Only workflow administrators can trigger the execution worker');
    }
    const result = await this.processRunnableExecutions();
    await this.audit.log({
      actor: user.email,
      action: 'workflow_execution.worker.triggered',
      entityType: 'workflow_engine',
      metadata: result,
    });
    return result;
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
    const [templates, casesResult, variableRegistry] = await Promise.all([
      this.listTemplates(roleCodes),
      this.listCases(roleCodes, { page: 1, pageSize: 500 }, viewer),
      this.workflowVariableRegistry(),
    ]);
    const visibleTemplateIds = templates.map((template) => template.id);
    const [testRunCount, automatedExecutionCount] = visibleTemplateIds.length
      ? await Promise.all([
          this.prisma.workflowDesignerTestRun.count({
            where: { templateId: { in: visibleTemplateIds }, status: { not: 'reset' } },
          }),
          this.prisma.workflowExecutionAttempt.count({
            where: {
              status: 'succeeded',
              templateStage: { templateId: { in: visibleTemplateIds } },
            },
          }),
        ])
      : [0, 0];
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
    const workflowCanvasMvp = buildWorkflowMvpReadinessGate(templates, {
      testRunCount,
      automatedExecutionCount,
      operationalReportReady: true,
      timerNotificationConfigured: slaTemplates.length > 0 && notificationRules.length > 0,
    });
    const blockedRoutes = caseTypeRegistry.filter((row) => row.status === 'blocked').length;
    const watchRoutes = caseTypeRegistry.filter((row) => row.status === 'watch').length;
    const status =
      workflowCanvasMvp.status === 'blocked' || blockedRoutes > 0
        ? 'blocked'
        : overdueTasks > 0 || unassignedTasks > 0 || watchRoutes > 0 || workflowCanvasMvp.status === 'watch'
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
        designerTestRuns: testRunCount,
        automatedExecutionEvents: automatedExecutionCount,
        workflowMvpReady: workflowCanvasMvp.status === 'ready',
        workflowMvpBlocked: workflowCanvasMvp.summary.blocked,
      },
      caseTypeRegistry,
      workflowCanvasMvp,
      nodePalette: workflowNodePalette(),
      connectorTypes: WORKFLOW_CONNECTOR_TYPES,
      variableRegistry: variableRegistry.variables,
      variableTypes: variableRegistry.variableTypes,
      auditEventCatalog: WORKFLOW_AUDIT_EVENT_CATALOG,
      acceptanceCriteria: WORKFLOW_ACCEPTANCE_CRITERIA.map(([code, label, trace, priority]) => ({ code, label, trace, priority })),
      designerLifecycle: WORKFLOW_DESIGNER_LIFECYCLE,
      productionPilotGuardrails: PRODUCTION_PILOT_GUARDRAILS,
      testIsolation: {
        status: testRunCount > 0 ? 'ready' : 'watch',
        testRuns: testRunCount,
        productionTablesTouched: false,
        evidence: 'Designer test runs persist in workflow_designer_test_runs and do not create workflow_cases, workflow_tasks, or workflow_runtime_tokens.',
      },
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

  async dashboard(roleCodes: string[], viewer?: AuthUser) {
    const visibilityWhere = await this.workflowCaseVisibilityWhere(roleCodes, viewer);
    const since = new Date();
    since.setDate(since.getDate() - 13);
    since.setHours(0, 0, 0, 0);
    const cases = await this.prisma.workflowCase.findMany({
      where: visibilityWhere,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        type: true,
        createdAt: true,
        updatedAt: true,
        template: { select: { code: true, nameEn: true, nameAr: true } },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            completedAt: true,
            assigneeRoleCode: true,
            assignee: { select: { displayName: true, email: true } },
            templateStage: { select: { code: true, nameEn: true, nameAr: true, sortOrder: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 750,
    });
    const activeStatuses = new Set<CaseStatus>([
      CaseStatus.draft,
      CaseStatus.submitted,
      CaseStatus.under_review,
      CaseStatus.awaiting_information,
      CaseStatus.decision_made,
      CaseStatus.approved,
    ]);
    const openTasks = cases.flatMap((wfCase) =>
      wfCase.tasks
        .filter((task) => task.status === TaskStatus.pending || task.status === TaskStatus.in_progress)
        .map((task) => ({ ...task, wfCase })),
    );
    const overdueTasks = openTasks.filter((task) => task.dueDate && task.dueDate.getTime() < Date.now());
    const completedCases = cases.filter((wfCase) => FINAL_CASE_STATUSES.includes(wfCase.status));
    const avgCompletionHours = completedCases.length
      ? Math.round(
          completedCases.reduce((sum, wfCase) => sum + Math.max(0, wfCase.updatedAt.getTime() - wfCase.createdAt.getTime()), 0) /
            completedCases.length /
            36_000,
        ) / 10
      : 0;
    const stageBuckets = new Map<string, { stage: string; route: string; open: number; overdue: number; totalOverdueHours: number }>();
    for (const task of openTasks) {
      const key = `${task.wfCase.template?.code ?? task.wfCase.type}:${task.templateStage?.code ?? task.assigneeRoleCode ?? 'unmapped'}`;
      const bucket = stageBuckets.get(key) ?? {
        stage: task.templateStage?.nameEn ?? task.title,
        route: task.wfCase.template?.nameEn ?? task.wfCase.type,
        open: 0,
        overdue: 0,
        totalOverdueHours: 0,
      };
      bucket.open++;
      if (task.dueDate && task.dueDate.getTime() < Date.now()) {
        bucket.overdue++;
        bucket.totalOverdueHours += Math.max(0, Date.now() - task.dueDate.getTime()) / 3_600_000;
      }
      stageBuckets.set(key, bucket);
    }
    const workloadBuckets = new Map<string, { assignee: string; roleCode: string | null; open: number; overdue: number }>();
    for (const task of openTasks) {
      const assignee = task.assignee?.displayName ?? task.assignee?.email ?? task.assigneeRoleCode ?? 'Unassigned queue';
      const bucket = workloadBuckets.get(assignee) ?? { assignee, roleCode: task.assigneeRoleCode ?? null, open: 0, overdue: 0 };
      bucket.open++;
      if (task.dueDate && task.dueDate.getTime() < Date.now()) bucket.overdue++;
      workloadBuckets.set(assignee, bucket);
    }
    const trend = Array.from({ length: 14 }, (_, index) => {
      const day = new Date(since);
      day.setDate(since.getDate() + index);
      const date = day.toISOString().slice(0, 10);
      return {
        date,
        created: cases.filter((wfCase) => wfCase.createdAt.toISOString().slice(0, 10) === date).length,
        completed: cases.filter((wfCase) => FINAL_CASE_STATUSES.includes(wfCase.status) && wfCase.updatedAt.toISOString().slice(0, 10) === date).length,
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      refreshSeconds: 60,
      summary: {
        activeCases: cases.filter((wfCase) => activeStatuses.has(wfCase.status)).length,
        openTasks: openTasks.length,
        overdueTasks: overdueTasks.length,
        routesSampled: new Set(cases.map((wfCase) => wfCase.template?.code ?? wfCase.type)).size,
        avgCompletionHours,
        slaComplianceRate: openTasks.length ? Math.round(((openTasks.length - overdueTasks.length) / openTasks.length) * 100) : 100,
      },
      bottlenecks: [...stageBuckets.values()]
        .map((bucket) => ({ ...bucket, avgOverdueHours: bucket.overdue ? Math.round(bucket.totalOverdueHours / bucket.overdue) : 0 }))
        .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
        .slice(0, 6),
      workload: [...workloadBuckets.values()]
        .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
        .slice(0, 8),
      trend,
    };
  }

  async workflowOperationsReport(
    roleCodes: string[],
    query: WorkflowOperationsReportQueryDto,
    viewer?: AuthUser,
  ) {
    const now = new Date();
    const periodDays = Math.max(1, Math.min(366, Math.floor(Number(query.periodDays ?? 30)) || 30));
    const periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - periodDays + 1);
    periodStart.setHours(0, 0, 0, 0);
    const filters: Prisma.WorkflowCaseWhereInput[] = [
      await this.workflowCaseVisibilityWhere(roleCodes, viewer),
      { createdAt: { gte: periodStart } },
    ];
    if (query.templateId) filters.push({ templateId: query.templateId });
    if (query.caseType) filters.push({ type: this.assertKnownCaseType(query.caseType) });
    if (query.status) filters.push({ status: this.assertKnownCaseStatus(String(query.status)) });
    if (query.ownerEmail?.trim()) filters.push({ createdBy: query.ownerEmail.trim() });
    if (query.orgUnitId) filters.push({ asset: { orgUnitId: query.orgUnitId } });

    const where: Prisma.WorkflowCaseWhereInput = { AND: filters };
    const rows = await this.prisma.workflowCase.findMany({
      where,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        type: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        templateId: true,
        template: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        asset: { select: { orgUnitId: true, orgUnit: { select: { id: true, code: true, nameEn: true, nameAr: true } } } },
        tasks: {
          select: {
            id: true,
            status: true,
            type: true,
            dueDate: true,
            createdAt: true,
            completedAt: true,
            templateStage: { select: { code: true, nameEn: true, nameAr: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: WORKFLOW_REPORT_CASE_LIMIT + 1,
    });
    const truncated = rows.length > WORKFLOW_REPORT_CASE_LIMIT;
    const cases = truncated ? rows.slice(0, WORKFLOW_REPORT_CASE_LIMIT) : rows;
    const activeStatuses = new Set<CaseStatus>([
      CaseStatus.draft,
      CaseStatus.submitted,
      CaseStatus.under_review,
      CaseStatus.awaiting_information,
      CaseStatus.decision_made,
      CaseStatus.approved,
    ]);
    const completedCases = cases.filter((wfCase) => FINAL_CASE_STATUSES.includes(wfCase.status));
    const failedCases = cases.filter(
      (wfCase) =>
        wfCase.status === CaseStatus.rejected ||
        wfCase.status === CASE_STATUS_FAILED ||
        wfCase.status === CASE_STATUS_CANCELLED,
    );
    const tasks = cases.flatMap((wfCase) => wfCase.tasks.map((task) => ({ ...task, wfCase })));
    const completedTasks = tasks.filter((task) => task.completedAt);
    const openTasks = tasks.filter((task) => task.status === TaskStatus.pending || task.status === TaskStatus.in_progress);
    const overdueTasks = openTasks.filter((task) => task.dueDate && task.dueDate.getTime() < now.getTime());
    const workflowCompletionHours = this.averageHours(
      completedCases.map((wfCase) => ({ start: wfCase.createdAt, end: wfCase.updatedAt })),
    );
    const taskCompletionHours = this.averageHours(
      completedTasks.flatMap((task) => task.completedAt ? [{ start: task.createdAt, end: task.completedAt }] : []),
    );
    const volumeByStatus = this.countBy(cases, (wfCase) => wfCase.status);
    const volumeByType = this.countBy(cases, (wfCase) => wfCase.type);
    const volumeByWorkflow = this.countBy(cases, (wfCase) => wfCase.template?.nameEn ?? wfCase.type);
    const volumeByOrgUnit = this.countBy(
      cases,
      (wfCase) => wfCase.asset?.orgUnit?.nameEn ?? (wfCase.asset?.orgUnitId ? 'Unmapped org unit' : 'No linked org unit'),
    );
    const stagePerformance = [...this.countTasksByStage(tasks).values()]
      .map(({ completedSpans, ...row }) => ({
        ...row,
        averageCompletionHours: this.averageHours(completedSpans),
        slaCompliancePercentage: row.open ? Math.round(((row.open - row.overdue) / row.open) * 100) : 100,
      }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
      .slice(0, 12);

    return {
      generatedAt: now.toISOString(),
      period: {
        days: periodDays,
        start: periodStart.toISOString(),
        end: now.toISOString(),
      },
      filters: {
        templateId: query.templateId ?? null,
        caseType: query.caseType ?? null,
        status: query.status ?? null,
        ownerEmail: query.ownerEmail ?? null,
        orgUnitId: query.orgUnitId ?? null,
      },
      sample: {
        limit: WORKFLOW_REPORT_CASE_LIMIT,
        returnedCases: cases.length,
        truncated,
      },
      summary: {
        initiatedWorkflows: cases.length,
        completedWorkflows: completedCases.length,
        activeWorkflows: cases.filter((wfCase) => activeStatuses.has(wfCase.status)).length,
        failedWorkflows: failedCases.length,
        openTasks: openTasks.length,
        overdueTasks: overdueTasks.length,
        averageWorkflowCompletionHours: workflowCompletionHours,
        averageTaskCompletionHours: taskCompletionHours,
        slaCompliancePercentage: openTasks.length ? Math.round(((openTasks.length - overdueTasks.length) / openTasks.length) * 100) : 100,
      },
      volumeByStatus,
      volumeByType,
      volumeByWorkflow,
      volumeByOrgUnit,
      stagePerformance,
      acceptanceEvidence: {
        criterion: 'AC-WF-17',
        trace: 'Volume 2 section 23.11',
        filtersSupported: ['workflow', 'period', 'owner', 'department', 'status', 'caseType'],
        scoped: true,
      },
    };
  }

  async listCaseComments(caseId: string, user: AuthUser) {
    const wfCase = await this.prisma.workflowCase.findUnique({
      where: { id: caseId },
      select: { id: true, assetId: true },
    });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(user.roles, wfCase, user);
    return this.prisma.workflowTaskComment.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addCaseComment(caseId: string, dto: AddWorkflowCommentDto, user: AuthUser) {
    const wfCase = await this.prisma.workflowCase.findUnique({
      where: { id: caseId },
      select: { id: true, assetId: true, status: true },
    });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(user.roles, wfCase, user);
    this.assertCaseCanChange(wfCase.status);
    if (dto.taskId) await this.assertTaskBelongsToCase(dto.taskId, caseId);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Comment cannot be empty');
    const visibility = (dto.visibility ?? 'internal').trim().toLowerCase();
    if (!['internal', 'audit', 'external'].includes(visibility)) {
      throw new BadRequestException('Comment visibility must be internal, audit, or external');
    }
    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workflowTaskComment.create({
        data: { caseId, taskId: dto.taskId ?? null, body, visibility, createdBy: user.email },
      });
      await tx.workflowEvent.create({
        data: {
          caseId,
          taskId: dto.taskId ?? null,
          actor: user.email,
          action: 'comment.added',
          comment: visibility,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_comment.create',
          entityType: 'workflow_case',
          entityId: caseId,
          metadata: { taskId: dto.taskId ?? null, visibility },
        },
        tx,
      );
      return created;
    });
    return comment;
  }

  async listCaseAttachments(caseId: string, user: AuthUser) {
    const wfCase = await this.prisma.workflowCase.findUnique({
      where: { id: caseId },
      select: { id: true, assetId: true },
    });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(user.roles, wfCase, user);
    const rows = await this.prisma.workflowTaskAttachment.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ storedName: _storedName, ...attachment }) => attachment);
  }

  private attachmentStoragePath(storedName: string): string {
    const target = resolve(this.attachmentStorageDir, storedName);
    const rel = relative(this.attachmentStorageDir, target);
    if (!storedName || rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new NotFoundException('workflow attachment file not found');
    }
    return target;
  }

  private assertWorkflowAttachmentContent(file: WorkflowAttachmentFile): void {
    if (!file?.buffer?.length) throw new BadRequestException('An attachment file is required');
    const startsWith = (signature: Buffer | string) =>
      typeof signature === 'string'
        ? file.buffer.subarray(0, signature.length).toString('utf8') === signature
        : file.buffer.subarray(0, signature.length).equals(signature);
    const textLike = () => !file.buffer.includes(0);
    const officePackage = (requiredPart: string) =>
      startsWith('PK') &&
      file.buffer.includes(Buffer.from('[Content_Types].xml', 'utf8')) &&
      file.buffer.includes(Buffer.from(requiredPart, 'utf8'));
    const valid =
      (file.mimetype === 'application/pdf' && startsWith('%PDF-')) ||
      (file.mimetype === 'image/png' && startsWith(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
      (file.mimetype === 'image/jpeg' && startsWith(Buffer.from([0xff, 0xd8, 0xff]))) ||
      ((file.mimetype === 'text/plain' || file.mimetype === 'text/csv') && textLike()) ||
      (file.mimetype === 'application/msword' && startsWith(WORKFLOW_ATTACHMENT_OLE_MAGIC)) ||
      (file.mimetype === 'application/vnd.ms-excel' && startsWith(WORKFLOW_ATTACHMENT_OLE_MAGIC)) ||
      (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
        officePackage('word/document.xml')) ||
      (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
        officePackage('xl/workbook.xml'));
    if (!valid) throw new BadRequestException('File content does not match the declared file type');
  }

  async addCaseAttachment(
    caseId: string,
    dto: UploadWorkflowAttachmentDto,
    file: WorkflowAttachmentFile,
    user: AuthUser,
  ) {
    const wfCase = await this.prisma.workflowCase.findUnique({
      where: { id: caseId },
      select: { id: true, assetId: true, status: true },
    });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(user.roles, wfCase, user);
    this.assertCaseCanChange(wfCase.status);
    if (dto.taskId) await this.assertTaskBelongsToCase(dto.taskId, caseId);
    this.assertWorkflowAttachmentContent(file);
    const attachmentId = randomUUID();
    const safeExtension = (file.originalname.match(/\.[A-Za-z0-9]{1,8}$/u)?.[0] ?? '').toLowerCase();
    const storedName = `${randomUUID()}${safeExtension}`;
    const storedPath = this.attachmentStoragePath(storedName);
    const fileName = sanitizeAttachmentFilename(file.originalname, 'workflow-attachment');
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await writeFile(storedPath, file.buffer);
    try {
      const attachment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.workflowTaskAttachment.create({
          data: {
            id: attachmentId,
            caseId,
            taskId: dto.taskId ?? null,
            fileName,
            storedName,
            storageUrl: `/api/workflow/attachments/${attachmentId}/file`,
            mimeType: file.mimetype,
            checksum,
            sizeBytes: file.buffer.length,
            kind: dto.kind ?? WorkflowAttachmentKind.evidence,
            createdBy: user.email,
          },
        });
        await tx.workflowEvent.create({
          data: {
            caseId,
            taskId: dto.taskId ?? null,
            actor: user.email,
            action: 'attachment.added',
            comment: fileName,
          },
        });
        await this.audit.log(
          {
            actor: user.email,
            action: 'workflow_attachment.create',
            entityType: 'workflow_attachment',
            entityId: created.id,
            metadata: { caseId, taskId: dto.taskId ?? null, kind: created.kind, checksum, sizeBytes: file.buffer.length },
          },
          tx,
        );
        return created;
      });
      const { storedName: _storedName, ...publicAttachment } = attachment;
      return publicAttachment;
    } catch (error) {
      await unlink(storedPath).catch(() => undefined);
      throw error;
    }
  }

  async attachmentFile(id: string, user: AuthUser) {
    const attachment = await this.prisma.workflowTaskAttachment.findUnique({
      where: { id },
      include: { case: { select: { id: true, assetId: true } } },
    });
    if (!attachment) throw new NotFoundException('workflow attachment not found');
    await this.assertCaseVisible(user.roles, attachment.case, user);
    if (!attachment.storedName) throw new NotFoundException('A managed file is not available for this legacy attachment');
    const path = this.attachmentStoragePath(attachment.storedName);
    if (!existsSync(path)) throw new NotFoundException('workflow attachment file not found');
    await this.audit.log({
      actor: user.email,
      action: 'workflow_attachment.download',
      entityType: 'workflow_attachment',
      entityId: attachment.id,
      metadata: { caseId: attachment.caseId, checksum: attachment.checksum },
    });
    return {
      path,
      originalName: attachment.fileName,
      mimeType: attachment.mimeType ?? 'application/octet-stream',
    };
  }

  async listDelegations(user: AuthUser) {
    const isAdmin = user.roles.some((role) => ADMIN_ROLES.includes(role));
    return this.prisma.workflowDelegation.findMany({
      where: isAdmin
        ? {}
        : { OR: [{ delegatorUserId: user.id }, { delegateUserId: user.id }, { roleCode: { in: user.roles } }] },
      orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }],
      take: isAdmin ? 500 : 100,
    });
  }

  async createDelegation(dto: CreateWorkflowDelegationDto, user: AuthUser) {
    const isAdmin = user.roles.some((role) => ADMIN_ROLES.includes(role));
    if (!isAdmin && dto.delegatorUserId !== user.id) {
      throw new ForbiddenException('You can only delegate your own workflow responsibilities');
    }
    if (dto.delegatorUserId === dto.delegateUserId) {
      throw new BadRequestException('Delegate must be different from the delegating user');
    }
    const startsAt = new Date(dto.startsAt);
    const expiresAt = new Date(dto.expiresAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
      throw new BadRequestException('Delegation dates are invalid');
    }
    if (expiresAt <= startsAt) throw new BadRequestException('Delegation expiry must be after the start date');
    await this.assertUser(dto.delegatorUserId);
    await this.assertUser(dto.delegateUserId);
    await this.assertRoleExists(dto.roleCode);
    if (dto.assetId) await this.assertAssetVisible(user.roles, dto.assetId);
    if (!isAdmin) {
      const assigned = await this.prisma.userRole.findFirst({
        where: {
          userId: dto.delegatorUserId,
          role: { code: dto.roleCode, isActive: true, deletedAt: null },
        },
        select: { userId: true },
      });
      if (!assigned) throw new ForbiddenException('You can only delegate roles assigned to you');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workflowDelegation.create({
        data: {
          delegatorUserId: dto.delegatorUserId,
          delegateUserId: dto.delegateUserId,
          roleCode: dto.roleCode,
          assetId: dto.assetId ?? null,
          reason: dto.reason.trim(),
          startsAt,
          expiresAt,
          status: WorkflowDelegationStatus.active,
          approvedBy: isAdmin ? user.email : null,
          createdBy: user.email,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_delegation.create',
          entityType: 'workflow_delegation',
          entityId: created.id,
          metadata: { roleCode: dto.roleCode, assetId: dto.assetId ?? null, expiresAt: expiresAt.toISOString() },
        },
        tx,
      );
      return created;
    });
    return row;
  }

  async updateDelegationStatus(id: string, dto: UpdateWorkflowDelegationDto, user: AuthUser) {
    const existing = await this.prisma.workflowDelegation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('workflow delegation not found');
    const isAdmin = user.roles.some((role) => ADMIN_ROLES.includes(role));
    if (!isAdmin && existing.delegatorUserId !== user.id) {
      throw new ForbiddenException('Only the delegator or workflow administrator can update this delegation');
    }
    if (
      !isAdmin &&
      dto.status !== WorkflowDelegationStatus.paused &&
      dto.status !== WorkflowDelegationStatus.revoked
    ) {
      throw new ForbiddenException('Only workflow administrators can activate or expire delegations');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.workflowDelegation.update({
        where: { id },
        data: { status: dto.status, approvedBy: dto.status === WorkflowDelegationStatus.active ? user.email : existing.approvedBy },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_delegation.update',
          entityType: 'workflow_delegation',
          entityId: id,
          metadata: { from: existing.status, to: dto.status },
        },
        tx,
      );
      return row;
    });
    return updated;
  }

  async listPersistentSlaTemplates(_roleCodes: string[]) {
    return this.prisma.workflowSlaTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ caseType: 'asc' }, { stageKind: 'asc' }, { code: 'asc' }],
    });
  }

  async upsertSlaTemplate(dto: UpsertWorkflowSlaTemplateDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    if ((dto.warningAtPercent ?? 50) >= (dto.escalationAtPercent ?? 80)) {
      throw new BadRequestException('SLA warning threshold must be lower than escalation threshold');
    }
    if (dto.targetRoleCode) await this.assertRoleExists(dto.targetRoleCode);
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.workflowSlaTemplate.upsert({
        where: { code: dto.code },
        create: {
          code: dto.code,
          caseType: dto.caseType,
          stageKind: dto.stageKind ?? null,
          targetBusinessDays: dto.targetBusinessDays,
          warningAtPercent: dto.warningAtPercent ?? 50,
          escalationAtPercent: dto.escalationAtPercent ?? 80,
          breachPolicy: dto.breachPolicy ?? WorkflowSlaBreachPolicy.escalate,
          targetRoleCode: dto.targetRoleCode ?? null,
          calendarCode: dto.calendarCode ?? 'ksa_business',
          isActive: dto.isActive ?? true,
          createdBy: user.email,
        },
        update: {
          caseType: dto.caseType,
          stageKind: dto.stageKind ?? null,
          targetBusinessDays: dto.targetBusinessDays,
          warningAtPercent: dto.warningAtPercent ?? 50,
          escalationAtPercent: dto.escalationAtPercent ?? 80,
          breachPolicy: dto.breachPolicy ?? WorkflowSlaBreachPolicy.escalate,
          targetRoleCode: dto.targetRoleCode ?? null,
          calendarCode: dto.calendarCode ?? 'ksa_business',
          isActive: dto.isActive ?? true,
          updatedBy: user.email,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_sla_template.upsert',
          entityType: 'workflow_sla_template',
          entityId: saved.id,
          metadata: { code: saved.code, caseType: saved.caseType, stageKind: saved.stageKind },
        },
        tx,
      );
      return saved;
    });
    return row;
  }

  private assertWorkflowDesignerAdmin(user: AuthUser): void {
    if (!this.hasWorkflowLifecycleRole(user, 'designer')) {
      throw new ForbiddenException('Only workflow administrators can design workflow routes');
    }
  }

  private assertWorkflowLifecycleRole(
    user: AuthUser,
    role: keyof typeof WORKFLOW_DESIGNER_LIFECYCLE.roles,
    message: string,
  ): void {
    if (!this.hasWorkflowLifecycleRole(user, role)) {
      throw new ForbiddenException(message);
    }
  }

  private hasWorkflowLifecycleRole(user: AuthUser, role: keyof typeof WORKFLOW_DESIGNER_LIFECYCLE.roles): boolean {
    const allowed = WORKFLOW_DESIGNER_LIFECYCLE.roles[role];
    return user.roles.some((code) => allowed.includes(code));
  }

  private workflowLifecycleSodOverride(user: AuthUser, ...previousActors: Array<string | null | undefined>): boolean {
    if (previousActors.some((actor) => !!actor && actor === user.email)) {
      throw new ForbiddenException('Segregation of duties requires a different workflow actor for this action');
    }
    return false;
  }

  private parseDesignerBpmn(xml: string): ReturnType<typeof parseBpmnXml> {
    try {
      return parseBpmnXml(xml);
    } catch (error) {
      throw new BadRequestException((error as Error).message || 'Invalid BPMN XML');
    }
  }

  private designerRouteFromPayload(template: WorkflowTemplateWithRoute, bpmnXml?: string | null) {
    if (bpmnXml?.trim()) {
      const parsed = this.parseDesignerBpmn(bpmnXml);
      return { ...parsed, bpmnXml };
    }
    return this.currentDesignerRoute(template);
  }

  private currentDesignerRoute(template: WorkflowTemplateWithRoute) {
    const current = this.toBpmnTemplate(template);
    const codeByRef = new Map(current.stages.map((stage) => [stage.id ?? stage.code, stage.code]));
    return {
      stages: current.stages,
      transitions: current.transitions.map((transition) => ({
        ...transition,
        fromStageId: codeByRef.get(transition.fromStageId) ?? transition.fromStageId,
        toStageId: codeByRef.get(transition.toStageId) ?? transition.toStageId,
      })),
      validation: this.currentRouteValidation(template),
      designerJson: this.jsonRecord(template.designerJson),
      bpmnXml: this.designerBpmnXmlForTemplate(template),
    };
  }

  private designerTestRunResponse(run: {
    id: string;
    templateId: string;
    runNumber: number;
    environment: string;
    status: string;
    validationJson: unknown;
    inputJson: unknown;
    simulationJson: unknown;
    executedPathJson: unknown;
    resetAt?: Date | null;
    resetBy?: string | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const input = this.jsonRecord(run.inputJson);
    const isolation = this.jsonRecord(input['isolation']);
    return {
      id: run.id,
      templateId: run.templateId,
      runNumber: run.runNumber,
      environment: run.environment,
      status: run.status,
      validation: run.validationJson,
      input: input,
      simulation: run.simulationJson,
      executedPath: run.executedPathJson,
      isolation: {
        mode: String(isolation['mode'] ?? 'designer_test_space'),
        productionCasesCreated: Number(isolation['productionCasesCreated'] ?? 0),
        productionTasksCreated: Number(isolation['productionTasksCreated'] ?? 0),
        productionRuntimeTokensCreated: Number(isolation['productionRuntimeTokensCreated'] ?? 0),
      },
      resetAt: run.resetAt ?? null,
      resetBy: run.resetBy ?? null,
      createdBy: run.createdBy,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  private async assertTemplateVisible(id: string, user: AuthUser): Promise<WorkflowTemplateWithRoute> {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id, ...(await this.templateScopeWhere(user.roles)) },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('workflow route template not found');
    return template;
  }

  private secureWorkflowModel(bpmnXml: string, designerJson: unknown, actor: string) {
    const canonical = this.canonicalWorkflowSnapshot(bpmnXml, designerJson);
    const secret = this.workflowSigningSecret();
    const modelSignature = createHmac('sha256', secret).update(canonical).digest('hex');
    const encryptedSnapshotJson = this.encryptWorkflowSnapshot(canonical, secret);
    return {
      modelSignature,
      signatureAlgorithm: 'HMAC-SHA256',
      encryptedSnapshotJson,
      securityJson: {
        signedBy: actor,
        signedAt: new Date().toISOString(),
        keyRef: process.env.DGOP_BPMN_SIGNING_KEY_REF || 'DGOP_BPMN_SIGNING_SECRET',
        encryptedSnapshot: true,
        bpmnLayoutVersion: WORKFLOW_BPMN_LAYOUT_VERSION,
        controls: ['signed_model', 'encrypted_snapshot', 'publish_audit', 'version_immutability'],
      },
    };
  }

  async workflowVariableRegistry() {
    const rows = await this.prisma.workflowVariableDefinition.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ templateId: 'asc' }, { scope: 'asc' }, { code: 'asc' }],
    });
    const persistedCodes = new Set(rows.map((row) => row.code));
    const defaults = WORKFLOW_DEFAULT_VARIABLES
      .filter((row) => !persistedCodes.has(row.code))
      .map((row) => ({
        id: `default:${row.code}`,
        registryKey: `default:${row.code}`,
        templateId: null,
        code: row.code,
        nameEn: row.nameEn,
        nameAr: null,
        description: null,
        variableType: row.variableType,
        scope: row.scope,
        source: row.source,
        defaultValueJson: null,
        allowedValuesJson: null,
        isRequired: row.required,
        isActive: true,
        deletedAt: null,
        createdBy: 'system',
      }));
    return {
      variableTypes: WORKFLOW_VARIABLE_TYPES,
      variables: [...rows, ...defaults],
      defaults: WORKFLOW_DEFAULT_VARIABLES,
    };
  }

  private async workflowVariableSnapshot(templateId: string) {
    return this.prisma.workflowVariableDefinition.findMany({
      where: { templateId, deletedAt: null, isActive: true },
      select: {
        code: true,
        nameEn: true,
        nameAr: true,
        description: true,
        variableType: true,
        scope: true,
        source: true,
        defaultValueJson: true,
        allowedValuesJson: true,
        isRequired: true,
      },
      orderBy: [{ scope: 'asc' }, { code: 'asc' }],
    });
  }

  private async restoreWorkflowVariableSnapshot(
    tx: Prisma.TransactionClient,
    templateId: string,
    snapshot: Array<Record<string, unknown>>,
    actor: string,
  ) {
    await tx.workflowVariableDefinition.updateMany({
      where: { templateId, deletedAt: null },
      data: { isActive: false, deletedAt: new Date() },
    });
    for (const row of snapshot) {
      const code = String(row['code'] ?? '').trim();
      const nameEn = String(row['nameEn'] ?? '').trim();
      if (!code || !nameEn) continue;
      const registryKey = `${templateId}:${code.toLowerCase()}`;
      await tx.workflowVariableDefinition.upsert({
        where: { registryKey },
        create: {
          registryKey,
          templateId,
          code,
          nameEn,
          nameAr: String(row['nameAr'] ?? '').trim() || null,
          description: String(row['description'] ?? '').trim() || null,
          variableType: String(row['variableType'] ?? 'text'),
          scope: String(row['scope'] ?? 'case'),
          source: String(row['source'] ?? 'designer'),
          defaultValueJson: row['defaultValueJson'] == null ? Prisma.JsonNull : row['defaultValueJson'] as Prisma.InputJsonValue,
          allowedValuesJson: row['allowedValuesJson'] == null ? Prisma.JsonNull : row['allowedValuesJson'] as Prisma.InputJsonValue,
          isRequired: row['isRequired'] === true,
          createdBy: actor,
        },
        update: {
          code,
          nameEn,
          nameAr: String(row['nameAr'] ?? '').trim() || null,
          description: String(row['description'] ?? '').trim() || null,
          variableType: String(row['variableType'] ?? 'text'),
          scope: String(row['scope'] ?? 'case'),
          source: String(row['source'] ?? 'designer'),
          defaultValueJson: row['defaultValueJson'] == null ? Prisma.JsonNull : row['defaultValueJson'] as Prisma.InputJsonValue,
          allowedValuesJson: row['allowedValuesJson'] == null ? Prisma.JsonNull : row['allowedValuesJson'] as Prisma.InputJsonValue,
          isRequired: row['isRequired'] === true,
          isActive: true,
          deletedAt: null,
        },
      });
    }
  }

  private async validateTemplateVariableReferences(
    templateId: string,
    stages: WorkflowBpmnStage[],
    transitions: WorkflowBpmnTransition[],
    validation: WorkflowBpmnValidation,
  ): Promise<WorkflowBpmnValidation> {
    const definitions = await this.prisma.workflowVariableDefinition.findMany({
      where: { templateId, deletedAt: null, isActive: true },
      select: { code: true },
    });
    const registered = new Set([
      ...WORKFLOW_DEFAULT_VARIABLES.map((item) => item.code),
      ...definitions.map((item) => item.code),
    ]);
    const references = new Set<string>();
    for (const stage of stages) {
      this.collectWorkflowVariableReferences(stage.gatewayConfigJson, references);
      const assignment = this.jsonRecord(stage.assignmentConfigJson);
      const variablePath = String(assignment['variablePath'] ?? '').trim();
      if (variablePath) references.add(variablePath);
    }
    for (const transition of transitions) {
      this.collectWorkflowVariableReferences(transition.conditionJson, references);
      for (const match of String(transition.conditionExpression ?? '').matchAll(/\$\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}/g)) {
        references.add(match[1]);
      }
    }
    const undefinedVariables = [...references]
      .filter((code) => !registered.has(code))
      .sort((a, b) => a.localeCompare(b));
    if (!undefinedVariables.length) return validation;
    const errors = [
      ...validation.errors,
      ...undefinedVariables.map((code) => `Workflow variable ${code} is used by this route but is not registered.`),
    ];
    return {
      ...validation,
      status: 'blocked',
      errors: [...new Set(errors)],
      readinessScore: Math.max(0, validation.readinessScore - undefinedVariables.length * 8),
    };
  }

  private collectWorkflowVariableReferences(value: unknown, target: Set<string>): void {
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectWorkflowVariableReferences(item, target));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (['variable', 'path', 'field'].includes(key) && typeof child === 'string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(child)) {
        target.add(child);
      } else {
        this.collectWorkflowVariableReferences(child, target);
      }
    }
  }

  async listTemplateVariables(templateId: string, user: AuthUser) {
    await this.assertTemplateVisible(templateId, user);
    return this.prisma.workflowVariableDefinition.findMany({
      where: { templateId, deletedAt: null, isActive: true },
      orderBy: [{ scope: 'asc' }, { code: 'asc' }],
    });
  }

  async upsertTemplateVariable(templateId: string, dto: UpsertWorkflowVariableDto, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    const template = await this.assertTemplateVisible(templateId, user);
    const code = dto.code.trim();
    const registryKey = `${templateId}:${code.toLowerCase()}`;
    const existing = await this.prisma.workflowVariableDefinition.findFirst({
      where: { templateId, code: { equals: code, mode: 'insensitive' } },
    });
    const variable = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.workflowVariableDefinition.update({
            where: { id: existing.id },
            data: {
              registryKey,
              code,
              nameEn: dto.nameEn.trim(),
              nameAr: dto.nameAr?.trim() || null,
              description: dto.description?.trim() || null,
              variableType: dto.variableType,
              scope: dto.scope ?? 'case',
              source: dto.source ?? 'designer',
              defaultValueJson: dto.defaultValue === undefined ? Prisma.JsonNull : dto.defaultValue as Prisma.InputJsonValue,
              allowedValuesJson: dto.allowedValues === undefined ? Prisma.JsonNull : dto.allowedValues as Prisma.InputJsonValue,
              isRequired: dto.isRequired ?? false,
              isActive: true,
              deletedAt: null,
              createdBy: existing.createdBy ?? user.email,
            },
          })
        : await tx.workflowVariableDefinition.create({
            data: {
              registryKey,
              templateId,
              code,
              nameEn: dto.nameEn.trim(),
              nameAr: dto.nameAr?.trim() || null,
              description: dto.description?.trim() || null,
              variableType: dto.variableType,
              scope: dto.scope ?? 'case',
              source: dto.source ?? 'designer',
              defaultValueJson: dto.defaultValue === undefined ? Prisma.JsonNull : dto.defaultValue as Prisma.InputJsonValue,
              allowedValuesJson: dto.allowedValues === undefined ? Prisma.JsonNull : dto.allowedValues as Prisma.InputJsonValue,
              isRequired: dto.isRequired ?? false,
              createdBy: user.email,
            },
          });
      await tx.workflowTemplate.update({
        where: { id: templateId },
        data: {
          securityJson: this.workflowLifecycleMetadata('draft', user.email, template.securityJson, {
            reviewStatus: 'not_submitted',
            reviewModelSignature: null,
            approvedModelSignature: null,
            variableDefinitionChangedAt: new Date().toISOString(),
          }) as Prisma.InputJsonValue,
        },
      });
      return saved;
    });
    await this.audit.log({
      actor: user.email,
      action: existing ? 'workflow_variable.update' : 'workflow_variable.create',
      entityType: 'workflow_variable_definition',
      entityId: variable.id,
      metadata: { templateId, code, variableType: dto.variableType, scope: dto.scope ?? 'case' },
    });
    return variable;
  }

  async archiveTemplateVariable(templateId: string, variableId: string, user: AuthUser) {
    this.assertWorkflowDesignerAdmin(user);
    const template = await this.assertTemplateVisible(templateId, user);
    const existing = await this.prisma.workflowVariableDefinition.findFirst({
      where: { id: variableId, templateId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('workflow variable definition not found');
    const archived = await this.prisma.$transaction(async (tx) => {
      const row = await tx.workflowVariableDefinition.update({
        where: { id: variableId },
        data: { isActive: false, deletedAt: new Date() },
      });
      await tx.workflowTemplate.update({
        where: { id: templateId },
        data: {
          securityJson: this.workflowLifecycleMetadata('draft', user.email, template.securityJson, {
            reviewStatus: 'not_submitted',
            reviewModelSignature: null,
            approvedModelSignature: null,
            variableDefinitionChangedAt: new Date().toISOString(),
          }) as Prisma.InputJsonValue,
        },
      });
      return row;
    });
    await this.audit.log({
      actor: user.email,
      action: 'workflow_variable.archive',
      entityType: 'workflow_variable_definition',
      entityId: variableId,
      metadata: { templateId, code: existing.code },
    });
    return archived;
  }

  workflowAuditEventCatalog() {
    return WORKFLOW_AUDIT_EVENT_CATALOG;
  }

  private workflowLifecycleMetadata(
    state: string,
    actor: string,
    previous?: unknown,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const current = this.jsonRecord(previous);
    const existing = this.jsonRecord(current['workflowLifecycle']);
    return {
      ...current,
      workflowLifecycle: {
        ...existing,
        state,
        lastActor: actor,
        lastChangedAt: new Date().toISOString(),
        allowedStates: WORKFLOW_DESIGNER_LIFECYCLE.states,
        designerRoles: WORKFLOW_DESIGNER_LIFECYCLE.roles.designer,
        reviewerRoles: WORKFLOW_DESIGNER_LIFECYCLE.roles.reviewer,
        publisherRoles: WORKFLOW_DESIGNER_LIFECYCLE.roles.publisher,
        segregationOfDuties: WORKFLOW_DESIGNER_LIFECYCLE.segregationOfDuties,
        ...extra,
      },
    };
  }

  private workflowLifecycle(previous?: unknown): Record<string, unknown> {
    return this.jsonRecord(this.jsonRecord(previous)['workflowLifecycle']);
  }

  private workflowSnapshotSignature(bpmnXml: string, designerJson: unknown): string {
    return createHmac('sha256', this.workflowSigningSecret())
      .update(this.canonicalWorkflowSnapshot(bpmnXml, designerJson))
      .digest('hex');
  }

  private workflowReviewSignature(bpmnXml: string): string {
    return createHmac('sha256', this.workflowSigningSecret())
      .update(JSON.stringify({ bpmnXml }))
      .digest('hex');
  }

  private verifyWorkflowSnapshotSignature(bpmnXml: string, designerJson: unknown, signature?: string | null): boolean {
    if (!signature) return false;
    const expected = this.workflowSnapshotSignature(bpmnXml, designerJson);
    const expectedBuffer = Buffer.from(expected, 'hex');
    const signatureBuffer = Buffer.from(signature, 'hex');
    return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
  }

  private canonicalWorkflowSnapshot(bpmnXml: string, designerJson: unknown): string {
    return JSON.stringify({ bpmnXml, designerJson: designerJson ?? null });
  }

  private workflowSigningSecret(): string {
    const secret = process.env.DGOP_BPMN_SIGNING_SECRET;
    if (secret?.trim()) return secret;
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Workflow model signing secret is not configured');
    }
    return 'dgop-local-workflow-signing-secret';
  }

  private encryptWorkflowSnapshot(plaintext: string, secret: string) {
    const key = createHash('sha256').update(secret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      algorithm: 'AES-256-GCM',
      keyRef: process.env.DGOP_BPMN_SIGNING_KEY_REF || 'DGOP_BPMN_SIGNING_SECRET',
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private currentBpmnComparableRoute(template: WorkflowTemplateWithRoute) {
    const codeById = new Map(template.stages.map((stage) => [stage.id, stage.code]));
    return {
      stages: template.stages.map((stage) => ({
        code: stage.code,
        nameEn: stage.nameEn,
        assigneeRoleCode: stage.assigneeRoleCode,
        dueDays: stage.dueDays,
        isDecision: stage.isDecision,
        isFinal: stage.isFinal,
      })),
      transitions: template.transitions.map((transition) => ({
        fromStageId: codeById.get(transition.fromStageId) ?? transition.fromStageId,
        toStageId: codeById.get(transition.toStageId) ?? transition.toStageId,
        decision: transition.decision,
        labelEn: transition.labelEn,
      })),
    };
  }

  private async migrateActiveCasesForTemplate(
    client: Prisma.TransactionClient,
    templateId: string,
    actor: string,
    options: { fallbackStageCode?: string | null; dryRun?: boolean },
  ) {
    const template = await client.workflowTemplate.findUnique({ where: { id: templateId }, include: templateInclude });
    if (!template) throw new NotFoundException('workflow route template not found');
    const activeStages = template.stages.filter((stage) => stage.isActive);
    const activeStageIds = new Set(activeStages.map((stage) => stage.id));
    const activeByCode = new Map(activeStages.map((stage) => [stage.code, stage]));
    const fallbackStage =
      (options.fallbackStageCode ? activeByCode.get(options.fallbackStageCode) : null) ??
      firstActionableWorkflowStage(activeStages) ??
      activeStages[0] ??
      null;
    const activeCases = await client.workflowCase.findMany({
      where: { templateId, status: { notIn: [...FINAL_CASE_STATUSES] } },
      select: {
        id: true,
        code: true,
        title: true,
        assetId: true,
        templateVersion: true,
        tasks: {
          where: { status: { in: [TaskStatus.pending, TaskStatus.in_progress] } },
          select: {
            id: true,
            title: true,
            templateStageId: true,
            templateStage: { select: { code: true, nameEn: true, isActive: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    let migratedCases = 0;
    let migratedTasks = 0;
    let manualReviewCases = 0;
    const actions: Array<Record<string, unknown>> = [];
    for (const wfCase of activeCases) {
      let caseTouched = false;
      let caseNeedsManualReview = false;
      for (const task of wfCase.tasks) {
        if (task.templateStageId && activeStageIds.has(task.templateStageId)) continue;
        const replacement = activeByCode.get(task.templateStage?.code ?? '') ?? fallbackStage;
        if (!replacement) {
          caseNeedsManualReview = true;
          actions.push({ caseId: wfCase.id, caseCode: wfCase.code, taskId: task.id, action: 'manual_review', reason: 'No active replacement stage is available' });
          continue;
        }
        actions.push({
          caseId: wfCase.id,
          caseCode: wfCase.code,
          taskId: task.id,
          action: options.dryRun ? 'would_migrate' : 'migrated',
          fromStage: task.templateStage?.code ?? null,
          toStage: replacement.code,
        });
        if (options.dryRun) continue;
        await client.workflowTask.update({
          where: { id: task.id },
          data: {
            status: TaskStatus.cancelled,
            decisionComment: 'Cancelled by workflow route version migration.',
            completedAt: new Date(),
          },
        });
        await this.completeRuntimeTokensForTask(client, task.id);
        await this.createStageTask(client, wfCase.id, replacement, actor, {
          assetId: wfCase.assetId,
          title: `${replacement.nameEn} (migrated from ${task.templateStage?.nameEn ?? task.title})`,
        });
        await client.workflowEvent.create({
          data: {
            caseId: wfCase.id,
            taskId: task.id,
            actor,
            action: 'route.version_migration',
            comment: `${task.templateStage?.code ?? 'unmapped'} -> ${replacement.code}`,
          },
        });
        caseTouched = true;
        migratedTasks++;
      }
      if (caseTouched) migratedCases++;
      if (!options.dryRun && wfCase.templateVersion !== template.designerVersion) {
        await client.workflowCase.update({
          where: { id: wfCase.id },
          data: { templateVersion: template.designerVersion },
        });
        if (!caseTouched) migratedCases++;
        await client.workflowEvent.create({
          data: {
            caseId: wfCase.id,
            actor,
            action: 'route.version_migration',
            comment: `Workflow version ${wfCase.templateVersion} -> ${template.designerVersion}`,
          },
        });
      }
      if (caseNeedsManualReview) manualReviewCases++;
    }
    return {
      templateId,
      dryRun: Boolean(options.dryRun),
      migratedCases,
      migratedTasks,
      manualReviewCases,
      actions,
    };
  }

  private async uniqueTemplateCode(input: string | null | undefined): Promise<string> {
    const base = String(input ?? 'workflow_route')
      .trim()
      .replace(/^WF-/i, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase()
      .slice(0, 48) || 'CUSTOM-ROUTE';
    let code = `WF-${base}`;
    let counter = 2;
    while (await this.prisma.workflowTemplate.findUnique({ where: { code }, select: { id: true } })) {
      code = `WF-${base}-${counter++}`;
    }
    return code;
  }

  private initialDesignerStages(): WorkflowBpmnStage[] {
    return [
      {
        code: 'intake',
        nameEn: 'Intake',
        nameAr: 'الاستلام',
        description: 'Capture the request and context.',
        kind: 'intake',
        nodeType: 'user_task',
        taskType: 'information',
        assignmentStrategy: 'role',
        assigneeRoleCode: 'dmo_admin',
        dueDays: 1,
        formSchemaJson: {
          fields: ['request_title', 'case_type', 'linked_asset', 'business_reason'],
          required: ['request_title', 'case_type'],
        },
        slaConfigJson: { dueDays: 1, escalationAfterHours: 20 },
        notificationRulesJson: [{ event: 'created', channel: 'in_app', audience: 'assignee' }],
        evidenceRequirementsJson: null,
        automationConfigJson: null,
        gatewayConfigJson: null,
        parallelGroup: null,
        sortOrder: 1,
        isStart: true,
        isDecision: false,
        isFinal: false,
        isActive: true,
      },
      {
        code: 'review',
        nameEn: 'Review',
        nameAr: 'المراجعة',
        description: 'Review evidence, risk, and ownership.',
        kind: 'review',
        nodeType: 'user_task',
        taskType: 'review',
        assignmentStrategy: 'role',
        assigneeRoleCode: 'data_steward',
        dueDays: 2,
        formSchemaJson: { fields: ['review_notes', 'risk_level', 'recommendation'], required: ['recommendation'] },
        slaConfigJson: { dueDays: 2, escalationAfterHours: 36 },
        notificationRulesJson: [{ event: 'assigned', channel: 'in_app', audience: 'assignee' }],
        evidenceRequirementsJson: [{ name: 'Review evidence', required: false }],
        automationConfigJson: null,
        gatewayConfigJson: { branches: ['approved', 'rejected', WORKFLOW_RETURN_FOR_CLARIFICATION], defaultPath: WORKFLOW_RETURN_FOR_CLARIFICATION },
        parallelGroup: null,
        sortOrder: 2,
        isStart: false,
        isDecision: true,
        isFinal: false,
        isActive: true,
      },
      {
        code: 'closure',
        nameEn: 'Closure',
        nameAr: 'الإغلاق',
        description: 'Record the result and close the route.',
        kind: 'closure',
        nodeType: 'user_task',
        taskType: 'approval',
        assignmentStrategy: 'role',
        assigneeRoleCode: 'dmo_admin',
        dueDays: 1,
        formSchemaJson: { fields: ['decision_summary', 'closure_notes'], required: ['decision_summary'] },
        slaConfigJson: { dueDays: 1, escalationAfterHours: 20 },
        notificationRulesJson: [{ event: 'completed', channel: 'in_app', audience: 'case_owner' }],
        evidenceRequirementsJson: [{ name: 'Final decision note', required: true }],
        automationConfigJson: null,
        gatewayConfigJson: { outcomes: workflowEndOutcomes() },
        parallelGroup: null,
        sortOrder: 3,
        isStart: false,
        isDecision: false,
        isFinal: true,
        isActive: true,
      },
    ];
  }

  private designerResponse(
    template: WorkflowTemplateWithRoute,
    validation = this.currentRouteValidation(template),
  ) {
    const bpmnXml = this.designerBpmnXmlForTemplate(template);
    return {
      template,
      bpmnXml,
      validation,
      designerJson: template.designerJson ?? {
        source: template.bpmnXml ? 'saved_bpmn' : 'generated_from_route',
        stages: template.stages.length,
        transitions: template.transitions.length,
      },
      version: {
        current: template.designerVersion ?? 1,
        lastPublishedAt: template.lastPublishedAt,
        lastPublishedBy: template.lastPublishedBy,
      },
      security: {
        modelSignature: template.modelSignature,
        signatureAlgorithm: template.signatureAlgorithm,
        securityJson: template.securityJson,
      },
      enterprise: this.enterpriseDesignerSummary(template, validation),
    };
  }

  private designerBpmnXmlForTemplate(template: WorkflowTemplateWithRoute): string {
    if (this.shouldRegenerateSystemBpmnLayout(template)) {
      return templateToBpmnXml(this.toBpmnTemplate(template));
    }
    return template.bpmnXml ?? templateToBpmnXml(this.toBpmnTemplate(template));
  }

  private shouldRegenerateSystemBpmnLayout(template: WorkflowTemplateWithRoute): boolean {
    if (!template.isSystem || !template.bpmnXml) return false;
    const security = this.jsonRecord(template.securityJson);
    const designer = this.jsonRecord(template.designerJson);
    const layoutVersion = String(security['bpmnLayoutVersion'] ?? designer['bpmnLayoutVersion'] ?? '');
    if (layoutVersion === WORKFLOW_BPMN_LAYOUT_VERSION) return false;
    const source = String(designer['source'] ?? '');
    return !source || source.startsWith('route_seed') || ['generated_from_route', 'maintenance_signature', 'saved_bpmn'].includes(source);
  }

  private enterpriseDesignerSummary(template: WorkflowTemplateWithRoute, validation: ReturnType<typeof validateWorkflowRoute>) {
    const stages = this.toBpmnTemplate(template).stages;
    const countBy = (predicate: (stage: WorkflowBpmnStage) => boolean) => stages.filter(predicate).length;
    const finalStage = template.stages.find((stage) => stage.isActive && stage.isFinal) ?? null;
    return {
      readinessScore: validation.readinessScore,
      checklist: validation.checklist,
      nodePalette: workflowNodePalette(),
      connectorTypes: WORKFLOW_CONNECTOR_TYPES,
      variableTypes: WORKFLOW_VARIABLE_TYPES,
      defaultVariables: WORKFLOW_DEFAULT_VARIABLES,
      endOutcomes: workflowEndOutcomes(finalStage),
      designerLifecycle: WORKFLOW_DESIGNER_LIFECYCLE,
      coverage: {
        forms: countBy((stage) => Boolean(stage.formSchemaJson)),
        evidence: countBy((stage) => Boolean(stage.evidenceRequirementsJson)),
        notifications: countBy((stage) => Boolean(stage.notificationRulesJson)),
        automation: countBy((stage) => Boolean(stage.automationConfigJson)),
        roleAssignments: countBy((stage) => Boolean(stage.assigneeRoleCode)),
      },
      rulePacks: stages.map((stage) => ({
        code: stage.code,
        nameEn: stage.nameEn,
        nodeType: stage.nodeType ?? (stage.taskType === 'approval' ? 'approval_task' : 'user_task'),
        assignmentStrategy: stage.assignmentStrategy ?? 'role',
        assignmentConfigured: Boolean(stage.assignmentConfigJson),
        assigneeRoleCode: stage.assigneeRoleCode ?? null,
        hasForm: Boolean(stage.formSchemaJson),
        hasEvidence: Boolean(stage.evidenceRequirementsJson),
        hasNotifications: Boolean(stage.notificationRulesJson),
        hasAutomation: Boolean(stage.automationConfigJson),
        dueDays: stage.dueDays,
        isDecision: stage.isDecision,
        isFinal: stage.isFinal,
      })),
    };
  }

  private toBpmnTemplate(template: WorkflowTemplateWithRoute): WorkflowBpmnTemplate {
    return {
      id: template.id,
      code: template.code,
      caseType: template.caseType,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      description: template.description,
      defaultSlaDays: template.defaultSlaDays,
      stages: template.stages.map((stage) => ({
        id: stage.id,
        code: stage.code,
        nameEn: stage.nameEn,
        nameAr: stage.nameAr,
        description: stage.description,
        kind: stage.kind,
        nodeType: stage.nodeType,
        taskType: stage.taskType,
        assignmentStrategy: stage.assignmentStrategy,
        assignmentConfigJson: stage.assignmentConfigJson,
        assigneeRoleCode: stage.assigneeRoleCode,
        dueDays: stage.dueDays,
        formSchemaJson: stage.formSchemaJson,
        slaConfigJson: stage.slaConfigJson,
        notificationRulesJson: stage.notificationRulesJson,
        evidenceRequirementsJson: stage.evidenceRequirementsJson,
        automationConfigJson: stage.automationConfigJson,
        gatewayConfigJson: stage.gatewayConfigJson,
        parallelGroup: stage.parallelGroup,
        sortOrder: stage.sortOrder,
        isStart: stage.isStart,
        isDecision: stage.isDecision,
        isFinal: stage.isFinal,
        isActive: stage.isActive,
      })),
      transitions: template.transitions.map((transition) => ({
        id: transition.id,
        fromStageId: transition.fromStageId,
        toStageId: transition.toStageId,
        labelEn: transition.labelEn,
        labelAr: transition.labelAr,
        connectorType: normalizeWorkflowConnectorType(transition.connectorType),
        decision: transition.decision,
        conditionExpression: transition.conditionExpression,
        conditionJson: transition.conditionJson,
        isDefaultPath: Boolean(transition.isDefaultPath) || isWorkflowDefaultPath(transition),
        timeoutAfterSeconds: transition.timeoutAfterSeconds,
        isHappyPath: transition.isHappyPath,
        sortOrder: transition.sortOrder,
      })),
    };
  }

  private currentRouteValidation(template: WorkflowTemplateWithRoute) {
    const stageById = new Map(template.stages.map((stage) => [stage.id, stage]));
    const stages: WorkflowBpmnStage[] = template.stages.map((stage) => ({
      id: stage.id,
      code: stage.code,
      nameEn: stage.nameEn,
      nameAr: stage.nameAr,
      description: stage.description,
      kind: stage.kind,
      nodeType: stage.nodeType,
      taskType: stage.taskType,
      assignmentStrategy: stage.assignmentStrategy,
      assignmentConfigJson: stage.assignmentConfigJson,
      assigneeRoleCode: stage.assigneeRoleCode,
      dueDays: stage.dueDays,
      formSchemaJson: stage.formSchemaJson,
      slaConfigJson: stage.slaConfigJson,
      notificationRulesJson: stage.notificationRulesJson,
      evidenceRequirementsJson: stage.evidenceRequirementsJson,
      automationConfigJson: stage.automationConfigJson,
      gatewayConfigJson: stage.gatewayConfigJson,
      parallelGroup: stage.parallelGroup,
      sortOrder: stage.sortOrder,
      isStart: stage.isStart,
      isDecision: stage.isDecision,
      isFinal: stage.isFinal,
      isActive: stage.isActive,
    }));
    const transitions: WorkflowBpmnTransition[] = template.transitions.map((transition) => ({
      id: transition.id,
      fromStageId: stageById.get(transition.fromStageId)?.code ?? transition.fromStageId,
      toStageId: stageById.get(transition.toStageId)?.code ?? transition.toStageId,
      labelEn: transition.labelEn,
      labelAr: transition.labelAr,
      connectorType: normalizeWorkflowConnectorType(transition.connectorType),
      decision: transition.decision,
      conditionExpression: transition.conditionExpression,
      conditionJson: transition.conditionJson,
      isDefaultPath: Boolean(transition.isDefaultPath) || isWorkflowDefaultPath(transition),
      timeoutAfterSeconds: transition.timeoutAfterSeconds,
      isHappyPath: transition.isHappyPath,
      sortOrder: transition.sortOrder,
    }));
    return validateWorkflowRoute(stages, transitions);
  }

  private async applyPublishedBpmnRoute(
    tx: Prisma.TransactionClient,
    templateId: string,
    stages: WorkflowBpmnStage[],
    transitions: WorkflowBpmnTransition[],
    actor: string,
  ): Promise<void> {
    const now = new Date();
    const activeStageCodes = stages.map((stage) => stage.code);
    const existingStages = await tx.workflowTemplateStage.findMany({
      where: { templateId },
      select: { id: true, code: true },
    });
    const existingByCode = new Map(existingStages.map((stage) => [stage.code, stage.id]));
    const idByCode = new Map<string, string>();

    for (const stage of stages) {
      const data = {
        nameEn: stage.nameEn,
        nameAr: stage.nameAr || stage.nameEn,
        description: stage.description ?? null,
        kind: stage.kind,
        nodeType: stage.nodeType ?? 'user_task',
        taskType: stage.taskType,
        assignmentStrategy: stage.assignmentStrategy ?? 'role',
        assignmentConfigJson: (stage.assignmentConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        assigneeRoleCode: stage.assigneeRoleCode ?? null,
        dueDays: stage.dueDays,
        formSchemaJson: (stage.formSchemaJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        slaConfigJson: (stage.slaConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        notificationRulesJson: (stage.notificationRulesJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        evidenceRequirementsJson: (stage.evidenceRequirementsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        automationConfigJson: (stage.automationConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        gatewayConfigJson: (stage.gatewayConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        parallelGroup: stage.parallelGroup ?? null,
        sortOrder: stage.sortOrder,
        isStart: stage.isStart,
        isDecision: stage.isDecision,
        isFinal: stage.isFinal,
        isActive: true,
      };
      const existingId = existingByCode.get(stage.code);
      if (existingId) {
        const updated = await tx.workflowTemplateStage.update({
          where: { id: existingId },
          data,
          select: { id: true },
        });
        idByCode.set(stage.code, updated.id);
      } else {
        const created = await tx.workflowTemplateStage.create({
          data: { templateId, code: stage.code, ...data },
          select: { id: true },
        });
        idByCode.set(stage.code, created.id);
      }
    }

    if (activeStageCodes.length) {
      await tx.workflowTemplateStage.updateMany({
        where: { templateId, code: { notIn: activeStageCodes } },
        data: { isActive: false, isStart: false, isDecision: false, isFinal: false },
      });
    }

    await tx.workflowTemplateTransition.updateMany({
      where: { templateId, isActive: true },
      data: { isActive: false, retiredAt: now, retiredBy: actor },
    });
    for (const transition of transitions) {
      const fromStageId = idByCode.get(transition.fromStageId);
      const toStageId = idByCode.get(transition.toStageId);
      if (!fromStageId || !toStageId) continue;
      await tx.workflowTemplateTransition.create({
        data: {
          templateId,
          fromStageId,
          toStageId,
          labelEn: transition.labelEn,
          labelAr: transition.labelAr || transition.labelEn,
          connectorType: normalizeWorkflowConnectorType(transition.connectorType),
          decision: transition.decision ?? null,
          conditionExpression: transition.conditionExpression ?? null,
          conditionJson: (transition.conditionJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          isDefaultPath: Boolean(transition.isDefaultPath) || isWorkflowDefaultPath(transition),
          timeoutAfterSeconds: transition.timeoutAfterSeconds ?? null,
          sortOrder: transition.sortOrder,
          isHappyPath: transition.isHappyPath,
          isActive: true,
          retiredAt: null,
          retiredBy: null,
        },
      });
    }
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

  private async assertAssetVisible(
    roleCodes: string[],
    assetId: string,
    client: PrismaWriter = this.prisma,
  ): Promise<void> {
    const assetIds = await this.visibleAssetIds(roleCodes, client);
    if (assetIds !== 'all' && !assetIds.has(assetId)) {
      throw new NotFoundException('workflow case not found');
    }
  }

  private workflowTaskActorVisibility(
    roleCodes: string[],
    actor?: string | AuthUser,
  ): Prisma.WorkflowTaskWhereInput[] {
    const visibility: Prisma.WorkflowTaskWhereInput[] = [];
    if (actor && typeof actor !== 'string') visibility.push({ assigneeUserId: actor.id });
    if (roleCodes.length) {
      visibility.push({
        assigneeUserId: null,
        OR: [
          { assigneeRoleCode: { in: roleCodes } },
          { templateStage: { assigneeRoleCode: { in: roleCodes } } },
        ],
      });
    }
    return visibility;
  }

  private workflowCaseActorVisibility(
    roleCodes: string[],
    actor?: string | AuthUser,
  ): Prisma.WorkflowCaseWhereInput[] {
    const visibility: Prisma.WorkflowCaseWhereInput[] = [];
    const actorEmail = typeof actor === 'string' ? actor : actor?.email;
    if (actorEmail) visibility.push({ createdBy: actorEmail });
    const taskVisibility = this.workflowTaskActorVisibility(roleCodes, actor);
    if (taskVisibility.length) visibility.push({ tasks: { some: { OR: taskVisibility } } });
    return visibility;
  }

  private async assertCaseVisible(
    roleCodes: string[],
    wfCase: { id?: string; assetId: string | null },
    actor?: string | AuthUser,
    client: PrismaWriter = this.prisma,
  ): Promise<void> {
    if (wfCase.assetId) {
      await this.assertAssetVisible(roleCodes, wfCase.assetId, client);
      return;
    }
    const assetIds = await this.visibleAssetIds(roleCodes, client);
    if (assetIds === 'all') return;
    if (!wfCase.id) throw new NotFoundException('workflow case not found');
    const actorVisibility = this.workflowCaseActorVisibility(roleCodes, actor);
    if (!actorVisibility.length) throw new NotFoundException('workflow case not found');
    const visible = await client.workflowCase.findFirst({
      where: {
        id: wfCase.id,
        assetId: null,
        OR: actorVisibility,
      },
      select: { id: true },
    });
    if (!visible) throw new NotFoundException('workflow case not found');
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
      const taskVisibility = this.workflowTaskActorVisibility(viewer.roles, viewer);
      visible.push(
        { AND: [{ assetId: null }, { createdBy: viewer.email }] },
        { AND: [{ assetId: null }, { tasks: { some: { OR: taskVisibility } } }] },
      );
    }
    return visible.length ? { OR: visible } : { id: { equals: '__no_visible_workflow_cases__' } };
  }

  private assertCaseCanChange(status: CaseStatus): void {
    if (FINAL_CASE_STATUSES.includes(status)) {
      throw new BadRequestException('Closed, implemented, rejected, cancelled, or failed cases cannot be modified');
    }
    if (status === CASE_STATUS_SUSPENDED) {
      throw new BadRequestException('Suspended workflow cases must be resumed before task decisions or edits');
    }
  }

  private assertCaseTransition(from: CaseStatus, to: CaseStatus): void {
    if (from === to) return;
    if (!CASE_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Invalid workflow case transition from ${from} to ${to}`);
    }
  }

  private assertKnownCaseStatus(status: string): CaseStatus {
    if (!Object.values(CaseStatus).includes(status as CaseStatus) && ![CASE_STATUS_SUSPENDED, CASE_STATUS_CANCELLED, CASE_STATUS_FAILED].includes(status as CaseStatus)) {
      throw new BadRequestException('Invalid workflow case status');
    }
    return status as CaseStatus;
  }

  private resumeStatusFromSuspension(status?: CaseStatus | string | null): CaseStatus {
    const candidate = String(status ?? '');
    if (
      candidate &&
      candidate !== CASE_STATUS_SUSPENDED &&
      !FINAL_CASE_STATUSES.includes(candidate as CaseStatus) &&
      (Object.values(CaseStatus).includes(candidate as CaseStatus) || CASE_TRANSITIONS[candidate])
    ) {
      return candidate as CaseStatus;
    }
    return CaseStatus.submitted;
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

  private async demoteConflictingApprovedPrimary(
    client: Prisma.TransactionClient,
    assignment: {
      id: string;
      targetType: AssignmentTargetType;
      targetId: string;
      roleTypeId: string;
      isPrimary: boolean;
      isActive: boolean;
      effectiveDate: Date;
      expiryDate: Date | null;
    },
  ): Promise<number> {
    if (!assignment.isPrimary || !assignment.isActive) return 0;
    const where: Prisma.StewardshipAssignmentWhereInput = {
      targetType: assignment.targetType,
      targetId: assignment.targetId,
      roleTypeId: assignment.roleTypeId,
      isPrimary: true,
      isActive: true,
      approvalStatus: ApprovalStatus.approved,
      deletedAt: null,
      NOT: { id: assignment.id },
      OR: [{ expiryDate: null }, { expiryDate: { gte: assignment.effectiveDate } }],
    };
    if (assignment.expiryDate) {
      where.effectiveDate = { lte: assignment.expiryDate };
    }
    const result = await client.stewardshipAssignment.updateMany({
      where,
      data: { isPrimary: false },
    });
    return result.count;
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

  async getCaseTokenTrace(roleCodes: string[], id: string, viewer?: AuthUser) {
    const wfCase = await this.prisma.workflowCase.findUnique({ where: { id } });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(roleCodes, wfCase, viewer ?? wfCase.createdBy);
    const tokens = await this.prisma.workflowRuntimeToken.findMany({
      where: { caseId: id },
      include: {
        templateStage: { select: { id: true, code: true, nameEn: true, nodeType: true, isDecision: true, isFinal: true } },
        task: { select: { id: true, title: true, status: true, decision: true, completedAt: true } },
      },
      orderBy: [{ activatedAt: 'asc' }, { createdAt: 'asc' }],
    });
    const executions = await this.prisma.workflowExecutionAttempt.findMany({
      where: { caseId: id },
      select: {
        id: true, taskId: true, executionKind: true, status: true, attemptCount: true, maxAttempts: true,
        nextAttemptAt: true, outcome: true, errorCode: true, errorMessage: true, resultJson: true,
        startedAt: true, completedAt: true, createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });
    const byId = new Map(tokens.map((token) => [token.id, token]));
    return {
      caseId: id,
      tokens: tokens.map((token) => ({
        id: token.id,
        instanceKey: token.instanceKey,
        state: token.state,
        tokenType: token.tokenType,
        parentTokenId: token.parentTokenId,
        rootTokenId: token.rootTokenId,
        branchKey: token.branchKey,
        branchIndex: token.branchIndex,
        joinKey: token.joinKey,
        sourceTransitionId: token.sourceTransitionId,
        parallelGroup: token.parallelGroup,
        stage: token.templateStage,
        task: token.task,
        dataJson: token.dataJson,
        activatedAt: token.activatedAt,
        completedAt: token.completedAt,
        parentStageCode: token.parentTokenId ? byId.get(token.parentTokenId)?.templateStage?.code ?? null : null,
      })),
      lineage: tokens.map((token) => ({
        id: token.id,
        parentTokenId: token.parentTokenId,
        rootTokenId: token.rootTokenId ?? token.id,
        branchKey: token.branchKey,
        joinKey: token.joinKey,
        state: token.state,
      })),
      executions,
    };
  }

  async retryExecutionAttempt(id: string, user: AuthUser) {
    const attempt = await this.prisma.workflowExecutionAttempt.findUnique({
      where: { id },
      include: { case: true, task: true, templateStage: { select: { code: true, nameEn: true } } },
    });
    if (!attempt) throw new NotFoundException('workflow execution attempt not found');
    await this.assertCaseVisible(user.roles, attempt.case, user);
    this.assertCaseCanChange(attempt.case.status as CaseStatus);
    if (!['failed', 'cancelled'].includes(attempt.status)) {
      throw new BadRequestException('Only failed or cancelled workflow execution attempts can be retried');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.workflowTask.update({
        where: { id: attempt.taskId },
        data: {
          status: TaskStatus.pending,
          decision: null,
          decisionComment: null,
          completedAt: null,
        },
      });
      const row = await tx.workflowExecutionAttempt.update({
        where: { id },
        data: {
          status: 'queued',
          nextAttemptAt: new Date(),
          startedAt: null,
          completedAt: null,
          outcome: null,
          errorCode: null,
          errorMessage: null,
          resultJson: {
            retryRequestedBy: user.email,
            retryRequestedAt: new Date().toISOString(),
            previousStatus: attempt.status,
            previousErrorCode: attempt.errorCode ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.workflowEvent.create({
        data: {
          caseId: attempt.caseId,
          taskId: attempt.taskId,
          actor: user.email,
          action: 'route.automation.retry_requested',
          comment: attempt.errorMessage ?? attempt.templateStage.nameEn,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_execution.retry',
          entityType: 'workflow_execution_attempt',
          entityId: id,
          metadata: {
            caseId: attempt.caseId,
            taskId: attempt.taskId,
            templateStageCode: attempt.templateStage.code,
            previousStatus: attempt.status,
            previousErrorCode: attempt.errorCode ?? null,
          },
        },
        tx,
      );
      return row;
    });
    return updated;
  }

  /** Generates a human-friendly case code with an atomic database counter. */
  private async nextCaseCode(): Promise<string> {
    return nextAvailableBusinessCode(
      this.prisma,
      'workflow_case',
      (value) => `WFC-${formatBusinessSequence(value, 4)}`,
      async (code) => !(await this.prisma.workflowCase.findUnique({ where: { code }, select: { id: true } })),
    );
  }

  private async nextCaseCodeForClient(
    client: Prisma.TransactionClient,
    preferredCode?: string | null,
  ): Promise<string> {
    if (preferredCode) {
      return nextAvailableBusinessCode(
        client,
        `workflow_case:preferred:${preferredCode}`,
        (value) => value === 1n ? preferredCode : `${preferredCode}-${formatBusinessSequence(value, 4)}`,
        async (code) => !(await client.workflowCase.findUnique({ where: { code }, select: { id: true } })),
      );
    }
    return nextAvailableBusinessCode(
      client,
      'workflow_case',
      (value) => `WFC-${formatBusinessSequence(value, 4)}`,
      async (code) => !(await client.workflowCase.findUnique({ where: { code }, select: { id: true } })),
    );
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
    options: {
      assetId?: string | null;
      assigneeUserId?: string | null;
      dueDate?: Date | null;
      title?: string | null;
      tokenLineage?: WorkflowTokenLineageContext;
    } = {},
  ) {
    const approvalConfig = this.approvalExecutionConfig(stage);
    if (options.assigneeUserId === undefined && approvalConfig.mode === 'parallel' && approvalConfig.roleCodes.length > 1) {
      const groupId = randomUUID();
      const tasks: Array<Awaited<ReturnType<typeof this.createSingleStageTask>>> = [];
      for (const roleCode of approvalConfig.roleCodes) {
        tasks.push(await this.createSingleStageTask(client, caseId, stage, actor, {
          ...options,
          title: `${options.title || stage.nameEn} - ${this.roleTitle(roleCode)}`,
          assigneeRoleCode: roleCode,
          approvalGroupId: groupId,
          approvalMode: 'parallel',
          tokenLineage: options.tokenLineage,
        }));
      }
      await client.workflowEvent.create({
        data: {
          caseId,
          actor,
          action: 'route.parallel_approval.activated',
          comment: `${stage.nameEn}: ${approvalConfig.roleCodes.join(', ')}`,
        },
      });
      return tasks[0];
    }
    if (options.assigneeUserId === undefined && approvalConfig.mode === 'sequential' && approvalConfig.roleCodes.length > 0) {
      return this.createSingleStageTask(client, caseId, stage, actor, {
        ...options,
        assigneeRoleCode: approvalConfig.roleCodes[0],
        approvalGroupId: randomUUID(),
        approvalMode: 'sequential',
        tokenLineage: options.tokenLineage,
      });
    }
    return this.createSingleStageTask(client, caseId, stage, actor, options);
  }

  private async createSingleStageTask(
    client: Prisma.TransactionClient,
    caseId: string,
    stage: WorkflowStageWithRoute,
    actor: string,
    options: {
      assetId?: string | null;
      assigneeUserId?: string | null;
      dueDate?: Date | null;
      title?: string | null;
      assigneeRoleCode?: string | null;
      approvalGroupId?: string | null;
      approvalMode?: string | null;
      tokenLineage?: WorkflowTokenLineageContext;
    } = {},
  ) {
    const targetRoleCode = options.assigneeRoleCode ?? stage.assigneeRoleCode ?? null;
    const assigneeUserId =
      options.assigneeUserId !== undefined
        ? options.assigneeUserId
        : await this.resolveStageAssignee(client, caseId, stage, targetRoleCode, options.assetId ?? null);
    const task = await client.workflowTask.create({
      data: {
        caseId,
        title: options.title || stage.nameEn,
        type: stage.taskType,
        status: TaskStatus.pending,
        assigneeUserId: assigneeUserId ?? null,
        assigneeRoleCode: targetRoleCode,
        approvalGroupId: options.approvalGroupId ?? null,
        approvalMode: options.approvalMode ?? null,
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
    if ((stage.assignmentStrategy ?? 'role') !== 'role') {
      await client.workflowEvent.create({
        data: {
          caseId,
          taskId: task.id,
          actor,
          action: 'route.stage.assignment.resolved',
          comment: `${stage.assignmentStrategy}:${assigneeUserId ?? targetRoleCode ?? 'unassigned'}`,
        },
      });
    }
    await this.recordRuntimeTokenForTask(
      client,
      task,
      stage,
      actor,
      options.approvalMode ?? null,
      options.approvalGroupId ?? null,
      options.tokenLineage,
    );
    if (isAutomatedWorkflowStage(stage)) {
      await this.enqueueStageExecution(client, task, stage, actor);
    }
    return task;
  }

  private executionKindForStage(stage: { nodeType?: string | null }): string {
    return String(stage.nodeType ?? 'automated_task').trim().toLowerCase() || 'automated_task';
  }

  private executionConfigForStage(stage: { nodeType?: string | null; automationConfigJson?: unknown | null; slaConfigJson?: unknown | null }): Record<string, unknown> {
    const automation = this.jsonRecord(stage.automationConfigJson);
    if (this.executionKindForStage(stage) !== 'timer_event') return automation;
    return { ...automation, ...this.jsonRecord(stage.slaConfigJson) };
  }

  private executionScheduleForStage(stage: { nodeType?: string | null; automationConfigJson?: unknown | null; slaConfigJson?: unknown | null }): Date {
    const config = this.executionConfigForStage(stage);
    for (const key of ['dueAt', 'dueDate', 'timeoutAt', 'slaExpiresAt']) {
      if (typeof config[key] !== 'string') continue;
      const date = new Date(config[key] as string);
      if (!Number.isNaN(date.getTime())) return date;
    }
    const relativeDurations: Array<[string, number]> = [
      ['delaySeconds', 1],
      ['durationSeconds', 1],
      ['durationMinutes', 60],
      ['timeoutMinutes', 60],
      ['durationHours', 3_600],
      ['timeoutHours', 3_600],
      ['dueDays', 86_400],
    ];
    for (const [key, multiplier] of relativeDurations) {
      if (config[key] == null) continue;
      const value = Number(config[key]);
      if (Number.isFinite(value) && value >= 0) {
        const delaySeconds = Math.min(value * multiplier, 31_536_000);
        return new Date(Date.now() + delaySeconds * 1000);
      }
    }
    for (const key of ['duration', 'timeout']) {
      if (typeof config[key] !== 'string') continue;
      const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(config[key] as string);
      if (!match) continue;
      const seconds = Number(match[1] ?? 0) * 86_400 + Number(match[2] ?? 0) * 3_600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return new Date(Date.now() + Math.min(seconds, 31_536_000) * 1000);
      }
    }
    if (this.executionKindForStage(stage) !== 'timer_event') return new Date();
    throw new BadRequestException('Timer workflow stage requires a valid due date, duration, timeout, or SLA expiration');
  }

  private async enqueueStageExecution(
    client: Prisma.TransactionClient,
    task: { id: string; caseId: string },
    stage: WorkflowStageWithRoute,
    actor: string,
  ): Promise<void> {
    const config = this.executionConfigForStage(stage);
    const executionKind = this.executionKindForStage(stage);
    const maxAttempts = executionKind === 'timer_event'
      ? 1
      : Math.min(Math.max(Number(config['maxAttempts'] ?? 3), 1), 8);
    const nextAttemptAt = this.executionScheduleForStage(stage);
    await client.workflowExecutionAttempt.create({
      data: {
        idempotencyKey: `workflow:${task.caseId}:${stage.id}:${task.id}`,
        caseId: task.caseId,
        taskId: task.id,
        templateStageId: stage.id,
        executionKind,
        maxAttempts,
        nextAttemptAt,
        inputJson: config as Prisma.InputJsonValue,
        createdBy: actor,
      },
    });
    await client.workflowEvent.create({
      data: {
        caseId: task.caseId,
        taskId: task.id,
        actor,
        action: executionKind === 'timer_event' ? 'route.timer.scheduled' : 'route.automation.queued',
        comment: `${stage.nameEn} (${executionKind}) scheduled for ${nextAttemptAt.toISOString()}`,
      },
    });
  }

  /** Executes a bounded batch of durable system-node attempts. Claiming is
   * conditional, so concurrent API instances cannot process the same attempt. */
  async processRunnableExecutions(limit = 50): Promise<{ processed: number; succeeded: number; retried: number; failed: number; waiting: number }> {
    if (this.executionWorkerRunning) return { processed: 0, succeeded: 0, retried: 0, failed: 0, waiting: 0 };
    this.executionWorkerRunning = true;
    const summary = { processed: 0, succeeded: 0, retried: 0, failed: 0, waiting: 0 };
    try {
      const now = new Date();
      const attempts = await this.prisma.workflowExecutionAttempt.findMany({
        where: {
          OR: [
            { status: { in: ['queued', 'retrying'] }, nextAttemptAt: { lte: now } },
            { status: 'waiting_child' },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        take: Math.min(Math.max(limit, 1), 100),
        select: { id: true, status: true },
      });
      for (const attempt of attempts) {
        const result = attempt.status === 'waiting_child'
          ? await this.resumeSubWorkflowAttempt(attempt.id)
          : await this.claimAndExecuteAttempt(attempt.id);
        summary.processed += result.processed;
        summary.succeeded += result.succeeded;
        summary.retried += result.retried;
        summary.failed += result.failed;
        summary.waiting += result.waiting;
      }
    } catch (error) {
      this.logger.warn(`Workflow execution runner failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.executionWorkerRunning = false;
    }
    return summary;
  }

  private async executeConfiguredAutomation(
    attempt: { caseId: string; taskId: string },
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const validation = validateWorkflowAutomationConfig(config);
    if (!validation.valid || !validation.action) {
      throw new BadRequestException(`Invalid workflow automation configuration: ${validation.errors.join('; ')}`);
    }

    if (validation.action === 'invoke_connector') {
      const result = await this.integrations.executeWorkflowConnectorAction({
        connectorId: typeof config['connectorId'] === 'string' ? config['connectorId'] : null,
        connectorCode: typeof config['connectorCode'] === 'string' ? config['connectorCode'] : null,
        endpoint: config['endpoint'] === 'writeback' ? 'writeback' : 'health',
        payload: config['payload'],
      });
      return {
        action: validation.action,
        endpoint: result.endpoint,
        status: result.status,
        durationMs: result.durationMs,
      };
    }

    if (validation.action === 'set_runtime_variables') {
      const values = this.jsonRecord(config['values']);
      const tokens = await this.prisma.workflowRuntimeToken.findMany({
        where: { taskId: attempt.taskId, state: 'active' },
        select: { id: true, dataJson: true },
      });
      for (const token of tokens) {
        const data = this.jsonRecord(token.dataJson);
        await this.prisma.workflowRuntimeToken.update({
          where: { id: token.id },
          data: {
            dataJson: {
              ...data,
              variables: { ...this.jsonRecord(data['variables']), ...values },
            } as Prisma.InputJsonValue,
          },
        });
      }
      return { action: validation.action, updatedVariables: Object.keys(values).sort() };
    }

    const eventAction = String(config['eventAction']);
    await this.prisma.workflowEvent.create({
      data: {
        caseId: attempt.caseId,
        taskId: attempt.taskId,
        actor: 'system@workflow.dgop.local',
        action: `route.control.${eventAction}`,
        comment: typeof config['comment'] === 'string' ? config['comment'].slice(0, 500) : null,
      },
    });
    return { action: validation.action, eventAction };
  }

  private async claimAndExecuteAttempt(id: string): Promise<{ processed: number; succeeded: number; retried: number; failed: number; waiting: number }> {
    const claimed = await this.prisma.workflowExecutionAttempt.updateMany({
      where: { id, status: { in: ['queued', 'retrying'] }, nextAttemptAt: { lte: new Date() } },
      data: { status: 'running', startedAt: new Date(), attemptCount: { increment: 1 } },
    });
    if (!claimed.count) return { processed: 0, succeeded: 0, retried: 0, failed: 0, waiting: 0 };
    const attempt = await this.prisma.workflowExecutionAttempt.findUnique({
      where: { id },
      include: { task: { include: { case: true, templateStage: true } }, templateStage: true },
    });
    if (!attempt || !attempt.task.templateStage) return { processed: 1, succeeded: 0, retried: 0, failed: 1, waiting: 0 };
    if ((attempt.task.case.status as CaseStatus) === CASE_STATUS_SUSPENDED) {
      await this.prisma.workflowExecutionAttempt.update({
        where: { id },
        data: { status: 'paused', startedAt: null },
      });
      return { processed: 1, succeeded: 0, retried: 0, failed: 0, waiting: 1 };
    }
    const config = this.jsonRecord(attempt.inputJson);
    try {
      if (attempt.executionKind === 'sub_workflow') {
        const childTemplateId = typeof config['templateId'] === 'string' ? config['templateId'].trim() : '';
        if (!childTemplateId) throw new BadRequestException('Sub-workflow node requires automationConfig.templateId');
        const childTemplate = await this.prisma.workflowTemplate.findFirst({
          where: { id: childTemplateId, isActive: true, deletedAt: null },
          select: { id: true, caseType: true, nameEn: true },
        });
        if (!childTemplate) throw new BadRequestException('Configured sub-workflow template is not published');
        const child = await this.prisma.$transaction((tx) => this.openRoutedCaseWithClient(tx, {
          roleCodes: ADMIN_ROLES,
          actor: 'system@workflow.dgop.local',
          title: `${attempt.task.case.title}: ${childTemplate.nameEn}`,
          description: `Invoked by ${attempt.task.case.code} at stage ${attempt.templateStage.code}`,
          type: childTemplate.caseType,
          assetId: attempt.task.case.assetId,
          templateId: childTemplate.id,
          status: CaseStatus.submitted,
        }));
        await this.prisma.$transaction(async (tx) => {
          await tx.workflowExecutionAttempt.update({
            where: { id },
            data: { status: 'waiting_child', resultJson: { childCaseId: child.id, childCaseCode: child.code, parentCaseId: attempt.caseId, variableMapping: config['variableMapping'] ?? {} } as Prisma.InputJsonValue },
          });
          await tx.workflowEvent.create({ data: { caseId: attempt.caseId, taskId: attempt.taskId, actor: 'system@workflow.dgop.local', action: 'route.sub_workflow.started', comment: child.code } });
        });
        return { processed: 1, succeeded: 0, retried: 0, failed: 0, waiting: 1 };
      }
      const forcedFailure = config['simulateFailure'] === true || Number(config['failUntilAttempt'] ?? 0) >= attempt.attemptCount;
      if (forcedFailure) throw new Error('Configured automation failure for resilience validation');
      let result: Record<string, unknown> = { nodeType: attempt.executionKind };
      if (attempt.executionKind === 'notification_task') {
        await this.persistNodeNotification(attempt.id, attempt.caseId, attempt.taskId, attempt.templateStage, config);
        result = { ...result, action: 'send_notification' };
      } else if (attempt.executionKind === 'timer_event') {
        result = { ...result, action: 'timer_elapsed' };
      } else {
        result = { ...result, ...await this.executeConfiguredAutomation(attempt, config) };
      }
      const outcome = attempt.executionKind === 'timer_event' ? 'timeout' : 'approved';
      await this.completeExecutionAttempt(id, outcome, result);
      return { processed: 1, succeeded: 1, retried: 0, failed: 0, waiting: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retry = attempt.attemptCount < attempt.maxAttempts;
      const nextAttemptAt = new Date(Date.now() + Math.min(60_000 * 2 ** Math.max(attempt.attemptCount - 1, 0), 15 * 60_000));
      await this.prisma.$transaction(async (tx) => {
        await tx.workflowExecutionAttempt.update({
          where: { id },
          data: retry
            ? { status: 'retrying', nextAttemptAt, errorCode: 'execution_failed', errorMessage: message }
            : { status: 'failed', completedAt: new Date(), outcome: 'failed', errorCode: 'execution_failed', errorMessage: message },
        });
        await tx.workflowEvent.create({ data: { caseId: attempt.caseId, taskId: attempt.taskId, actor: 'system@workflow.dgop.local', action: retry ? 'route.automation.retry_scheduled' : 'route.automation.failed', comment: message } });
      });
      if (!retry) await this.completeExecutionAttempt(id, 'rejected', { errorCode: 'execution_failed' }, ['failed']);
      return { processed: 1, succeeded: 0, retried: retry ? 1 : 0, failed: retry ? 0 : 1, waiting: 0 };
    }
  }

  private async resumeSubWorkflowAttempt(id: string): Promise<{ processed: number; succeeded: number; retried: number; failed: number; waiting: number }> {
    const attempt = await this.prisma.workflowExecutionAttempt.findUnique({ where: { id } });
    const result = this.jsonRecord(attempt?.resultJson);
    const childCaseId = typeof result['childCaseId'] === 'string' ? result['childCaseId'] : null;
    if (!attempt || !childCaseId) return { processed: 0, succeeded: 0, retried: 0, failed: 0, waiting: 0 };
    const child = await this.prisma.workflowCase.findUnique({ where: { id: childCaseId }, select: { status: true } });
    if (!child || !FINAL_CASE_STATUSES.includes(child.status)) return { processed: 1, succeeded: 0, retried: 0, failed: 0, waiting: 1 };
    const outcome = child.status === CaseStatus.rejected ? 'rejected' : 'approved';
    const completed = await this.completeExecutionAttempt(
      id,
      outcome,
      { childCaseId, childStatus: child.status },
      ['waiting_child'],
    );
    if (!completed) return { processed: 0, succeeded: 0, retried: 0, failed: 0, waiting: 0 };
    return { processed: 1, succeeded: outcome === 'approved' ? 1 : 0, retried: 0, failed: outcome === 'rejected' ? 1 : 0, waiting: 0 };
  }

  private async persistNodeNotification(
    attemptId: string,
    caseId: string,
    taskId: string,
    stage: { nameEn: string; notificationRulesJson?: unknown | null },
    config: Record<string, unknown>,
  ): Promise<void> {
    const rules = Array.isArray(stage.notificationRulesJson) ? stage.notificationRulesJson : [];
    const firstRule = this.jsonRecord(rules[0]);
    const channels = Array.isArray(firstRule['channels']) ? firstRule['channels'] : [firstRule['channel'] ?? config['channel'] ?? 'in_app'];
    const validChannels = channels.map(String).filter((channel) => Object.values(GovernanceNotificationChannel).includes(channel as GovernanceNotificationChannel));
    await this.prisma.governanceNotification.create({
      data: {
        dedupeKey: `workflow-execution:${attemptId}`,
        title: String(config['title'] ?? `${stage.nameEn} completed`),
        message: String(config['message'] ?? `Workflow node ${stage.nameEn} completed successfully.`),
        severity: GovernanceNotificationSeverity.info,
        sourceType: 'workflow_execution',
        sourceId: attemptId,
        workflowCaseId: caseId,
        workflowTaskId: taskId,
        createdBy: 'system@workflow.dgop.local',
        deliveryAttempts: { create: (validChannels.length ? validChannels : ['in_app']).map((channel) => ({ channel: channel as GovernanceNotificationChannel, status: GovernanceNotificationDeliveryStatus.planned, provider: 'workflow_node', target: String(firstRule['audience'] ?? 'case_owner'), attemptCount: 0 })) },
      },
    });
  }

  private async completeExecutionAttempt(
    id: string,
    outcome: 'approved' | 'rejected' | 'timeout',
    result: Record<string, unknown>,
    expectedStatuses: string[] = ['running'],
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.workflowExecutionAttempt.updateMany({
        where: { id, status: { in: expectedStatuses } },
        data: { status: 'completing' },
      });
      if (claimed.count !== 1) return false;
      const attempt = await tx.workflowExecutionAttempt.findUnique({
        where: { id },
        include: { task: { include: { case: true, templateStage: true } }, templateStage: true },
      });
      if (!attempt || !attempt.task.templateStage) {
        throw new Error(`Workflow execution attempt ${id} is missing its routed task or template stage`);
      }
      if (attempt.task.status === TaskStatus.completed) {
        await tx.workflowExecutionAttempt.update({
          where: { id },
          data: {
            status: outcome === 'rejected' ? 'failed' : 'succeeded',
            completedAt: new Date(),
            outcome,
            resultJson: result as Prisma.InputJsonValue,
          },
        });
        return true;
      }
      const routePlan = await this.planRouteAdvance(tx, attempt.task, outcome as WorkflowDecisionValue);
      await tx.workflowTask.update({
        where: { id: attempt.taskId },
        data: { status: TaskStatus.completed, decision: outcome === 'timeout' ? null : outcome as TaskDecision, decisionComment: `System execution outcome: ${outcome}`, completedAt: new Date() },
      });
      await tx.workflowExecutionAttempt.update({
        where: { id },
        data: { status: outcome === 'rejected' ? 'failed' : 'succeeded', completedAt: new Date(), outcome, resultJson: result as Prisma.InputJsonValue },
      });
      const completionAction = attempt.executionKind === 'timer_event'
        ? 'route.timer.elapsed'
        : `route.automation.${outcome}`;
      await tx.workflowEvent.create({ data: { caseId: attempt.caseId, taskId: attempt.taskId, actor: 'system@workflow.dgop.local', action: completionAction, comment: attempt.templateStage.nameEn } });
      await this.completeRuntimeTokensForTask(tx, attempt.taskId);
      await this.applyRouteAdvance(tx, attempt.task, routePlan, 'system@workflow.dgop.local', outcome as WorkflowDecisionValue);
      await this.audit.log({ actor: 'system@workflow.dgop.local', action: 'workflow_execution.completed', entityType: 'workflow_execution_attempt', entityId: id, metadata: { caseId: attempt.caseId, taskId: attempt.taskId, outcome } }, tx);
      return true;
    });
  }

  private approvalExecutionConfig(stage: { gatewayConfigJson?: unknown | null; parallelGroup?: string | null; assigneeRoleCode?: string | null }) {
    const config = this.jsonRecord(stage.gatewayConfigJson);
    const roleCodes = this.stringArray(config['approverRoleCodes'] ?? config['parallelRoleCodes'] ?? config['sequentialRoleCodes'])
      .filter(Boolean);
    const rawMode = String(config['approvalMode'] ?? config['executionMode'] ?? '').toLowerCase();
    const mode =
      rawMode === 'parallel' || stage.parallelGroup ? 'parallel' :
      rawMode === 'sequential' ? 'sequential' :
      'single';
    return {
      mode: mode as 'single' | 'parallel' | 'sequential',
      roleCodes: roleCodes.length ? [...new Set(roleCodes)] : stage.assigneeRoleCode ? [stage.assigneeRoleCode] : [],
    };
  }

  private roleTitle(code: string): string {
    return code.split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  private async recordRuntimeTokenForTask(
    client: Prisma.TransactionClient,
    task: { id: string; caseId: string },
    stage: { id: string; code: string; parallelGroup?: string | null },
    actor: string,
    approvalMode?: string | null,
    approvalGroupId?: string | null,
    lineage: WorkflowTokenLineageContext = {},
  ): Promise<void> {
    const runtimeToken = (client as unknown as { workflowRuntimeToken?: { create: (args: unknown) => Promise<unknown> } }).workflowRuntimeToken;
    if (!runtimeToken) return;
    try {
      const joinStack = (lineage.joinStack ?? (lineage.joinKey ? [lineage.joinKey] : [])).filter(Boolean);
      const currentJoinKey = joinStack.at(-1) ?? null;
      await runtimeToken.create({
        data: {
          instanceKey: `${task.caseId}:${stage.id}:${task.id}`,
          caseId: task.caseId,
          taskId: task.id,
          templateStageId: stage.id,
          parentTokenId: lineage.parentTokenId ?? null,
          rootTokenId: lineage.rootTokenId ?? lineage.parentTokenId ?? null,
          branchKey: lineage.branchKey ?? null,
          branchIndex: lineage.branchIndex ?? null,
          joinKey: currentJoinKey,
          sourceTransitionId: lineage.sourceTransitionId ?? null,
          state: 'active',
          tokenType: approvalMode ? 'approval' : 'stage',
          parallelGroup: approvalGroupId ?? currentJoinKey ?? stage.parallelGroup ?? null,
          dataJson: {
            stageCode: stage.code,
            actor,
            approvalMode: approvalMode ?? null,
            parentTokenId: lineage.parentTokenId ?? null,
            rootTokenId: lineage.rootTokenId ?? lineage.parentTokenId ?? null,
            branchKey: lineage.branchKey ?? null,
            branchIndex: lineage.branchIndex ?? null,
            joinKey: currentJoinKey,
            joinStack,
            sourceTransitionId: lineage.sourceTransitionId ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
  }

  private async completeRuntimeTokensForTask(client: Prisma.TransactionClient, taskId: string): Promise<void> {
    const runtimeToken = (client as unknown as { workflowRuntimeToken?: { updateMany: (args: unknown) => Promise<unknown> } }).workflowRuntimeToken;
    if (!runtimeToken) return;
    await runtimeToken.updateMany({
      where: { taskId, state: 'active' },
      data: { state: 'completed', completedAt: new Date() },
    });
  }

  private async latestRuntimeTokenForTask(
    client: Prisma.TransactionClient,
    taskId?: string | null,
  ): Promise<{ id: string; rootTokenId: string | null; branchKey: string | null; joinKey: string | null; joinStack: string[] } | null> {
    if (!taskId) return null;
    const runtimeToken = (
      client as unknown as {
        workflowRuntimeToken?: {
          findFirst: (args: unknown) => Promise<{ id: string; rootTokenId: string | null; branchKey: string | null; joinKey: string | null; dataJson: Prisma.JsonValue | null } | null>;
        };
      }
    ).workflowRuntimeToken;
    if (!runtimeToken?.findFirst) return null;
    const token = await runtimeToken.findFirst({
      where: { taskId },
      orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, rootTokenId: true, branchKey: true, joinKey: true, dataJson: true },
    });
    if (!token) return null;
    const data = this.jsonRecord(token.dataJson);
    const configuredStack = Array.isArray(data['joinStack'])
      ? data['joinStack'].filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
      : [];
    return {
      id: token.id,
      rootTokenId: token.rootTokenId,
      branchKey: token.branchKey,
      joinKey: token.joinKey,
      joinStack: configuredStack.length ? configuredStack : token.joinKey ? [token.joinKey] : [],
    };
  }

  private averageHours(spans: Array<{ start: Date; end: Date }>): number {
    if (!spans.length) return 0;
    const totalMs = spans.reduce((sum, span) => sum + Math.max(0, span.end.getTime() - span.start.getTime()), 0);
    return Math.round((totalMs / spans.length / 3_600_000) * 10) / 10;
  }

  private countBy<T>(rows: T[], keyOf: (row: T) => string): Array<{ key: string; count: number }> {
    const buckets = new Map<string, number>();
    for (const row of rows) {
      const key = keyOf(row) || 'Unmapped';
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  private countTasksByStage(
    tasks: Array<{
      status: TaskStatus;
      dueDate: Date | null;
      createdAt: Date;
      completedAt: Date | null;
      wfCase: { template?: { nameEn: string } | null; type: string };
      templateStage?: { code: string; nameEn: string } | null;
    }>,
  ): Map<string, {
    stage: string;
    workflow: string;
    total: number;
    open: number;
    completed: number;
    overdue: number;
    completedSpans: Array<{ start: Date; end: Date }>;
  }> {
    const now = Date.now();
    const buckets = new Map<string, {
      stage: string;
      workflow: string;
      total: number;
      open: number;
      completed: number;
      overdue: number;
      completedSpans: Array<{ start: Date; end: Date }>;
    }>();
    for (const task of tasks) {
      const workflow = task.wfCase.template?.nameEn ?? task.wfCase.type;
      const stage = task.templateStage?.nameEn ?? task.templateStage?.code ?? task.status;
      const key = `${workflow}:${stage}`;
      const bucket = buckets.get(key) ?? { stage, workflow, total: 0, open: 0, completed: 0, overdue: 0, completedSpans: [] };
      bucket.total++;
      if (task.status === TaskStatus.pending || task.status === TaskStatus.in_progress) {
        bucket.open++;
        if (task.dueDate && task.dueDate.getTime() < now) bucket.overdue++;
      }
      if (task.completedAt) {
        bucket.completed++;
        bucket.completedSpans.push({ start: task.createdAt, end: task.completedAt });
      }
      buckets.set(key, bucket);
    }
    return buckets;
  }

  private jsonRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item).trim()).filter(Boolean);
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
        templateVersion: route?.template.designerVersion ?? 1,
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

  async updateCase(id: string, dto: UpdateCaseDto, roleCodes: string[], actor: string, viewer?: AuthUser) {
    const existing = await this.prisma.workflowCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(roleCodes, existing, viewer ?? actor);
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

  async controlCase(id: string, action: 'suspend' | 'resume' | 'cancel', dto: WorkflowCaseControlDto, user: AuthUser) {
    const existing = await this.prisma.workflowCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(user.roles, existing, user);
    const currentStatus = existing.status as CaseStatus;
    const reason = dto.reason?.trim() ?? '';
    if ((action === 'suspend' || action === 'cancel') && !reason) {
      throw new BadRequestException(`Workflow ${action} requires a reason`);
    }
    if (action === 'suspend') {
      this.assertCaseCanChange(currentStatus);
      if (currentStatus === CASE_STATUS_SUSPENDED) throw new BadRequestException('Workflow case is already suspended');
    }
    if (action === 'resume' && currentStatus !== CASE_STATUS_SUSPENDED) {
      throw new BadRequestException('Only suspended workflow cases can be resumed');
    }
    if (action === 'cancel' && FINAL_CASE_STATUSES.includes(currentStatus)) {
      throw new BadRequestException('Final workflow cases cannot be cancelled');
    }

    const previous = action === 'resume'
      ? await this.prisma.workflowEvent.findFirst({
        where: { caseId: id, action: 'case.control.suspend' },
        orderBy: { createdAt: 'desc' },
        select: { fromStatus: true },
      })
      : null;
    const resumeStatus = this.resumeStatusFromSuspension(previous?.fromStatus);
    const nextStatus =
      action === 'suspend'
        ? CASE_STATUS_SUSPENDED
        : action === 'cancel'
          ? CASE_STATUS_CANCELLED
          : resumeStatus;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.workflowCase.update({
        where: { id },
        data: { status: nextStatus },
        include: caseInclude,
      });
      if (action === 'suspend') {
        await tx.workflowRuntimeToken.updateMany({
          where: { caseId: id, state: { in: ['active', 'waiting', 'queued'] } },
          data: { state: 'suspended' },
        });
        await tx.workflowExecutionAttempt.updateMany({
          where: { caseId: id, status: { in: ['queued', 'retrying', 'running', 'waiting_child'] } },
          data: { status: 'paused' },
        });
      } else if (action === 'resume') {
        await tx.workflowRuntimeToken.updateMany({
          where: { caseId: id, state: 'suspended' },
          data: { state: 'active' },
        });
        await tx.workflowExecutionAttempt.updateMany({
          where: { caseId: id, status: 'paused' },
          data: { status: 'queued', nextAttemptAt: new Date() },
        });
      } else {
        const now = new Date();
        await tx.workflowTask.updateMany({
          where: { caseId: id, status: { in: [TaskStatus.pending, TaskStatus.in_progress] } },
          data: { status: TaskStatus.cancelled, completedAt: now, decisionComment: reason },
        });
        await tx.workflowRuntimeToken.updateMany({
          where: { caseId: id, completedAt: null },
          data: { state: 'cancelled', completedAt: now },
        });
        await tx.workflowExecutionAttempt.updateMany({
          where: { caseId: id, status: { notIn: ['succeeded', 'failed', 'cancelled'] } },
          data: { status: 'cancelled', completedAt: now, outcome: 'cancelled', resultJson: { reason } as Prisma.InputJsonValue },
        });
      }
      await tx.workflowEvent.create({
        data: {
          caseId: id,
          actor: user.email,
          action: `case.control.${action}`,
          fromStatus: currentStatus,
          toStatus: nextStatus,
          comment: reason || (action === 'resume' ? 'Workflow execution resumed from suspended state.' : null),
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: `workflow_case.${action}`,
          entityType: 'workflow_case',
          entityId: id,
          metadata: { fromStatus: currentStatus, toStatus: nextStatus, reason: reason || null },
        },
        tx,
      );
      return row;
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
      await this.assertCaseVisible(input.roleCodes, existing, input.actor, writer);

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
      decision: WorkflowDecisionValue;
      comment?: string | null;
      eventAction: string;
    },
    client?: Prisma.TransactionClient,
  ) {
    const run = async (writer: Prisma.TransactionClient) => {
      const task = await writer.workflowTask.findUnique({
        where: { id: input.taskId },
        include: { case: true, templateStage: { select: decisionStageSelect } },
      });
      if (!task) throw new NotFoundException('workflow task not found');
      await this.assertCaseVisible(input.roleCodes, task.case, input.actor, writer);
      this.assertCaseCanChange(task.case.status);
      if (task.status === TaskStatus.completed || task.status === TaskStatus.cancelled) {
        throw new BadRequestException('This task has already been decided');
      }

      await this.assertStageDecisionPrerequisites(writer, task, input.decision, input.comment);
      const routePlan = await this.planRouteAdvance(writer, task, input.decision);
      const claim = await writer.workflowTask.updateMany({
        where: { id: input.taskId, status: { in: [TaskStatus.pending, TaskStatus.in_progress] } },
        data: {
          status: TaskStatus.completed,
          decision: input.decision === WORKFLOW_RETURN_FOR_CLARIFICATION ? null : input.decision as TaskDecision,
          decisionComment: input.comment ?? null,
          completedAt: new Date(),
        },
      });
      if (claim.count !== 1) throw new ConflictException('This task was decided by another user');
      const decided = await writer.workflowTask.findUnique({ where: { id: input.taskId }, include: taskInclude });
      if (!decided) throw new NotFoundException('workflow task not found after decision');
      await writer.workflowEvent.create({
        data: {
          caseId: task.caseId,
          taskId: input.taskId,
          actor: input.actor,
          action: input.eventAction,
          comment: input.comment ?? null,
        },
      });
      await this.completeRuntimeTokensForTask(writer, input.taskId);
      const openedSequentialApproval = await this.maybeCreateNextSequentialApproval(writer, task, input.actor);
      if (openedSequentialApproval) {
        await writer.workflowEvent.create({
          data: {
            caseId: task.caseId,
            taskId: input.taskId,
            actor: input.actor,
            action: 'route.sequential_approval.waiting',
            comment: 'Next approval step opened in the same stage.',
          },
        });
      } else if (await this.hasOpenStagePeers(writer, task.caseId, task.templateStageId, input.taskId)) {
        await writer.workflowEvent.create({
          data: {
            caseId: task.caseId,
            taskId: input.taskId,
            actor: input.actor,
            action: 'route.parallel_approval.waiting',
            comment: 'Waiting for remaining approval tasks in this stage.',
          },
        });
      } else {
        await this.applyRouteAdvance(writer, task, routePlan, input.actor, input.decision);
      }
      await this.audit.log(
        {
          actor: input.actor,
          action: 'workflow_task.domain_decision',
          entityType: 'workflow_task',
          entityId: input.taskId,
          metadata: {
            eventAction: input.eventAction,
            decision: input.decision,
            stageCode: task.templateStage?.code ?? null,
            routeTransitionId: routePlan?.transition?.id ?? null,
          },
        },
        writer,
      );
      return this.withSla(decided);
    };
    if (client) return run(client);
    return this.prisma.$transaction((tx) => run(tx));
  }

  async submitCase(id: string, roleCodes: string[], actor: string, viewer?: AuthUser) {
    const existing = await this.prisma.workflowCase.findUnique({
      where: { id },
      include: { tasks: true },
    });
    if (!existing) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(roleCodes, existing, viewer ?? actor);
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
  async addTask(caseId: string, dto: AddTaskDto, roleCodes: string[], actor: string, viewer?: AuthUser) {
    const wfCase = await this.prisma.workflowCase.findUnique({ where: { id: caseId } });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    await this.assertCaseVisible(roleCodes, wfCase, viewer ?? actor);
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

  async updateTask(id: string, dto: UpdateTaskDto, roleCodes: string[], actor: string, viewer?: AuthUser) {
    const existing = await this.prisma.workflowTask.findUnique({ where: { id }, include: { case: true } });
    if (!existing) throw new NotFoundException('workflow task not found');
    await this.assertCaseVisible(roleCodes, existing.case, viewer ?? actor);
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

  private async editableTaskForForm(id: string, user: AuthUser) {
    const task = await this.prisma.workflowTask.findUnique({
      where: { id },
      include: { case: true, templateStage: { select: decisionStageSelect } },
    });
    if (!task) throw new NotFoundException('workflow task not found');
    await this.assertCaseVisible(user.roles, task.case, user);
    this.assertCaseCanChange(task.case.status);
    if (task.status === TaskStatus.completed || task.status === TaskStatus.cancelled) {
      throw new BadRequestException('A completed or cancelled task cannot receive form data');
    }
    const isAdmin = user.roles.some((role) => ADMIN_ROLES.includes(role));
    const queueRole = task.assigneeRoleCode ?? task.templateStage?.assigneeRoleCode ?? null;
    if (!isAdmin && task.assigneeUserId !== user.id && !(queueRole && user.roles.includes(queueRole))) {
      throw new ForbiddenException('Only the task assignee or owning role queue can edit this form');
    }
    return task;
  }

  async saveTaskFormDraft(id: string, dto: SaveWorkflowTaskFormDraftDto, user: AuthUser) {
    const task = await this.editableTaskForForm(id, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.workflowTask.update({
        where: { id },
        data: {
          formDataJson: dto.data as Prisma.InputJsonValue,
          formSubmittedAt: null,
          formSubmittedBy: null,
        },
        include: taskInclude,
      });
      await tx.workflowEvent.create({
        data: {
          caseId: task.caseId,
          taskId: id,
          actor: user.email,
          action: 'task.form.draft_saved',
          comment: task.templateStage?.nameEn ?? task.title,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_task.form.draft.save',
          entityType: 'workflow_task',
          entityId: id,
          metadata: {
            stageCode: task.templateStage?.code ?? null,
            fieldCount: Object.keys(dto.data).length,
            previousSubmittedAt: task.formSubmittedAt?.toISOString?.() ?? null,
          },
        },
        tx,
      );
      return saved;
    });
    return this.withSla(updated);
  }

  async submitTaskForm(id: string, dto: SubmitWorkflowTaskFormDto, user: AuthUser) {
    const task = await this.editableTaskForForm(id, user);
    const validation = validateWorkflowFormData(task.templateStage?.formSchemaJson, dto.data);
    if (!validation.valid) {
      const detail = [...validation.missing.map((field) => `Missing ${field}`), ...validation.errors].join('; ');
      throw new BadRequestException(`The workflow form is not complete yet. ${detail}`);
    }
    const validatedFields = workflowFormRequiredFields(task.templateStage?.formSchemaJson);
    const attachmentFields = workflowFormAttachmentFieldNames(task.templateStage?.formSchemaJson);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.workflowTask.update({
        where: { id },
        data: {
          formDataJson: dto.data as Prisma.InputJsonValue,
          formSubmittedAt: new Date(),
          formSubmittedBy: user.email,
        },
        include: taskInclude,
      });
      await tx.workflowEvent.create({
        data: {
          caseId: task.caseId,
          taskId: id,
          actor: user.email,
          action: 'task.form.submitted',
          comment: task.templateStage?.nameEn ?? task.title,
        },
      });
      await this.audit.log(
        {
          actor: user.email,
          action: 'workflow_task.form.submit',
          entityType: 'workflow_task',
          entityId: id,
          metadata: {
            stageCode: task.templateStage?.code ?? null,
            validatedFields,
            attachmentFields,
            previousSubmittedAt: task.formSubmittedAt?.toISOString?.() ?? null,
            newSubmittedAt: saved.formSubmittedAt?.toISOString?.() ?? null,
          },
        },
        tx,
      );
      return saved;
    });
    return this.withSla(updated);
  }

  async listMyTasks(user: AuthUser, filters: { status?: string; page?: string | number; pageSize?: string | number }) {
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
    const where: Prisma.WorkflowTaskWhereInput = {
      OR: ownership,
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

  async getTask(id: string, roleCodes: string[], viewer?: AuthUser) {
    const task = await this.prisma.workflowTask.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        case: { select: { id: true, code: true, title: true, type: true, status: true, assetId: true } },
      },
    });
    if (!task) throw new NotFoundException('workflow task not found');
    await this.assertCaseVisible(roleCodes, task.case, viewer);
    return this.withSla(task);
  }

  private caseStatusForActiveStage(stage: WorkflowStageWithRoute): CaseStatus {
    if (stage.isFinal || stage.kind === 'implementation') return CaseStatus.approved;
    return CaseStatus.under_review;
  }

  private isPassThroughStage(stage: WorkflowStageWithRoute): boolean {
    return isAutomatedWorkflowStage(stage) || isRoutingOnlyWorkflowStage(stage);
  }

  private isParallelGatewayStage(stage: WorkflowStageWithRoute): boolean {
    return String(stage.nodeType ?? '').toLowerCase() === 'parallel_gateway';
  }

  private isMergeGatewayStage(stage: WorkflowStageWithRoute): boolean {
    const nodeType = String(stage.nodeType ?? '').toLowerCase();
    return nodeType === 'merge_gateway' || nodeType === 'inclusive_gateway';
  }

  private parallelBranchesForGateway(
    template: WorkflowTemplateWithRoute,
    gateway: WorkflowStageWithRoute,
    task: {
      id?: string | null;
      dueDate?: Date | null;
      formDataJson?: unknown | null;
      case: { id: string; status: CaseStatus; type?: string | null; assetId?: string | null };
    },
    decision: WorkflowDecisionValue,
  ): NonNullable<RouteAdvancePlan['parallelBranches']> {
    const outgoing = template.transitions
      .filter((transition) => transition.fromStageId === gateway.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const joinGroup = gateway.parallelGroup ?? `join:${gateway.id}`;
    const joinKey = `${joinGroup}:instance:${task.id ?? task.case.id}`;
    return outgoing.flatMap((transition, index) => {
      const stage = this.firstActionableAfterTransition(template, transition, task, decision);
      if (!stage) return [];
      return [{
        stage,
        transition,
        branchKey: `${joinKey}:branch:${index + 1}`,
        branchIndex: index + 1,
        joinKey,
      }];
    });
  }

  private firstActionableAfterTransition(
    template: WorkflowTemplateWithRoute,
    transition: WorkflowTransitionWithRoute,
    task: {
      dueDate?: Date | null;
      formDataJson?: unknown | null;
      case: { id: string; status: CaseStatus; type?: string | null; assetId?: string | null };
    },
    decision: WorkflowDecisionValue,
  ): WorkflowStageWithRoute | null {
    const stageById = new Map(template.stages.map((stage) => [stage.id, stage]));
    let candidate = stageById.get(transition.toStageId) ?? null;
    let guard = 0;
    while (candidate && !isActionableWorkflowStage(candidate)) {
      guard++;
      if (guard > 25 || candidate.isFinal || this.isMergeGatewayStage(candidate)) return null;
      const next = this.selectTransitionWithDmn(template.transitions, candidate, task, decision);
      if (!next) return null;
      candidate = stageById.get(next.toStageId) ?? null;
    }
    return candidate;
  }

  private async hasOpenIncomingMergeTasks(
    client: Prisma.TransactionClient,
    caseId: string,
    template: WorkflowTemplateWithRoute,
    mergeStage: WorkflowStageWithRoute,
    currentTaskId?: string | null,
    completedMergeDepth = 0,
  ): Promise<boolean> {
    const currentToken = await this.latestRuntimeTokenForTask(client, currentTaskId);
    const activeJoinKey = currentToken?.joinStack.at(-(completedMergeDepth + 1)) ?? null;
    if (activeJoinKey && currentToken) {
      const activeSiblingTokens = await client.workflowRuntimeToken.count({
        where: {
          caseId,
          joinKey: activeJoinKey,
          state: 'active',
          id: { not: currentToken.id },
        },
      });
      return activeSiblingTokens > 0;
    }

    // Compatibility path for cases created before durable runtime tokens were
    // introduced. New route instances always synchronize through joinKey.
    const incomingStageIds = template.transitions
      .filter((transition) => transition.toStageId === mergeStage.id)
      .map((transition) => transition.fromStageId);
    if (!incomingStageIds.length) return false;
    const openTasks = await client.workflowTask.count({
      where: {
        caseId,
        templateStageId: { in: incomingStageIds },
        ...(currentTaskId ? { id: { not: currentTaskId } } : {}),
        status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      },
    });
    return openTasks > 0;
  }

  private finalStatusForDecision(decision: WorkflowDecisionValue): CaseStatus {
    if (decision === WORKFLOW_RETURN_FOR_CLARIFICATION) return CaseStatus.awaiting_information;
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

  private async hasOpenStagePeers(
    client: Prisma.TransactionClient,
    caseId: string,
    templateStageId: string | null,
    taskId: string,
  ): Promise<boolean> {
    if (!templateStageId) return false;
    const openPeerTasks = await client.workflowTask.count({
      where: {
        caseId,
        templateStageId,
        id: { not: taskId },
        status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      },
    });
    return openPeerTasks > 0;
  }

  private async maybeCreateNextSequentialApproval(
    client: Prisma.TransactionClient,
    task: {
      id: string;
      caseId: string;
      assigneeRoleCode?: string | null;
      approvalGroupId?: string | null;
      templateStageId: string | null;
      case: { assetId?: string | null };
      templateStage?: { gatewayConfigJson?: unknown | null; assigneeRoleCode?: string | null } | null;
    },
    actor: string,
  ): Promise<boolean> {
    if (!task.templateStageId) return false;
    const config = this.approvalExecutionConfig({
      gatewayConfigJson: task.templateStage?.gatewayConfigJson,
      assigneeRoleCode: task.templateStage?.assigneeRoleCode,
    });
    if (config.mode !== 'sequential' || config.roleCodes.length < 2) return false;
    const currentRole = task.assigneeRoleCode ?? task.templateStage?.assigneeRoleCode ?? config.roleCodes[0];
    const currentIndex = config.roleCodes.indexOf(currentRole);
    const nextRoleCode = config.roleCodes[currentIndex + 1];
    if (!nextRoleCode) return false;
    const openNext = await client.workflowTask.count({
      where: {
        caseId: task.caseId,
        templateStageId: task.templateStageId,
        assigneeRoleCode: nextRoleCode,
        status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      },
    });
    if (openNext > 0) return true;
    const stage = await client.workflowTemplateStage.findUnique({ where: { id: task.templateStageId } });
    if (!stage) return false;
    await this.createSingleStageTask(client, task.caseId, stage, actor, {
      assetId: task.case.assetId ?? null,
      assigneeRoleCode: nextRoleCode,
      approvalGroupId: task.approvalGroupId ?? randomUUID(),
      approvalMode: 'sequential',
      title: `${stage.nameEn} - ${this.roleTitle(nextRoleCode)}`,
    });
    return true;
  }

  private async openClarificationTask(
    client: Prisma.TransactionClient,
    task: {
      id: string;
      caseId: string;
      title: string;
      case: { createdBy: string; status: CaseStatus; assetId?: string | null };
    },
    actor: string,
    comment?: string | null,
  ): Promise<void> {
    const submitter = await client.user.findFirst({
      where: { email: task.case.createdBy, isActive: true },
      select: { id: true },
    });
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 2);
    await client.workflowTask.create({
      data: {
        caseId: task.caseId,
        title: `Clarification requested - ${task.title}`,
        type: 'information',
        status: TaskStatus.pending,
        assigneeUserId: submitter?.id ?? null,
        dueDate,
      },
    });
    if (task.case.status !== CaseStatus.awaiting_information) {
      await client.workflowCase.update({
        where: { id: task.caseId },
        data: { status: CaseStatus.awaiting_information },
      });
      await client.workflowEvent.create({
        data: {
          caseId: task.caseId,
          actor,
          action: 'case.status',
          fromStatus: task.case.status,
          toStatus: CaseStatus.awaiting_information,
          comment: 'Approval returned for clarification',
        },
      });
    }
    await client.workflowEvent.create({
      data: {
        caseId: task.caseId,
        taskId: task.id,
        actor,
        action: 'decision.return_for_clarification',
        comment: comment ?? null,
      },
    });
  }

  private async assertStageDecisionPrerequisites(
    client: Prisma.TransactionClient,
    task: {
      id: string;
      caseId: string;
      formDataJson?: unknown | null;
      formSubmittedAt?: Date | null;
      templateStage?: {
        code: string;
        nameEn: string;
        evidenceRequirementsJson?: unknown | null;
        formSchemaJson?: unknown | null;
      } | null;
    },
    decision: WorkflowDecisionValue,
    comment?: string | null,
  ): Promise<void> {
    if (decision === WORKFLOW_RETURN_FOR_CLARIFICATION && !comment?.trim()) {
      throw new BadRequestException('Return for clarification requires a decision comment');
    }
    if (decision !== TaskDecision.approved || !task.templateStage) return;

    const requiredEvidence = this.requiredRequirementNames(task.templateStage.evidenceRequirementsJson);
    if (requiredEvidence.length > 0) {
      const evidenceCount = await client.workflowTaskAttachment.count({
        where: {
          caseId: task.caseId,
          OR: [{ taskId: task.id }, { taskId: null }],
          kind: { in: [WorkflowAttachmentKind.evidence, WorkflowAttachmentKind.decision_note, WorkflowAttachmentKind.supporting_document] },
        },
      });
      if (evidenceCount === 0) {
        throw new BadRequestException(
          `Before approving ${task.templateStage.nameEn}, attach the required evidence: ${requiredEvidence.join(', ')}.`,
        );
      }
    }

    const requiredFields = workflowFormRequiredFields(task.templateStage.formSchemaJson);
    if (requiredFields.length > 0) {
      if (!task.formSubmittedAt) {
        throw new BadRequestException(
          `Before approving ${task.templateStage.nameEn}, submit the completed task form from the workflow inbox.`,
        );
      }
      const validation = validateWorkflowFormData(task.templateStage.formSchemaJson, task.formDataJson);
      if (!validation.valid) {
        const missing = validation.missing.length ? validation.missing.join(', ') : validation.errors.join(', ');
        throw new BadRequestException(
          `Before approving ${task.templateStage.nameEn}, complete the required form fields: ${missing}.`,
        );
      }
    } else if (this.requiredRequirementNames(task.templateStage.formSchemaJson).length > 0 && !comment?.trim()) {
      throw new BadRequestException(
        `Before approving ${task.templateStage.nameEn}, add a decision comment covering the required fields.`,
      );
    }
  }

  private requiredRequirementNames(value: unknown | null | undefined): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        if (typeof item === 'string') return [item];
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        if (row['required'] !== true) return [];
        return [String(row['name'] ?? row['code'] ?? row['field'] ?? 'required item')];
      });
    }
    if (typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (Array.isArray(row['required'])) {
      return row['required'].map((item) => String(item)).filter(Boolean);
    }
    if (row['required'] === true) {
      return [String(row['name'] ?? row['code'] ?? row['field'] ?? 'required item')];
    }
    return [];
  }

  private selectTransitionWithDmn(
    transitions: WorkflowTransitionWithRoute[],
    fromStage: WorkflowStageWithRoute,
    task: {
      dueDate?: Date | null;
      formDataJson?: unknown | null;
      case: {
        id: string;
        status: CaseStatus;
        type?: string | null;
        assetId?: string | null;
        asset?: { assetType?: string | null } | null;
      };
    },
    decision: WorkflowDecisionValue,
  ): WorkflowTransitionWithRoute | null {
    const outgoing = transitions.filter((transition) => transition.fromStageId === fromStage.id);
    const defaultPath = outgoing.find(isWorkflowDefaultPath) ?? null;
    if ((decision as string) === 'timeout') {
      return outgoing.find((transition) => normalizeWorkflowConnectorType(transition.connectorType) === 'timeout') ?? defaultPath;
    }
    if (fromStage.isDecision && outgoing.length > 1 && !defaultPath) {
      throw new BadRequestException(`Decision gateway ${fromStage.code} must define a default connector path`);
    }
    const formValidation = validateWorkflowFormData(fromStage.formSchemaJson, task.formDataJson);
    const context = buildWorkflowVariableContext({
      decision,
      caseId: task.case.id,
      caseStatus: task.case.status,
      caseType: task.case.type ?? null,
      assetId: task.case.assetId ?? null,
      assetType: task.case.asset?.assetType ?? null,
      stageCode: fromStage.code,
      stageKind: fromStage.kind,
      formRequiredComplete: formValidation.valid,
      taskSlaDueDate: task.dueDate ?? null,
      formData: task.formDataJson ?? null,
    });
    for (const transition of outgoing) {
      if (!transition.conditionJson) continue;
      const result = evaluateWorkflowDmnTable(transition.conditionJson, context);
      if (!result.matched) continue;
      if (result.targetStageCode && transition.toStage?.code === result.targetStageCode) return transition;
      if (result.decision && (transition.decision === result.decision || result.decision === decision)) return transition;
      if (!result.targetStageCode && !result.decision) return transition;
    }
    const stageDecision = evaluateWorkflowDmnTable(fromStage.gatewayConfigJson, context);
    if (stageDecision.matched) {
      const selected = outgoing.find((transition) =>
        (stageDecision.targetStageCode && transition.toStage?.code === stageDecision.targetStageCode) ||
        (stageDecision.decision && transition.decision === stageDecision.decision),
      );
      if (selected) return selected;
    }
    return selectWorkflowTransitionForDecision(transitions, fromStage.id, decision) ?? defaultPath;
  }

  private async planRouteAdvance(
    client: Prisma.TransactionClient,
    task: {
      id?: string | null;
      templateStageId: string | null;
      dueDate?: Date | null;
      formDataJson?: unknown | null;
      case: { id: string; templateId: string | null; templateVersion: number; status: CaseStatus; type?: string | null; assetId?: string | null };
    },
    decision: WorkflowDecisionValue,
  ): Promise<RouteAdvancePlan | null> {
    if (!task.templateStageId || !task.case.templateId) return null;
    const template = await client.workflowTemplate.findUnique({
      where: { id: task.case.templateId },
      include: templateInclude,
    });
    if (!template) return null;
    const runtimeTemplate = await this.runtimeTemplateForCase(client, template, task.case.templateVersion);
    const fromStage = runtimeTemplate.stages.find((stage) => stage.id === task.templateStageId);
    if (!fromStage) return null;
    const transition = this.selectTransitionWithDmn(runtimeTemplate.transitions, fromStage, task, decision);
    if (!transition) {
      if (fromStage.isFinal) {
        return { fromStage, finalStatus: this.finalStatusForDecision(decision) };
      }
      if (decision === TaskDecision.rejected) {
        throw new BadRequestException('This route stage does not support rejection');
      }
      throw new BadRequestException('No next workflow route transition is configured for this stage');
    }
    const nextStage = runtimeTemplate.stages.find((stage) => stage.id === transition.toStageId);
    if (!nextStage) {
      throw new BadRequestException('The next workflow route stage is not configured');
    }
    const passThroughStages: WorkflowStageWithRoute[] = [];
    let completedMergeDepth = 0;
    let candidateStage = nextStage;
    let candidateTransition: WorkflowTransitionWithRoute | null = transition;
    let guard = 0;
    while (!isActionableWorkflowStage(candidateStage)) {
      guard++;
      if (guard > 25) throw new BadRequestException('Workflow route contains too many automated routing steps');
      if (candidateStage.isFinal) {
        return {
          fromStage,
          transition: candidateTransition,
          passThroughStages,
          finalStatus: this.finalStatusForDecision(decision),
        };
      }
      // Advanced nodes are durable system work, not implicit pass-through steps.
      // The execution runner decides the success, failure, or timeout connector.
      if (isAutomatedWorkflowStage(candidateStage)) {
        return {
          fromStage,
          transition: candidateTransition,
          passThroughStages,
          nextStage: candidateStage,
          toStatus: this.caseStatusForActiveStage(candidateStage),
        };
      }
      if (!this.isPassThroughStage(candidateStage)) {
        throw new BadRequestException('The next workflow route stage cannot create a task');
      }
      if (this.isParallelGatewayStage(candidateStage)) {
        passThroughStages.push(candidateStage);
        const branches = this.parallelBranchesForGateway(runtimeTemplate, candidateStage, task, decision);
        if (branches.length < 2) {
          throw new BadRequestException(`Parallel gateway ${candidateStage.code} must define at least two branch connector paths`);
        }
        return {
          fromStage,
          transition,
          passThroughStages,
          parallelBranches: branches,
          toStatus: this.caseStatusForActiveStage(branches[0].stage),
        };
      }
      if (this.isMergeGatewayStage(candidateStage)) {
        if (await this.hasOpenIncomingMergeTasks(client, task.case.id, runtimeTemplate, candidateStage, task.id ?? null, completedMergeDepth)) {
          return {
            fromStage,
            transition: candidateTransition,
            passThroughStages,
            mergeWaitStage: candidateStage,
          };
        }
        completedMergeDepth++;
      }
      passThroughStages.push(candidateStage);
      const nextTransition = this.selectTransitionWithDmn(runtimeTemplate.transitions, candidateStage, task, decision);
      if (!nextTransition) throw new BadRequestException('Automated workflow stage has no next route transition');
      const afterPassThrough = runtimeTemplate.stages.find((stage) => stage.id === nextTransition.toStageId);
      if (!afterPassThrough) throw new BadRequestException('Automated workflow stage points to a missing next stage');
      candidateTransition = nextTransition;
      candidateStage = afterPassThrough;
    }
    return {
      fromStage,
      transition,
      passThroughStages,
      nextStage: candidateStage,
      toStatus: this.caseStatusForActiveStage(candidateStage),
    };
  }

  private async runtimeTemplateForCase(
    client: Prisma.TransactionClient,
    template: WorkflowTemplateWithRoute,
    templateVersion: number,
  ): Promise<WorkflowTemplateWithRoute> {
    if (!templateVersion || templateVersion === template.designerVersion) return template;
    const snapshot = await client.workflowTemplateVersion.findFirst({
      where: { templateId: template.id, version: templateVersion },
      select: { bpmnXml: true },
    });
    if (!snapshot) {
      this.logger.warn(`Workflow case references missing ${template.code} version ${templateVersion}; using current route`);
      return template;
    }
    const parsed = this.parseDesignerBpmn(snapshot.bpmnXml);
    const databaseStageByCode = new Map(template.stages.map((stage) => [stage.code, stage]));
    if (parsed.stages.some((stage) => !databaseStageByCode.has(stage.code))) {
      this.logger.warn(`Workflow ${template.code} version ${templateVersion} contains a stage no longer present in the route registry`);
      return template;
    }
    const stages = parsed.stages.map((stage) => {
      const databaseStage = databaseStageByCode.get(stage.code)!;
      return {
        ...databaseStage,
        ...stage,
        id: databaseStage.id,
        templateId: template.id,
        nodeType: stage.nodeType ?? databaseStage.nodeType,
        assignmentStrategy: stage.assignmentStrategy ?? databaseStage.assignmentStrategy,
        isActive: true,
        retiredAt: null,
        retiredBy: null,
      };
    });
    const stageByCode = new Map(stages.map((stage) => [stage.code, stage]));
    const transitions = parsed.transitions.flatMap((edge, index) => {
      const fromStage = stageByCode.get(edge.fromStageId);
      const toStage = stageByCode.get(edge.toStageId);
      if (!fromStage || !toStage) return [];
      const current = template.transitions.find((candidate) =>
        candidate.fromStageId === fromStage.id && candidate.toStageId === toStage.id &&
        (candidate.decision ?? null) === (edge.decision ?? null));
      return [{
        ...(current ?? {}),
        id: current?.id ?? `snapshot:${template.id}:${templateVersion}:${index + 1}`,
        templateId: template.id,
        fromStageId: fromStage.id,
        toStageId: toStage.id,
        labelEn: edge.labelEn,
        labelAr: edge.labelAr,
        connectorType: edge.connectorType ?? 'sequence',
        decision: edge.decision ?? null,
        conditionExpression: edge.conditionExpression ?? null,
        conditionJson: edge.conditionJson ?? null,
        isDefaultPath: edge.isDefaultPath ?? false,
        timeoutAfterSeconds: edge.timeoutAfterSeconds ?? null,
        sortOrder: edge.sortOrder,
        isHappyPath: edge.isHappyPath,
        isActive: true,
        retiredAt: null,
        retiredBy: null,
        fromStage: { id: fromStage.id, code: fromStage.code },
        toStage: { id: toStage.id, code: toStage.code },
      }];
    });
    return { ...template, stages, transitions } as unknown as WorkflowTemplateWithRoute;
  }

  private async applyRouteAdvance(
    client: Prisma.TransactionClient,
    task: { id?: string | null; caseId: string; case: { status: CaseStatus; assetId?: string | null } },
    plan: RouteAdvancePlan | null,
    actor: string,
    decision: WorkflowDecisionValue,
  ): Promise<void> {
    if (!plan) return;
    const targetStageName = plan.nextStage?.nameEn ??
      (plan.parallelBranches?.length ? `${plan.parallelBranches.length} parallel branches` : null) ??
      plan.mergeWaitStage?.nameEn ??
      plan.transition?.toStage?.code ??
      'Route complete';
    const parentToken = await this.latestRuntimeTokenForTask(client, task.id ?? null);
    const completedMergeCount = (plan.passThroughStages ?? []).filter((stage) => this.isMergeGatewayStage(stage)).length;
    const continuationJoinStack = completedMergeCount
      ? (parentToken?.joinStack ?? []).slice(0, -completedMergeCount)
      : parentToken?.joinStack ?? [];
    const baseLineage: WorkflowTokenLineageContext = {
      parentTokenId: parentToken?.id ?? null,
      rootTokenId: parentToken?.rootTokenId ?? parentToken?.id ?? null,
      branchKey: parentToken?.branchKey ?? null,
      joinKey: continuationJoinStack.at(-1) ?? null,
      joinStack: continuationJoinStack,
      sourceTransitionId: plan.transition?.id ?? null,
    };
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
    if (plan.mergeWaitStage) {
      await client.workflowEvent.create({
        data: {
          caseId: task.caseId,
          actor,
          action: 'route.merge.waiting',
          comment: `Waiting for all incoming branches before ${plan.mergeWaitStage.nameEn}`,
        },
      });
      return;
    }
    for (const stage of plan.passThroughStages ?? []) {
      await client.workflowEvent.create({
        data: {
          caseId: task.caseId,
          actor,
          action: isAutomatedWorkflowStage(stage) ? 'route.automation.completed' : 'route.gateway.evaluated',
          comment: stage.nameEn,
        },
      });
    }
    if (plan.parallelBranches?.length) {
      await client.workflowEvent.create({
        data: {
          caseId: task.caseId,
          actor,
          action: 'route.parallel_split.activated',
          comment: `${plan.parallelBranches.length} branch tasks opened`,
        },
      });
      for (const branch of plan.parallelBranches) {
        await this.createStageTask(client, task.caseId, branch.stage, actor, {
          assetId: task.case.assetId ?? null,
          tokenLineage: {
            ...baseLineage,
            sourceTransitionId: branch.transition.id,
            branchKey: branch.branchKey,
            branchIndex: branch.branchIndex,
            joinKey: branch.joinKey,
            joinStack: [...continuationJoinStack, branch.joinKey],
          },
        });
      }
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
            comment: `Parallel route advanced after ${decision}`,
          },
        });
      }
      return;
    }
    if (plan.nextStage) {
      await this.createStageTask(client, task.caseId, plan.nextStage, actor, {
        assetId: task.case.assetId ?? null,
        tokenLineage: baseLineage,
      });
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
      include: {
        case: true,
        templateStage: { select: { ...decisionStageSelect, assigneeRoleCode: true } },
      },
    });
    if (!task) throw new NotFoundException('workflow task not found');
    await this.assertCaseVisible(user.roles, task.case, user);
    this.assertCaseCanChange(task.case.status);
    if (task.status === TaskStatus.completed || task.status === TaskStatus.cancelled) {
      throw new BadRequestException('This task has already been decided');
    }
    const isAdmin = user.roles.some((r) => ADMIN_ROLES.includes(r));
    const taskQueueRoleCode = task.assigneeRoleCode ?? task.templateStage?.assigneeRoleCode ?? null;
    const isRoleQueueDecision =
      !task.assigneeUserId &&
      !!taskQueueRoleCode &&
      user.roles.includes(taskQueueRoleCode);
    if (!isAdmin && task.assigneeUserId !== user.id && !isRoleQueueDecision) {
      throw new ForbiddenException('Only the assigned user or owning role queue can decide this task');
    }

    // Segregation of duties: the person who opened an approval case cannot also
    // decide it, regardless of role. This keeps proposer and approver separate.
    const isApprovalTask =
      task.case.type === 'owner_assignment_approval' ||
      task.case.type === 'steward_assignment_approval';
    if (isApprovalTask && task.case.createdBy === user.email) {
      throw new ForbiddenException('You cannot decide an approval you submitted');
    }
    const returnedForClarification = dto.decision === WORKFLOW_RETURN_FOR_CLARIFICATION;

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.assertStageDecisionPrerequisites(tx, task, dto.decision, dto.comment);
      const routePlan = isApprovalTask
        ? null
        : await this.planRouteAdvance(tx, task, dto.decision);
      const claim = await tx.workflowTask.updateMany({
        where: { id, status: { in: [TaskStatus.pending, TaskStatus.in_progress] } },
        data: {
          status: TaskStatus.completed,
          decision: returnedForClarification ? null : dto.decision as TaskDecision,
          decisionComment: dto.comment ?? null,
          completedAt: new Date(),
          ...(isRoleQueueDecision ? { assigneeUserId: user.id, assigneeRoleCode: taskQueueRoleCode } : {}),
        },
      });
      if (claim.count !== 1) throw new ConflictException('This task was decided by another user');
      const decided = await tx.workflowTask.findUnique({ where: { id }, include: taskInclude });
      if (!decided) throw new NotFoundException('workflow task not found after decision');
      if (isRoleQueueDecision) {
        await tx.workflowEvent.create({
          data: {
            caseId: task.caseId,
            taskId: id,
            actor: user.email,
            action: 'task.claimed',
            comment: `Claimed from ${taskQueueRoleCode} queue`,
          },
        });
      }
      await tx.workflowEvent.create({
        data: {
          caseId: task.caseId,
          taskId: id,
          actor: user.email,
          action: `decision.${dto.decision}`,
          comment: dto.comment ?? null,
        },
      });
      await this.completeRuntimeTokensForTask(tx, id);

      // Wire approval decisions back to the proposed assignment + case lifecycle atomically.
      if (isApprovalTask && task.case.assignmentId) {
        if (returnedForClarification) {
          await this.openClarificationTask(tx, task, user.email, dto.comment);
          await this.audit.log(
            {
              actor: user.email,
              action: 'workflow_task.return_for_clarification',
              entityType: 'workflow_task',
              entityId: id,
              metadata: { assignmentId: task.case.assignmentId, commentRequired: true },
            },
            tx,
          );
          return decided;
        }
        const approved = dto.decision === TaskDecision.approved;
        const assignment = await tx.stewardshipAssignment.findFirst({
          where: { id: task.case.assignmentId, deletedAt: null },
          include: { roleType: true, person: true },
        });
        if (!assignment) throw new BadRequestException('assignment not found for approval workflow');
        const demotedPrimaryCount = approved
          ? await this.demoteConflictingApprovedPrimary(tx, assignment)
          : 0;
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
            comment: approved
              ? `Assignment activated${demotedPrimaryCount ? `; ${demotedPrimaryCount} previous primary moved to backup` : ''}`
              : 'Proposed assignment rejected',
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
        const openedSequentialApproval = await this.maybeCreateNextSequentialApproval(tx, task, user.email);
        if (openedSequentialApproval) {
          await tx.workflowEvent.create({
            data: {
              caseId: task.caseId,
              taskId: id,
              actor: user.email,
              action: 'route.sequential_approval.waiting',
              comment: 'Next approval step opened in the same stage.',
            },
          });
        } else if (await this.hasOpenStagePeers(tx, task.caseId, task.templateStageId, id)) {
          await tx.workflowEvent.create({
            data: {
              caseId: task.caseId,
              taskId: id,
              actor: user.email,
              action: 'route.parallel_approval.waiting',
              comment: 'Waiting for remaining approval tasks in this stage.',
            },
          });
        } else {
          await this.applyRouteAdvance(tx, task, routePlan, user.email, dto.decision);
        }
      }

      await this.audit.log(
        {
          actor: user.email,
          action: `workflow_task.${dto.decision}`,
          entityType: 'workflow_task',
          entityId: id,
          metadata: {
            decision: dto.decision,
            stageCode: task.templateStage?.code ?? null,
            routeTransitionId: routePlan?.transition?.id ?? null,
          },
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
    if (assignment.approvalStatus !== ApprovalStatus.draft) {
      throw new BadRequestException('Only proposed assignments can be submitted for approval');
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

  private async assertRoleExists(roleCode: string): Promise<void> {
    const role = await this.prisma.role.findFirst({
      where: { code: roleCode, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!role) throw new BadRequestException('Workflow role not found');
  }

  private async assertTaskBelongsToCase(taskId: string, caseId: string): Promise<void> {
    const task = await this.prisma.workflowTask.findFirst({
      where: { id: taskId, caseId },
      select: { id: true },
    });
    if (!task) throw new BadRequestException('Workflow task does not belong to this case');
  }

  private async resolveStageAssignee(
    client: Prisma.TransactionClient,
    caseId: string,
    stage: WorkflowStageWithRoute,
    roleCode?: string | null,
    assetId?: string | null,
  ): Promise<string | null> {
    const strategy = String(stage.assignmentStrategy ?? 'role').trim().toLowerCase();
    if (strategy === 'automation') return null;
    if (strategy === 'role') return this.assigneeForRole(client, roleCode, assetId);
    if (strategy === 'workload') return this.assigneeForRole(client, roleCode, assetId, true);

    const config = this.jsonRecord(stage.assignmentConfigJson);
    const wfCase = await client.workflowCase.findUnique({
      where: { id: caseId },
      select: {
        createdBy: true,
        assetId: true,
        assignment: { select: { person: { select: { userId: true, email: true } } } },
        template: { select: { createdBy: true, lastPublishedBy: true } },
        runtimeTokens: {
          orderBy: { activatedAt: 'desc' },
          take: 1,
          select: { dataJson: true },
        },
      },
    });

    const configuredUser = async (...candidates: unknown[]): Promise<string | null> => {
      for (const candidate of candidates) {
        const value = typeof candidate === 'string' ? candidate.trim() : '';
        if (!value) continue;
        const user = await client.user.findFirst({
          where: {
            isActive: true,
            OR: [{ id: value }, { email: { equals: value, mode: 'insensitive' } }],
          },
          select: { id: true },
        });
        if (user) return user.id;
      }
      return null;
    };

    let resolved: string | null = null;
    if (strategy === 'direct_user') {
      resolved = await configuredUser(config['userId'], config['userEmail']);
    } else if (strategy === 'requester') {
      resolved = await configuredUser(wfCase?.createdBy);
    } else if (strategy === 'workflow_owner') {
      resolved = await configuredUser(
        config['userId'],
        config['userEmail'],
        wfCase?.template?.createdBy,
        wfCase?.template?.lastPublishedBy,
      );
    } else if (strategy === 'manager') {
      resolved = await configuredUser(config['managerUserId'], config['managerEmail'], config['userId'], config['userEmail']);
    } else if (strategy === 'backup') {
      resolved = await configuredUser(config['backupUserId'], config['backupUserEmail'], config['userId'], config['userEmail']);
    } else if (strategy === 'dynamic') {
      const variablePath = String(config['variablePath'] ?? '').trim();
      const context: Record<string, unknown> = {
        case: {
          createdBy: wfCase?.createdBy ?? null,
          assetId: wfCase?.assetId ?? null,
          assignment: wfCase?.assignment ?? null,
        },
        token: this.jsonRecord(wfCase?.runtimeTokens[0]?.dataJson),
      };
      resolved = await configuredUser(this.valueAtPath(context, variablePath), config['fallbackUserId'], config['fallbackUserEmail']);
    }

    return resolved ?? this.assigneeForRole(
      client,
      String(config['fallbackRoleCode'] ?? roleCode ?? '').trim() || null,
      assetId,
      strategy === 'workload',
    );
  }

  private valueAtPath(source: Record<string, unknown>, path: string): unknown {
    if (!path) return null;
    let current: unknown = source;
    for (const segment of path.split('.').filter(Boolean)) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private async assigneeForRole(
    client: Prisma.TransactionClient,
    roleCode?: string | null,
    assetId?: string | null,
    preferLowestWorkload = false,
  ): Promise<string | null> {
    if (!roleCode) return null;
    const directAssignee = await this.firstAssigneeForRole(client, roleCode, assetId, preferLowestWorkload);
    if (directAssignee) return directAssignee;
    if (roleCode !== DMO_ADMIN_CODE) {
      return this.firstAssigneeForRole(client, DMO_ADMIN_CODE, assetId, preferLowestWorkload);
    }
    return null;
  }

  private async firstAssigneeForRole(
    client: Prisma.TransactionClient,
    roleCode: string,
    assetId?: string | null,
    preferLowestWorkload = false,
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
            _count: {
              select: {
                workflowTasks: { where: { status: { in: [TaskStatus.pending, TaskStatus.in_progress] } } },
              },
            },
            userRoles: {
              select: {
                role: { select: { code: true, deletedAt: true, isActive: true } },
              },
            },
          },
        },
      },
    });
    const ordered = preferLowestWorkload
      ? [...matches].sort((left, right) => left.user._count.workflowTasks - right.user._count.workflowTasks)
      : matches;
    if (!assetId && ordered[0]) {
      return (await this.delegateForAssignee(client, ordered[0].userId, roleCode, null)) ?? ordered[0].userId;
    }
    if (!assetId) return null;

    for (const match of ordered) {
      const candidateRoleCodes = match.user.userRoles
        .map((userRole) => userRole.role)
        .filter((role) => role.isActive && !role.deletedAt)
        .map((role) => role.code);
      if (await this.roleCodesCanSeeAsset(candidateRoleCodes, assetId, client)) {
        return (await this.delegateForAssignee(client, match.userId, roleCode, assetId ?? null)) ?? match.userId;
      }
    }
    return null;
  }

  private async delegateForAssignee(
    client: Prisma.TransactionClient,
    delegatorUserId: string,
    roleCode: string,
    assetId?: string | null,
  ): Promise<string | null> {
    const delegationClient = (
      client as unknown as {
        workflowDelegation?: {
          findFirst: typeof this.prisma.workflowDelegation.findFirst;
        };
      }
    ).workflowDelegation;
    if (!delegationClient?.findFirst) return null;

    const now = new Date();
    const activeDelegation = await delegationClient.findFirst({
      where: {
        delegatorUserId,
        roleCode,
        status: WorkflowDelegationStatus.active,
        startsAt: { lte: now },
        expiresAt: { gt: now },
        OR: assetId ? [{ assetId }, { assetId: null }] : [{ assetId: null }],
      },
      orderBy: [{ assetId: 'desc' }, { expiresAt: 'asc' }],
      select: { delegateUserId: true },
    });
    if (!activeDelegation) return null;
    const delegate = await client.user.findFirst({
      where: { id: activeDelegation.delegateUserId, isActive: true },
      select: { id: true },
    });
    return delegate?.id ?? null;
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
