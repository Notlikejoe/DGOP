import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { jsonRecord } from './ai-risk-scoring';

/** Adds calculation provenance only after a live AIRS grant and scoped risk check. */
@Injectable()
export class AiWorkflowProjectionService {
  constructor(private readonly prisma: PrismaService, private readonly risks: AiRiskIntakeService) {}
  async forCases(userId: string, caseIds: string[]) {
    if (!caseIds.length) return new Map<string, unknown>();
    return this.prisma.$transaction(tx => this.forCasesIn(tx, userId, caseIds), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  }
  async forCasesIn(tx: Prisma.TransactionClient, userId: string, caseIds: string[]) {
      let access: Awaited<ReturnType<AiRiskIntakeService['visibility']>>;
      try { access = await this.risks.visibility(userId, tx); }
      catch (error) { if (error instanceof ForbiddenException) return new Map<string, unknown>(); throw error; }
      const rows = await tx.aiRisk.findMany({ where: { AND: [access.where, { workflowCaseId: { in: caseIds },
        isSampleData: false, useCase: { is: { isSampleData: false } } }] }, select: {
        workflowCaseId: true, useCase: { select: { operationalStatusCode: true } },
        responses: { orderBy: { round: 'desc' }, take: 1, select: { id: true, assessmentId: true,
          plans: { orderBy: { round: 'desc' }, take: 1, select: { id: true } } } },
        reassessments: { orderBy: { inherentRound: 'desc' }, take: 1, select: { inherentRound: true,
          additionalTriggers: { orderBy: { requiredInherentRound: 'desc' }, take: 1, select: { requiredInherentRound: true } } } },
        assessments: { where: { kind: { in: ['inherent', 'residual'] } }, orderBy: { round: 'desc' }, distinct: ['kind'],
          select: { id: true, kind: true, round: true, inputs: true, result: true, createdAt: true,
            decisions: { select: { decision: true } } } },
      } });
      const calculations = new Map(rows.map(r => {
        const required = Math.max(r.reassessments[0]?.inherentRound ?? 0, r.reassessments[0]?.additionalTriggers[0]?.requiredInherentRound ?? 0);
        const inherent = r.assessments.find(a => a.kind === 'inherent');
        const current = inherent && inherent.round >= required && !inherent.decisions.some(d => d.decision === 'return') ? inherent : null;
        const residual = r.assessments.find(a => a.kind === 'residual');
        const response = r.responses[0], pins = jsonRecord(residual?.inputs);
        const paired = residual && current && pins['inherentAssessmentId'] === current.id && response?.assessmentId === current.id
          && pins['responseId'] === response.id && (pins['planId'] ?? null) === (response.plans[0]?.id ?? null) ? residual : null;
        const selected = paired && !paired.decisions.some(d => d.decision === 'return') ? paired
          : current && !current.decisions.some(d => d.decision === 'return') ? current : null;
        const result = jsonRecord(selected?.result), code = result['severityCode'];
        const valid = typeof code === 'string' && ['P1', 'P2', 'P3', 'P4'].includes(code);
        return [r.workflowCaseId!, { operationalStatusCode: r.useCase.operationalStatusCode,
          severityCode: valid ? code : null, bandCode: valid ? result['bandCode'] : null,
          score: valid ? result['score'] : null, assessmentId: valid ? selected!.id : null,
          assessmentKind: valid ? selected!.kind : null, calculatedAt: valid ? selected!.createdAt : null,
          effectiveSeverityCode: valid ? code : null, overrideEventId: null as string|null,
          calculated: true, acceptanceInferred: false }];
      }));
      const assessmentIds = [...calculations.values()].map(c => c.assessmentId).filter((id): id is string => !!id);
      const overrides = assessmentIds.length ? await tx.aiRiskSeverityEvent.findMany({where:{assessmentId:{in:assessmentIds},kind:{in:['approved','reversed']}},orderBy:{round:'desc'},select:{id:true,assessmentId:true,severityCode:true,risk:{select:{workflowCaseId:true}}}}) : [];
      const seen = new Set<string>();
      for(const event of overrides){const id=event.risk.workflowCaseId,calculation=id?calculations.get(id):null;
        if(!id||!calculation||seen.has(id)||calculation.assessmentId!==event.assessmentId)continue;
        seen.add(id);calculation.effectiveSeverityCode=event.severityCode;calculation.overrideEventId=event.id;
      }
      return calculations;
  }
}
