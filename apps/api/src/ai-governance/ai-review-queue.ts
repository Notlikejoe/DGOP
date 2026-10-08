import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPaged } from '../common/pagination';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiReviewQueryDto, aiReviewParams } from './ai-review-query.dto';

type Actor = { id: string; roles: string[]; administratorOversight: boolean };
export function reviewWorkflowSelection(where: Prisma.WorkflowTaskWhereInput) {
  return { select: { id: true, code: true, status: true, templateId: true,
    tasks: { where, orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }], select: {
      id: true, title: true, status: true, assigneeRoleCode: true, assigneeUserId: true,
      dueDate: true, formDataJson: true, approvalGroupId: true,
      templateStage: { select: { code: true, nameEn: true, nameAr: true } },
    } },
  } } satisfies Prisma.AiUseCase$workflowCaseArgs;
}
export type QueueProbe = Prisma.AiUseCaseGetPayload<{ select: typeof probe }>;
const probe = {
  id: true, updatedAt: true, organizationUnitId: true, requesterUserId: true,
  owner: { select: { userId: true, organization: true } },
  workflowCase: { select: { tasks: { select: {
    id: true, status: true, dueDate: true, formDataJson: true,
    templateStage: { select: { code: true } },
  } } } },
} satisfies Prisma.AiUseCaseSelect;

/** Enumerate bounded, stably ordered probes in one snapshot. Scope and duty
 * exclusions precede both page selection and counts; only the page loads payloads. */
export async function readAiReviewQueue<S extends Prisma.AiUseCaseSelect>(
  prisma: PrismaService, authorization: AiAuthorizationService, actor: Actor,
  query: AiReviewQueryDto, where: Prisma.AiUseCaseWhereInput, taskWhere: Prisma.WorkflowTaskWhereInput,
  select: S, additionalFilter?: (rows: QueueProbe[], tx: Prisma.TransactionClient) => Promise<QueueProbe[]>,
) {
  const params = aiReviewParams(query), search = (query.search ?? '').trim();
  return prisma.$transaction(async tx => {
    const visibility = await authorization.queueReadScope(actor, tx);
    const matching: Prisma.AiUseCaseWhereInput = { AND: [where, visibility.where,
      ...(search ? [{ OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { description: { contains: search, mode: 'insensitive' as const } },
        { useCaseRef: { contains: search, mode: 'insensitive' as const } },
        { workflowCase: { is: { code: { contains: search, mode: 'insensitive' as const } } } },
      ] }] : []),
    ] };
    const ids: string[] = [], evaluatedAt = new Date();
    const summary = { total: 0, pending: 0, inProgress: 0, overdue: 0 };
    let cursor: string | undefined;
    for (;;) {
      const candidates = await tx.aiUseCase.findMany({ where: matching,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { ...probe, workflowCase: { select: { tasks: {
          where: taskWhere, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: probe.workflowCase.select.tasks.select,
        } } } },
      });
      if (!candidates.length) break;
      let visible = await visibility.filter(candidates);
      if (additionalFilter) visible = await additionalFilter(visible, tx);
      for (const item of visible) {
        if (summary.total >= params.skip && ids.length < params.take) ids.push(item.id);
        summary.total++;
        const tasks = item.workflowCase?.tasks ?? [];
        if (tasks.some(task => task.status === 'in_progress')) summary.inProgress++;
        else summary.pending++;
        if (tasks.some(task => task.dueDate && task.dueDate < evaluatedAt)) summary.overdue++;
      }
      if (candidates.length < 200) break;
      cursor = candidates[candidates.length - 1].id;
    }
    const records = ids.length ? await tx.aiUseCase.findMany({ where: { id: { in: ids } }, select }) : [];
    const byId = new Map(records.map(row => [(row as { id: string }).id, row]));
    const data = ids.map(id => byId.get(id)!);
    return { ...toPaged(data, summary.total, params), summary, evaluatedAt: evaluatedAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 15000, timeout: 30000 });
}
