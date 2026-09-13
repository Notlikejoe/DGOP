import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiReviewReportService } from './ai-review-report.service';

/** Read-only native journey. Neither imported rows nor the demo installer grant read authority. */
@Injectable()
export class AiHistoryService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService,
    private readonly reports: AiReviewReportService) {}

  async list(userId: string, page = 1, pageSize = 10) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50)
      throw new BadRequestException('Use a positive page and page size 1–50');
    return this.prisma.$transaction(async tx => {
      await this.authorization.authorizeAny(userId, ['case.view.aiuc.org', 'case.view.aiuc.all'], tx);
      const access = await this.reports.access(tx, userId);
      if (access.aggregateOnly) throw new ForbiddenException('Aggregate dashboard authority cannot reveal case histories');
      const where: Prisma.AiUseCaseWhereInput = { deletedAt: null, isSampleData: false,
        useCaseRef: { not: null }, risks: { some: access.where } };
      const total = await tx.aiUseCase.count({ where });
      const rows = await tx.aiUseCase.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize, select: {
          id: true, useCaseRef: true, name: true, operationalStatusCode: true,
          asset: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          workflowCase: { select: { code: true, status: true } },
          assessments: { where: { kind: 'classification' }, orderBy: { round: 'desc' }, take: 1,
            select: { round: true, result: true, createdAt: true } },
          risks: { where: access.where, orderBy: { createdAt: 'asc' }, select: {
            id: true, riskRef: true, title: true,
            workflowCase: { select: { status: true } },
            assessments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
              id: true, kind: true, round: true, result: true, createdAt: true,
              decisions: { orderBy: { createdAt: 'asc' }, select: {
                kind: true, decision: true, actorRoleCode: true, justification: true, createdAt: true } } } },
            actions: { where: { deletedAt: null }, orderBy: { actionRef: 'asc' }, select: {
              actionRef: true, title: true, progress: { orderBy: { round: 'desc' }, take: 1,
                select: { completionPct: true } } } },
            reviews: { orderBy: { dueAt: 'desc' }, take: 10, select: {
              id: true, dueAt: true, bandCode: true, completion: { select: { completedAt: true } },
              cancellation: { select: { createdAt: true } } } },
          } },
        } });
      let demoMode = false;
      try {
        const db = new URL(process.env.DATABASE_URL ?? '');
        demoMode = process.env.DGOP_AI_DEMO_MODE === 'true' && process.env.NODE_ENV === 'development'
          && db.hostname === '127.0.0.1' && /^\/dgop_ai_preview_\d+$/.test(db.pathname);
      } catch { /* Invalid configuration never enables demonstration labels. */ }
      return { rows, total, page, pageSize, demoMode, readOnly: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  }
}
