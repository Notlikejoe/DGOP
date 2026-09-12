import { ConflictException, Injectable } from '@nestjs/common';
import { CaseStatus, Prisma, TaskStatus } from '@prisma/client';
import { addKsaBusinessDays, dateKey } from '../governance-operations/governance-operations.logic';
import { PrismaService } from '../prisma/prisma.service';

export const AIUC_TEMPLATE_CODE = 'AIUC_APPROVAL_V1';
export const AIRS_TEMPLATE_CODE = 'AIRS_LIFECYCLE_V1';
export const AIRS_STAGE = { identification: 'airs-identification', inherent: 'airs-inherent-assessment',
  ethics: 'airs-ethics-review', adoption: 'airs-assessment-adoption', response: 'airs-response', proposal: 'airs-response-proposal',
  consultation: 'airs-transfer-consultation' } as const;
export const AIUC_STAGE = {
  triage: 'aiuc-triage',
  completion: 'aiuc-completion',
  classification: 'aiuc-classification',
  privacy: 'aiuc-privacy-review',
  security: 'aiuc-security-review',
  ethics: 'aiuc-ethics-review',
  decision: 'aiuc-decision',
  assetRegistration: 'aiuc-asset-registration',
  assetApproval: 'aiuc-asset-approval',
} as const;

export type AiucRoutingFacts = {
  personalDataInvolved: boolean;
  sensitiveDataInvolved: boolean;
};

type RoutingClient = PrismaService | Prisma.TransactionClient;
type ConfigRecord = Record<string, unknown>;

function record(value: unknown): ConfigRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ConfigRecord : {};
}

@Injectable()
export class AiWorkflowRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  async openResponseGate(client: Prisma.TransactionClient, caseId: string, assessmentId: string, adoptionDecisionId: string, riskRef: string,
    ownerId: string, now: Date, returnedResponseId?: string) {
    const formDataJson = { assessmentId, adoptionDecisionId, riskRef, ...(returnedResponseId ? { returnedResponseId } : {}) };
    const coordinator = await this.createStageTask(client, caseId, AIRS_STAGE.response, now, { templateCode: AIRS_TEMPLATE_CODE, formDataJson });
    await this.createStageTask(client, caseId, AIRS_STAGE.proposal, now, { templateCode: AIRS_TEMPLATE_CODE, assigneeUserId: ownerId,
      formDataJson: { ...formDataJson, coordinatorTaskId: coordinator.id } });
    return coordinator;
  }

  async openRiskAssessmentGate(client: Prisma.TransactionClient, caseId: string, assessmentId: string, ethicsReviewRequired: boolean, riskRef: string, now: Date) {
    const formDataJson = { assessmentId, ethicsReviewRequired, riskRef };
    const adoption = await this.createStageTask(client, caseId, AIRS_STAGE.adoption, now, { templateCode: AIRS_TEMPLATE_CODE, formDataJson });
    if (ethicsReviewRequired) await this.createStageTask(client, caseId, AIRS_STAGE.ethics, now, { templateCode: AIRS_TEMPLATE_CODE, formDataJson });
    return adoption;
  }

  async binding(client: RoutingClient = this.prisma, templateCode: string = AIUC_TEMPLATE_CODE) {
    const template = await client.workflowTemplate.findFirst({
      where: { code: templateCode, isActive: true, deletedAt: null },
      select: {
        id: true,
        designerVersion: true,
        stages: {
          where: { isActive: true },
          select: {
            id: true, code: true, nameEn: true, taskType: true, assigneeRoleCode: true,
            dueDays: true, assignmentConfigJson: true,
          },
        },
      },
    });
    if (!template) throw new ConflictException(`${templateCode} workflow configuration is unavailable`);
    return template;
  }

  async bindExistingCase(client: Prisma.TransactionClient, caseId: string, templateCode: string = AIUC_TEMPLATE_CODE) {
    const template = await this.binding(client, templateCode);
    await client.workflowCase.update({
      where: { id: caseId },
      data: { templateId: template.id, templateVersion: template.designerVersion },
    });
    return template;
  }

  async createStageTask(
    client: Prisma.TransactionClient,
    caseId: string,
    stageCode: string,
    now: Date,
    options: {
      templateCode?: string;
      title?: string;
      assigneeUserId?: string;
      assigneeRoleCode?: string;
      approvalGroupId?: string;
      formDataJson?: Prisma.InputJsonObject;
    } = {},
  ) {
    const template = await this.binding(client, options.templateCode ?? AIUC_TEMPLATE_CODE);
    const stage = template.stages.find(candidate => candidate.code === stageCode);
    if (!stage) throw new ConflictException(`${options.templateCode ?? AIUC_TEMPLATE_CODE} stage ${stageCode} is unavailable`);
    return client.workflowTask.create({
      data: {
        caseId,
        templateStageId: stage.id,
        title: options.title ?? stage.nameEn,
        type: stage.taskType,
        status: TaskStatus.pending,
        assigneeUserId: options.assigneeUserId,
        assigneeRoleCode: options.assigneeRoleCode ?? stage.assigneeRoleCode,
        approvalGroupId: options.approvalGroupId,
        approvalMode: options.approvalGroupId ? 'all_instantiated' : undefined,
        formDataJson: options.formDataJson,
        dueDate: stage.dueDays > 0 ? await this.ksaDueDate(client, now, stage.dueDays) : undefined,
      },
    });
  }

  pendingStageWhere(stageCode: string, legacyTitle: string): Prisma.WorkflowTaskWhereInput {
    return {
      status: TaskStatus.pending,
      OR: [{ templateStage: { is: { template: { is: { code: AIUC_TEMPLATE_CODE } }, code: stageCode } } }, { title: legacyTitle }],
    };
  }

  routingFacts(value: unknown): AiucRoutingFacts {
    const outer = record(value);
    const facts = record(outer['routingFacts']);
    return {
      personalDataInvolved: facts['personalDataInvolved'] === true,
      sensitiveDataInvolved: facts['sensitiveDataInvolved'] === true,
    };
  }

  async openPostClassificationGate(
    client: Prisma.TransactionClient,
    caseId: string,
    decisionRoundId: string,
    approvedTierCode: string,
    proposedTierCode: string,
    facts: AiucRoutingFacts,
    now: Date,
  ) {
    const matched = await this.requiredReviews(client, approvedTierCode, proposedTierCode, facts);
    const approvalGroupId = `aiuc-review:${decisionRoundId}`;
    for (const match of matched) {
      await this.createStageTask(client, caseId, match.stageCode, now, {
        approvalGroupId,
        formDataJson: {
          classificationDecisionId: decisionRoundId,
          approvedTierCode,
          proposedTierCode,
          routingFacts: facts,
          assignmentRuleId: match.ruleId,
        },
      });
    }
    if (!matched.length) {
      const decision = await this.createDecisionTask(client, caseId, decisionRoundId, approvedTierCode, facts, now);
      return { reviewTaskCount: 0, nextStatus: CaseStatus.decision_made, nextRoles: [decision.assigneeRoleCode].filter((value): value is string => !!value) };
    }
    return { reviewTaskCount: matched.length, nextStatus: CaseStatus.under_review, nextRoles: matched.map(match => match.role).filter((value): value is string => !!value) };
  }

  async requiredReviews(client: RoutingClient, approvedTierCode: string, proposedTierCode: string, facts: AiucRoutingFacts) {
    const template = await this.binding(client);
    const context: ConfigRecord = {
      'aiuc.personalDataInvolved': facts.personalDataInvolved,
      'aiuc.sensitiveDataInvolved': facts.sensitiveDataInvolved,
      'aiuc.approvedTier': approvedTierCode.toUpperCase(),
      'aiuc.proposedTier': proposedTierCode.toUpperCase(),
      'case.type': 'AIUC',
    };
    const reviewStageCodes = [AIUC_STAGE.privacy, AIUC_STAGE.security, AIUC_STAGE.ethics];
    return reviewStageCodes.flatMap(stageCode => {
      const stage = template.stages.find(candidate => candidate.code === stageCode);
      if (!stage) throw new ConflictException(`${AIUC_TEMPLATE_CODE} stage ${stageCode} is unavailable`);
      const config = record(stage.assignmentConfigJson);
      return this.matches(record(config['activation']), context) ? [{ stageCode, ruleId: String(config['ruleId'] ?? ''), role: stage.assigneeRoleCode }] : [];
    });
  }

  async createDecisionTask(
    client: Prisma.TransactionClient,
    caseId: string,
    decisionRoundId: string,
    approvedTierCode: string,
    facts: AiucRoutingFacts,
    now: Date,
  ) {
    const assignment = await this.decisionAssignment(client, approvedTierCode);
    const task = await this.createStageTask(client, caseId, AIUC_STAGE.decision, now, {
      assigneeRoleCode: assignment.role,
      formDataJson: {
        classificationDecisionId: decisionRoundId,
        approvedTierCode,
        routingFacts: facts,
        assignmentRuleId: assignment.ruleId,
      },
    });
    const current = await client.workflowCase.findUniqueOrThrow({ where: { id: caseId }, select: { status: true } });
    await client.workflowCase.update({ where: { id: caseId }, data: { status: CaseStatus.decision_made } });
    await client.workflowEvent.create({ data: {
      caseId, taskId: task.id, actor: 'system', action: 'aiuc.decision.opened',
      fromStatus: current.status, toStatus: CaseStatus.decision_made,
      comment: `Tier ${approvedTierCode}; ${assignment.ruleId}; ${assignment.role}`,
    } });
    return task;
  }

  async decisionAssignment(client: RoutingClient, approvedTierCode: string) {
    const template = await this.binding(client);
    const stage = template.stages.find(candidate => candidate.code === AIUC_STAGE.decision);
    if (!stage) throw new ConflictException(`${AIUC_TEMPLATE_CODE} decision stage is unavailable`);
    const config = record(stage.assignmentConfigJson);
    const rules = Array.isArray(config['rules']) ? config['rules'].map(record) : [];
    const context: ConfigRecord = { 'aiuc.approvedTier': approvedTierCode.toUpperCase(), 'case.type': 'AIUC' };
    const matched = rules
      .filter(rule => this.matches(record(rule['condition']), context))
      .sort((left, right) => Number(left['priority'] ?? 999) - Number(right['priority'] ?? 999))[0];
    const role = typeof matched?.['assigneeRoleCode'] === 'string' ? matched['assigneeRoleCode'] : '';
    if (!role) throw new ConflictException(`No governed AIUC decision assignment rule matched ${approvedTierCode}`);
    return { role, ruleId: String(matched['ruleId'] ?? '') };
  }

  private matches(condition: ConfigRecord, context: ConfigRecord): boolean {
    if (Array.isArray(condition['any'])) return condition['any'].some(item => this.matches(record(item), context));
    const variablePath = typeof condition['variablePath'] === 'string' ? condition['variablePath'] : '';
    if (!variablePath) return false;
    const actual = context[variablePath];
    const operator = condition['operator'];
    if (operator === 'equals') return actual === condition['value'];
    if (operator === 'in' && Array.isArray(condition['values'])) return condition['values'].includes(actual);
    return false;
  }

  private async ksaDueDate(client: RoutingClient, start: Date, days: number): Promise<Date> {
    const holidays = await client.ksaHoliday.findMany({ orderBy: { date: 'asc' } });
    return addKsaBusinessDays(
      start,
      days,
      holidays.filter(row => !row.isRecurring).map(row => dateKey(row.date)),
      holidays.filter(row => row.isRecurring).map(row => row.date.toISOString().slice(5, 10)),
    );
  }
}
