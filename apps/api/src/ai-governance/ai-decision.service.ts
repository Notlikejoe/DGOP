import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, Prisma, TaskDecision, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiucDecisionOutcome, RecordAiucDecisionDto } from './ai-decision.dto';
import { AIUC_STAGE, AIUC_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';

const decisionCase = {
  id: true, useCaseRef: true, workflowCaseId: true, requesterUserId: true, version: true,
  name: true, description: true, updatedAt: true,
  owner: { select: { userId: true } },
  workflowCase: { select: { id: true, code: true, status: true, templateId: true } },
  intakeRevisions: { orderBy: { revision: 'desc' as const }, take: 1, select: { payload: true, revision: true } },
  assessments: {
    where: { kind: 'classification' as const }, orderBy: { round: 'desc' as const }, take: 1,
    select: {
      id: true, round: true, engineVersion: true, inputs: true, result: true, createdBy: true, createdAt: true,
      ruleReferenceVersionId: true,
      ruleReferenceVersion: { select: { values: { select: { code: true, labelEn: true, labelAr: true } } } },
    },
  },
} satisfies Prisma.AiUseCaseSelect;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function aiucAllowedDecisions(tier: string): readonly AiucDecisionOutcome[] {
  if (tier === 'UNACCEPTABLE') return ['restrict', 'stop', 'return'];
  return ['MINIMAL', 'LIMITED', 'HIGH'].includes(tier) ? ['approve', 'approve_with_conditions', 'return', 'reject'] : [];
}

@Injectable()
export class AiDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AiAuthorizationService,
    private readonly audit: AuditService,
    private readonly routing: AiWorkflowRoutingService,
  ) {}

  async queue(userId: string) {
    const actor = await this.authorization.authorize(userId, 'case.approve.aiuc');
    const taskWhere: Prisma.WorkflowTaskWhereInput = {
      status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
      assigneeRoleCode: { in: actor.roles },
      OR: [{ assigneeUserId: null }, { assigneeUserId: actor.id }],
      templateStage: { is: { code: AIUC_STAGE.decision, template: { is: { code: AIUC_TEMPLATE_CODE } } } },
    };
    const cases = await this.prisma.aiUseCase.findMany({
      where: {
        deletedAt: null, useCaseRef: { not: null },
        NOT: [{ requesterUserId: actor.id }, { owner: { is: { userId: actor.id } } }],
        workflowCase: { is: { status: { in: [CaseStatus.under_review, CaseStatus.decision_made] }, tasks: { some: taskWhere } } },
      },
      orderBy: { updatedAt: 'asc' }, take: 100,
      select: {
        ...decisionCase,
        workflowCase: { select: {
          id: true, code: true, status: true, templateId: true,
          tasks: { where: taskWhere, orderBy: { createdAt: 'asc' }, select: {
            id: true, title: true, assigneeRoleCode: true, dueDate: true, formDataJson: true,
            templateStage: { select: { code: true, nameEn: true, nameAr: true } },
          } },
        } },
      },
    });
    return cases.map(item => {
      const tierCode = String(record(item.assessments[0]?.result)['approvedTierCode'] ?? '');
      return {
        ...item,
        approvedTier: item.assessments[0]?.ruleReferenceVersion.values.find(value => value.code === tierCode) ?? null,
        allowedDecisions: aiucAllowedDecisions(tierCode),
      };
    });
  }

  async record(userId: string, id: string, taskId: string, dto: RecordAiucDecisionDto, clientIp?: string) {
    const justification = dto.justification.trim();
    const evidenceIds = [...new Set(dto.evidenceIds.map(value => value.trim()).filter(Boolean))];
    if (!justification || !evidenceIds.length) throw new BadRequestException('Decision justification and DGOP evidence are required');
    const conditions = [...new Set((dto.conditions ?? []).map(value => value.trim()))];
    if (conditions.some(value => !value || value.length > 1000) || conditions.length > 20) {
      throw new BadRequestException('Approval conditions must be non-empty and within the supported length');
    }
    if ((dto.decision === 'approve_with_conditions') !== (conditions.length > 0)) {
      throw new BadRequestException('Structured conditions are required only for Approved with Conditions');
    }
    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'case.approve.aiuc', tx);
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: decisionCase });
      if (!current?.workflowCaseId || !current.useCaseRef || !current.workflowCase
        || !([CaseStatus.under_review, CaseStatus.decision_made] as CaseStatus[]).includes(current.workflowCase.status)) {
        throw new NotFoundException('AI use case is not available for a tier decision');
      }
      if (current.version !== dto.expectedVersion) throw new ConflictException('AI use case changed; reload before recording the decision');
      await this.authorization.enforceDuty(actor, 'approve_aiuc', {
        requesterId: current.requesterUserId, useCaseOwnerId: current.owner?.userId ?? undefined,
      }, id);
      const task = await tx.workflowTask.findFirst({
        where: {
          id: taskId, caseId: current.workflowCaseId, status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
          templateStage: { is: { code: AIUC_STAGE.decision, template: { is: { code: AIUC_TEMPLATE_CODE } } } },
        },
        include: { templateStage: { select: { templateId: true } } },
      });
      if (!task || task.templateStage?.templateId !== current.workflowCase.templateId) {
        throw new ConflictException('No matching active AIUC decision task exists');
      }
      const form = record(task.formDataJson);
      const source = current.assessments[0];
      const sourceResult = record(source?.result);
      const approvedTierCode = String(sourceResult['approvedTierCode'] ?? '');
      const proposedTierCode = String(sourceResult['proposedTierCode'] ?? '');
      if (!source || form['classificationDecisionId'] !== source.id || form['approvedTierCode'] !== approvedTierCode
        || !approvedTierCode || !proposedTierCode) {
        throw new ConflictException('The decision task does not match the current verified classification');
      }
      const tier = source.ruleReferenceVersion.values.find(value => value.code === approvedTierCode);
      if (!tier) throw new ConflictException('The approved tier is absent from its pinned reference version');
      const officerDecision = record(sourceResult['officerDecision']);
      const authorityReference = typeof officerDecision['authorityReference'] === 'string' ? officerDecision['authorityReference'].trim() : null;
      if (approvedTierCode !== proposedTierCode && !authorityReference) {
        throw new ConflictException('A classification override requires its recorded higher-authority reference before adoption');
      }
      const assignment = await this.routing.decisionAssignment(tx, approvedTierCode);
      if (task.assigneeRoleCode !== assignment.role || !actor.roles.includes(assignment.role)
        || (task.assigneeUserId && task.assigneeUserId !== actor.id)) {
        throw new ForbiddenException('The decision must be recorded by its configured tier authority');
      }
      if (!aiucAllowedDecisions(approvedTierCode).includes(dto.decision)) {
        throw new BadRequestException(approvedTierCode === 'UNACCEPTABLE'
          ? 'Unacceptable AI use cannot be adopted; record restrict or stop, or return for reassessment'
          : 'The decision outcome is not supported for the verified tier');
      }
      const factValues = record(form['routingFacts']);
      if (typeof factValues['personalDataInvolved'] !== 'boolean' || typeof factValues['sensitiveDataInvolved'] !== 'boolean') {
        throw new ConflictException('Server-verified intake routing facts are required');
      }
      const facts = this.routing.routingFacts(task.formDataJson);
      const required = await this.routing.requiredReviews(tx, approvedTierCode, proposedTierCode, facts);
      const reviews = await tx.workflowTask.findMany({
        where: { caseId: current.workflowCaseId, approvalGroupId: `aiuc-review:${source.id}` },
        include: { templateStage: { select: { code: true } } },
      });
      if (required.some(match => !reviews.some(review => review.templateStage?.code === match.stageCode
        && review.assigneeRoleCode === match.role && review.status === TaskStatus.completed && review.decision === TaskDecision.approved))
        || reviews.some(review => review.status !== TaskStatus.completed || review.decision !== TaskDecision.approved)
        || await tx.workflowTask.count({ where: {
          caseId: current.workflowCaseId, id: { not: taskId }, status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
        } })) {
        throw new ConflictException('Every required specialist review must be approved before the tier decision');
      }
      if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length) {
        throw new BadRequestException('Every decision evidence identifier must exist in the DGOP evidence store');
      }
      const now = new Date();
      const isApproved = dto.decision === 'approve' || dto.decision === 'approve_with_conditions';
      const isReturn = dto.decision === 'return';
      const resolutionCode = isReturn ? null : isApproved
        ? dto.decision === 'approve_with_conditions' ? 'Approved with Conditions' : 'Approved'
        : 'Rejected';
      const nextStatus = isReturn ? CaseStatus.under_review : isApproved ? CaseStatus.approved : CaseStatus.rejected;
      const decisionRecord = {
        decisionType: dto.decision, resolutionCode, approvedTierCode, proposedTierCode,
        classificationDecisionId: source.id, ruleReferenceVersionId: source.ruleReferenceVersionId,
        actorId: actor.id, actorRole: assignment.role, recordedAt: now.toISOString(),
        justification, evidenceIds, conditions, authorityReference,
      };
      await tx.workflowTask.update({ where: { id: taskId }, data: {
        status: TaskStatus.completed, decision: isApproved ? TaskDecision.approved : TaskDecision.rejected,
        decisionComment: justification, completedAt: now, formSubmittedAt: now, formSubmittedBy: actor.id,
        formDataJson: { ...form, adoptionDecision: decisionRecord } as Prisma.InputJsonObject,
      } });
      if (!isReturn && current.workflowCase.status !== CaseStatus.decision_made) {
        await tx.workflowCase.update({ where: { id: current.workflowCaseId }, data: { status: CaseStatus.decision_made } });
        await tx.workflowEvent.create({ data: {
          caseId: current.workflowCaseId, taskId, actor: actor.id, action: 'aiuc.decision.made',
          fromStatus: current.workflowCase.status, toStatus: CaseStatus.decision_made, comment: justification,
        } });
      }
      await tx.workflowCase.update({ where: { id: current.workflowCaseId }, data: { status: nextStatus } });
      let nextTaskId: string | null = null;
      if (isReturn) {
        nextTaskId = (await this.routing.createStageTask(tx, current.workflowCaseId, AIUC_STAGE.classification, now, {
          formDataJson: { routingFacts: facts, returnedFromDecisionTaskId: taskId },
        })).id;
      } else if (isApproved) {
        for (const [index, description] of conditions.entries()) {
          await tx.aiApprovalObligation.create({ data: {
            useCaseId: id, sourceKey: `${taskId}:${index + 1}`, description, createdBy: actor.id,
          } });
        }
        nextTaskId = (await this.routing.createStageTask(tx, current.workflowCaseId, AIUC_STAGE.assetRegistration, now, {
          formDataJson: { sourceDecisionTaskId: taskId, classificationDecisionId: source.id, approvedTierCode, resolutionCode },
        })).id;
      }
      const updated = await tx.aiUseCase.updateMany({ where: { id, version: dto.expectedVersion }, data: { version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('AI use case changed; reload before recording the decision');
      const action = `aiuc.decision.${dto.decision}`;
      await tx.workflowEvent.create({ data: {
        caseId: current.workflowCaseId, taskId, actor: actor.id, action,
        fromStatus: isReturn ? current.workflowCase.status : CaseStatus.decision_made, toStatus: nextStatus,
        comment: justification,
      } });
      await this.audit.logRequired({ actor: actor.id, action, entityType: 'ai_use_case', entityId: id, metadata: {
        ...decisionRecord, actorRoles: actor.roles, clientIp: clientIp ?? null,
        caseCode: current.workflowCase.code, useCaseRef: current.useCaseRef,
        oldValue: current.workflowCase.status, newValue: nextStatus, nextTaskId, assignmentRuleId: assignment.ruleId,
      } }, tx);
      return { id, version: current.version + 1, workflowCase: { id: current.workflowCaseId, code: current.workflowCase.code, status: nextStatus }, decision: decisionRecord, nextTaskId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 15000 });
  }
}
