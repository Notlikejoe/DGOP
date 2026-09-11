import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatBusinessSequence, nextAvailableBusinessCode } from '../common/business-sequence';

@Injectable()
export class AiIdentifiersService {
  // Call in the same transaction as the record write so failed submissions do
  // not consume identities. Unique constraints remain the final concurrency gate.
  nextUseCaseRef(tx: Prisma.TransactionClient): Promise<string> {
    return nextAvailableBusinessCode(tx, 'ai_use_case', n => `AI-${formatBusinessSequence(n, 3)}`,
      async useCaseRef => !(await tx.aiUseCase.findUnique({ where: { useCaseRef }, select: { id: true } })));
  }

  nextRiskRef(tx: Prisma.TransactionClient): Promise<string> {
    return nextAvailableBusinessCode(tx, 'ai_risk', n => `AIR-${formatBusinessSequence(n, 3)}`,
      async riskRef => !(await tx.aiRisk.findUnique({ where: { riskRef }, select: { id: true } })));
  }

  nextActionRef(tx: Prisma.TransactionClient): Promise<string> {
    return nextAvailableBusinessCode(tx, 'ai_treatment_action', n => `ACT-${formatBusinessSequence(n, 3)}`,
      async actionRef => !(await tx.aiTreatmentAction.findUnique({ where: { actionRef }, select: { id: true } })));
  }

  nextCaseCode(tx: Prisma.TransactionClient, type: 'AIUC' | 'AIRS', year: number): Promise<string> {
    if (!['AIUC', 'AIRS'].includes(type) || !Number.isInteger(year) || year < 1000 || year > 9999) {
      throw new Error('AI case type and four-digit year are required');
    }
    return nextAvailableBusinessCode(tx, `ai_case:${type}:${year}`, n => {
      if (n > 999999n) throw new Error('AI annual case sequence exhausted');
      return `${type}-${year}-${formatBusinessSequence(n, 6)}`;
    }, async code => !(await tx.workflowCase.findUnique({ where: { code }, select: { id: true } })));
  }
}
