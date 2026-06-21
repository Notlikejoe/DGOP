import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, CaseStatus, TaskDecision, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import { AssignmentsService } from '../ownership/assignments.service';
import { AuthUser } from '../auth/auth.types';
import {
  AddTaskDto,
  CreateCaseDto,
  DecisionDto,
  SubmitAssignmentDto,
  UpdateCaseDto,
  UpdateTaskDto,
} from './workflow.dto';

export type SlaStatus = 'none' | 'on_track' | 'at_risk' | 'overdue' | 'done';

const AT_RISK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // within 2 days of due date
const ADMIN_ROLES = ['system_admin', 'dmo_admin'];

const taskInclude = {
  assignee: { select: { id: true, email: true, displayName: true } },
};

const caseInclude = {
  asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  assignment: {
    include: {
      roleType: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      person: { select: { id: true, fullNameEn: true, fullNameAr: true } },
    },
  },
  tasks: { include: taskInclude, orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly assignments: AssignmentsService,
  ) {}

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

  // ---------- data scope ----------
  /** Asset ids the requester may see, or 'all' when unrestricted. */
  private async visibleAssetIds(roleCodes: string[]): Promise<Set<string> | 'all'> {
    const scope = await this.scope.resolve(roleCodes);
    if (scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null) {
      return 'all';
    }
    const where: Record<string, unknown> = {};
    if (scope.orgUnits !== 'all') where['orgUnitId'] = { in: scope.orgUnits };
    if (scope.domains !== 'all') where['domainId'] = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where['OR'] = [
        { classificationId: null },
        { classification: { rank: { lte: scope.maxClassRank } } },
      ];
    }
    const assets = await this.prisma.dataAsset.findMany({
      where: { AND: [{ deletedAt: null }, where] },
      select: { id: true },
    });
    return new Set(assets.map((a) => a.id));
  }

  // ---------- cases ----------
  async listCases(
    roleCodes: string[],
    filters: { status?: string; type?: string },
  ) {
    const where: Record<string, unknown> = {};
    if (filters.status) where['status'] = filters.status;
    if (filters.type) where['type'] = filters.type;
    const [rows, assetIds] = await Promise.all([
      this.prisma.workflowCase.findMany({
        where,
        include: caseInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.visibleAssetIds(roleCodes),
    ]);
    return rows
      .filter((c) => !c.assetId || assetIds === 'all' || assetIds.has(c.assetId))
      .map((c) => ({
        ...c,
        tasks: c.tasks.map((t) => this.withSla(t)),
        openTasks: c.tasks.filter((t) => t.status === TaskStatus.pending || t.status === TaskStatus.in_progress).length,
      }));
  }

  async getCase(roleCodes: string[], id: string) {
    const wfCase = await this.prisma.workflowCase.findUnique({
      where: { id },
      include: caseInclude,
    });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    if (wfCase.assetId) {
      const assetIds = await this.visibleAssetIds(roleCodes);
      if (assetIds !== 'all' && !assetIds.has(wfCase.assetId)) {
        throw new NotFoundException('workflow case not found');
      }
    }
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

  async createCase(dto: CreateCaseDto, actor: string) {
    if (dto.assetId) {
      const asset = await this.prisma.dataAsset.findFirst({
        where: { id: dto.assetId, deletedAt: null },
      });
      if (!asset) throw new BadRequestException('Linked data asset not found');
    }
    const code = await this.nextCaseCode();
    const created = await this.prisma.workflowCase.create({
      data: {
        code,
        title: dto.title,
        description: dto.description ?? null,
        type: dto.type ?? 'general',
        status: CaseStatus.draft,
        assetId: dto.assetId ?? null,
        createdBy: actor,
      },
      include: caseInclude,
    });
    await this.event(created.id, actor, 'case.created', { toStatus: created.status });
    await this.audit.log({
      actor,
      action: 'workflow_case.create',
      entityType: 'workflow_case',
      entityId: created.id,
      metadata: { code },
    });
    return created;
  }

  async updateCase(id: string, dto: UpdateCaseDto, actor: string) {
    const existing = await this.prisma.workflowCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('workflow case not found');
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

  async submitCase(id: string, actor: string) {
    const existing = await this.prisma.workflowCase.findUnique({
      where: { id },
      include: { tasks: true },
    });
    if (!existing) throw new NotFoundException('workflow case not found');
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
    return updated;
  }

  // ---------- tasks ----------
  async addTask(caseId: string, dto: AddTaskDto, actor: string) {
    const wfCase = await this.prisma.workflowCase.findUnique({ where: { id: caseId } });
    if (!wfCase) throw new NotFoundException('workflow case not found');
    if (dto.assigneeUserId) await this.assertUser(dto.assigneeUserId);
    const task = await this.prisma.workflowTask.create({
      data: {
        caseId,
        title: dto.title,
        type: dto.type ?? 'review',
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

  async updateTask(id: string, dto: UpdateTaskDto, actor: string) {
    const existing = await this.prisma.workflowTask.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('workflow task not found');
    if (existing.status === TaskStatus.completed) {
      throw new BadRequestException('A completed task cannot be modified');
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

  async listMyTasks(userId: string, filters: { status?: string }) {
    const where: Record<string, unknown> = { assigneeUserId: userId };
    if (filters.status === 'open') {
      where['status'] = { in: [TaskStatus.pending, TaskStatus.in_progress] };
    } else if (filters.status) {
      where['status'] = filters.status;
    }
    const rows = await this.prisma.workflowTask.findMany({
      where,
      include: {
        ...taskInclude,
        case: { select: { id: true, code: true, title: true, type: true, status: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((t) => this.withSla(t));
  }

  async getTask(id: string) {
    const task = await this.prisma.workflowTask.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        case: { select: { id: true, code: true, title: true, type: true, status: true } },
      },
    });
    if (!task) throw new NotFoundException('workflow task not found');
    return this.withSla(task);
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
    if (task.status === TaskStatus.completed) {
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

    const updated = await this.prisma.workflowTask.update({
      where: { id },
      data: {
        status: TaskStatus.completed,
        decision: dto.decision,
        decisionComment: dto.comment ?? null,
        completedAt: new Date(),
      },
      include: taskInclude,
    });
    await this.event(task.caseId, user.email, `decision.${dto.decision}`, {
      taskId: id,
      comment: dto.comment ?? undefined,
    });

    // Wire approval decisions back to the proposed assignment + case lifecycle.
    if (isApprovalTask && task.case.assignmentId) {
      const approved = dto.decision === TaskDecision.approved;
      await this.assignments.setApprovalStatus(
        task.case.assignmentId,
        approved ? ApprovalStatus.approved : ApprovalStatus.rejected,
        user.email,
      );
      const finalStatus = approved ? CaseStatus.implemented : CaseStatus.rejected;
      await this.prisma.workflowCase.update({
        where: { id: task.caseId },
        data: { status: finalStatus },
      });
      await this.event(task.caseId, user.email, 'case.status', {
        fromStatus: task.case.status,
        toStatus: finalStatus,
        comment: approved ? 'Assignment activated' : 'Proposed assignment rejected',
      });
    }

    await this.audit.log({
      actor: user.email,
      action: `workflow_task.${dto.decision}`,
      entityType: 'workflow_task',
      entityId: id,
    });
    return this.withSla(updated);
  }

  // ---------- assignment approval entry point ----------
  /**
   * Routes a stewardship assignment through approval: marks it pending (non-authoritative)
   * and opens a case with an approval task for the chosen approver.
   */
  async submitAssignmentForApproval(dto: SubmitAssignmentDto, actor: string) {
    const assignment = await this.assignments.getAssignment(dto.assignmentId);
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

    // Mark the proposal pending so it is no longer authoritative until approved.
    await this.assignments.setApprovalStatus(dto.assignmentId, ApprovalStatus.pending, actor);

    const isOwner = assignment.roleType.code === 'data_owner';
    const assetId = assignment.targetType === 'asset' ? assignment.targetId : null;
    const personName = assignment.person.fullNameEn;
    const code = await this.nextCaseCode();
    const wfCase = await this.prisma.workflowCase.create({
      data: {
        code,
        title: `Approve ${assignment.roleType.nameEn} assignment for ${personName}`,
        description: `Proposed ${assignment.roleType.nameEn}: ${personName}.`,
        type: isOwner ? 'owner_assignment_approval' : 'steward_assignment_approval',
        status: CaseStatus.submitted,
        assetId,
        assignmentId: dto.assignmentId,
        createdBy: actor,
      },
      include: caseInclude,
    });
    const task = await this.prisma.workflowTask.create({
      data: {
        caseId: wfCase.id,
        title: 'Approve or reject the proposed assignment',
        type: 'approval',
        status: TaskStatus.pending,
        assigneeUserId: dto.approverUserId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      include: taskInclude,
    });
    await this.event(wfCase.id, actor, 'case.created', { toStatus: CaseStatus.submitted });
    await this.event(wfCase.id, actor, 'task.added', {
      taskId: task.id,
      comment: task.assignee ? `Assigned to ${task.assignee.displayName}` : undefined,
    });
    await this.audit.log({
      actor,
      action: 'assignment.submit_for_approval',
      entityType: 'stewardship_assignment',
      entityId: dto.assignmentId,
      metadata: { caseId: wfCase.id, code },
    });
    return this.getCase(['system_admin'], wfCase.id);
  }

  // ---------- helpers ----------
  private async assertUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!user) throw new BadRequestException('Assignee user account not found');
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
