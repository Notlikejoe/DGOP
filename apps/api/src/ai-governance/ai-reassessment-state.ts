import { Prisma } from '@prisma/client';

export async function requiredInherentRound(tx: Prisma.TransactionClient, riskId: string) {
  const entry = await tx.aiRiskReassessment.findFirst({where:{riskId},orderBy:{inherentRound:'desc'},
    include:{additionalTriggers:{orderBy:{requiredInherentRound:'desc'},take:1}}});
  return Math.max(entry?.inherentRound??0,entry?.additionalTriggers[0]?.requiredInherentRound??0);
}
