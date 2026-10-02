import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiPermission, aiRoleMayHold, splitAiPermission } from './ai-permissions';
import { isSystemAdministrator } from '../auth/system-admin';

/** Server-resolved facts only. Never bind these facts to a public request DTO. */
export interface AiDutyFacts {
  requesterId?: string;
  useCaseOwnerId?: string;
  riskOwnerId?: string;
  planApproverIds?: readonly string[];
  planExecutorIds?: readonly string[];
  assessmentAssessorIds?: readonly string[];
  residualScore?: number;
  justification?: string;
  evidenceIds?: readonly string[];
}
export type AiDutyAction = 'approve_aiuc' | 'approve_plan' | 'execute_plan' | 'ethics_review' | 'adopt_assessment'
  | 'accept_low' | 'accept_medium' | 'accept_high' | 'restrict_critical' | 'task';

export function aiDutyViolation(actorId: string, roles: readonly string[], action: AiDutyAction, facts: AiDutyFacts, completion = true): string | null {
  if (isSystemAdministrator(roles)) return null;
  if (roles.includes('auditor')) return 'GEN-30';
  if (roles.includes('executive') && !roles.some(r => r.startsWith('AI_') || r === 'STEERING_COMMITTEE')) return 'GEN-104';
  if (action === 'approve_aiuc' && [facts.requesterId, facts.useCaseOwnerId].includes(actorId)) return 'GEN-26';
  if (['accept_medium','accept_high','restrict_critical'].includes(action) && facts.riskOwnerId === actorId) return 'GEN-27';
  if (action === 'execute_plan' && facts.planApproverIds?.includes(actorId)) return 'GEN-28';
  if (action === 'approve_plan' && facts.planExecutorIds?.includes(actorId)) return 'GEN-28';
  if (action === 'ethics_review' && [facts.useCaseOwnerId,facts.riskOwnerId].includes(actorId)) return 'GEN-29';
  if (action === 'adopt_assessment' && ([facts.useCaseOwnerId,facts.riskOwnerId].includes(actorId) || facts.assessmentAssessorIds?.includes(actorId))) return 'WF-05';
  if (action.startsWith('accept_') || action === 'restrict_critical') {
    const scores = {accept_low:[1,2],accept_medium:[3,4,6],accept_high:[8,9,12],restrict_critical:[16]};
    if (!scores[action as keyof typeof scores]?.includes(facts.residualScore!)) return 'GEN-112';
    const authority = action === 'accept_low' ? ['AI_USECASE_OWNER'] : action === 'accept_medium' ? ['AI_USECASE_OWNER','AI_GOVERNANCE_OFFICER'] : action === 'accept_high' ? ['AI_EXECUTIVE_TEAM'] : ['STEERING_COMMITTEE'];
    if (!authority.some(r=>roles.includes(r))) return 'GEN-25';
    if (action === 'accept_low' && facts.useCaseOwnerId !== actorId) return 'GEN-25';
    if (action === 'accept_medium' && !roles.includes('AI_GOVERNANCE_OFFICER') && facts.useCaseOwnerId !== actorId) return 'GEN-25';
  }
  if (completion && ['accept_high','restrict_critical'].includes(action)
    && (!facts.justification?.trim() || !facts.evidenceIds?.length)) return 'GEN-31';
  return null;
}

@Injectable()
export class AiAuthorizationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async authorize(userId: string, permission: AiPermission, client: Prisma.TransactionClient = this.prisma) {
    return this.authorizeAny(userId,[permission],client);
  }

  async authorizeAny(userId: string, permissions: readonly AiPermission[], client: Prisma.TransactionClient = this.prisma) {
    const user = await client.user.findFirst({
      where: { id: userId, isActive: true },
      select: { id:true, email:true, userRoles:{where:{role:{isActive:true,deletedAt:null}},select:{role:{select:{id:true,code:true}}}} },
    });
    const roles = user?.userRoles.map(x=>x.role) ?? [];
    const administratorOverride = isSystemAdministrator(roles.map(role => role.code));
    // Normal AI actors require explicit eligible grants. System Administrator is resolved
    // from the live active role row and receives the platform-wide audited override.
    const alternatives=permissions.map(permission=>{
      const isRead=permission.startsWith('case.view.') || permission.startsWith('dashboard.view.');
      const eligible=!isRead && roles.some(r=>r.code==='auditor') ? [] : roles.filter(r=>aiRoleMayHold(r.code,permission));
      return {roleId:{in:eligible.map(r=>r.id)},permission:splitAiPermission(permission)};
    });
    const grant = alternatives.length ? await client.rolePermission.findFirst({where:{OR:alternatives}}) : null;
    if (!user || (!grant && !administratorOverride)) {
      await this.audit.logRequired({actor:userId,action:'ai.permission.denied',entityType:'ai_permission',metadata:{permissions:[...permissions]}});
      throw new ForbiddenException('AI action requires an explicit eligible role grant');
    }
    return { id:user.id,email:user.email,roles:roles.map(r=>r.code),administratorOverride };
  }

  async enforceDuty(actor: {id:string;roles:string[]}, action: AiDutyAction, facts: AiDutyFacts, entityId: string, completion = true) {
    if (isSystemAdministrator(actor.roles)) {
      await this.audit.logRequired({actor:actor.id,action:'ai.system_admin.override',entityType:'ai_case',entityId,
        metadata:{attemptedAction:action,completion,reason:'platform_wide_administrator_authority'}});
      return;
    }
    const rule = aiDutyViolation(actor.id,actor.roles,action,facts,completion);
    if (!rule) return;
    // Standalone audit persists even though the caller's business operation is rejected.
    await this.audit.logRequired({actor:actor.id,action:'ai.sod.blocked',entityType:'ai_case',entityId,
      metadata:{rule,attemptedAction:action,completion,recusal:rule==='GEN-29'}});
    throw new ForbiddenException(`AI segregation-of-duties constraint ${rule}`);
  }
}
