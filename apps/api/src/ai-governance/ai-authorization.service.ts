import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AI_PERMISSIONS, AiPermission, aiRoleMayHold, splitAiPermission } from './ai-permissions';
import { isSystemAdministrator } from '../auth/system-admin';
import { ScopeService } from '../access/scope.service';

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

  async authorize(userId: string, permission: AiPermission, client: Prisma.TransactionClient = this.prisma, resourceId?: string) {
    const actor=await this.authorizeAny(userId,[permission],client);
    if(resourceId&&!isAiReadPermission(permission))await this.assertBusinessScope(actor.roles,resourceId,client);
    return actor;
  }

  /** Specialist decisions use their explicit review-purpose grant, never read oversight. */
  async authorizeBusiness(userId:string,permission:AiPermission,client:Prisma.TransactionClient,resourceId:string){
    const actor=await this.authorizeAny(userId,[permission],client,true);
    await this.assertBusinessScope(actor.roles,resourceId,client);
    return actor;
  }

  async authorizeAny(userId: string, permissions: readonly AiPermission[], client: Prisma.TransactionClient = this.prisma, businessPurpose=false) {
    const user = await client.user.findFirst({
      where: { id: userId, isActive: true },
      select: { id:true, email:true, userRoles:{where:{role:{isActive:true,deletedAt:null}},select:{role:{select:{id:true,code:true}}}} },
    });
    const roles = user?.userRoles.map(x=>x.role) ?? [];
    const administratorOversight = isSystemAdministrator(roles.map(role => role.code));
    // Platform administration grants oversight, never another actor's business duty.
    const alternatives=permissions.map(permission=>{
      const isRead=!businessPurpose&&isAiReadPermission(permission);
      const eligible=!isRead && roles.some(r=>r.code==='auditor') ? [] : roles.filter(r=>(isRead||r.code!=='system_admin')&&aiRoleMayHold(r.code,permission));
      return {roleId:{in:eligible.map(r=>r.id)},permission:splitAiPermission(permission)};
    });
    const grant = alternatives.length ? await client.rolePermission.findFirst({where:{OR:alternatives}}) : null;
    if (!user || (!grant && !(!businessPurpose&&administratorOversight && permissions.some(isAiReadPermission)))) {
      await this.audit.logRequired({actor:userId,action:'ai.permission.denied',entityType:'ai_permission',metadata:{permissions:[...permissions]}});
      throw new ForbiddenException('AI action requires an explicit eligible role grant');
    }
    const business=businessPurpose||permissions.every(permission=>!isAiReadPermission(permission));
    let actorRoles=roles.map(r=>r.code);
    if(business||!administratorOversight){
      const grants=await client.rolePermission.findMany({where:{OR:alternatives},include:{role:{select:{code:true}},permission:true}});
      actorRoles=[...new Set(grants.filter(g=>roles.some(r=>r.code===g.role.code)&&(!business||g.role.code!=='system_admin')&&permissions.some(permission=>aiRoleMayHold(g.role.code,permission)&&g.permission.resource+'.'+g.permission.action===permission)).map(g=>g.role.code))];
    }
    return { id:user.id,email:user.email,roles:actorRoles,administratorOversight:!business&&administratorOversight,administratorOverride:false };
  }

  /** Bounded decision queues retain the same live purpose scope as their detail routes. */
  async filterReadScope<T extends {id:string}>(actor:{roles:string[];administratorOversight:boolean},rows:T[],client:Prisma.TransactionClient=this.prisma):Promise<T[]>{
    if(actor.administratorOversight)return rows;
    const visible=await Promise.all(rows.map(async row=>{try{await this.assertBusinessScope(actor.roles,row.id,client);return row;}catch(error){if(error instanceof NotFoundException)return null;throw error;}}));
    return visible.filter(row=>row!==null) as T[];
  }

  /** Scope for business actions comes only from eligible roles holding the purpose grant. */
  private async assertBusinessScope(roles:string[],resourceId:string,client:Prisma.TransactionClient){
    const scope=await new ScopeService(client as PrismaService).resolve(roles);
    const asset:Prisma.DataAssetWhereInput={deletedAt:null,isActive:true,
      ...(scope.orgUnits==='all'?{}:{orgUnitId:{in:scope.orgUnits}}),
      ...(scope.domains==='all'?{}:{domainId:{in:scope.domains}}),
      ...(scope.maxClassRank===null?{}:{classification:{is:{rank:{lte:scope.maxClassRank}}}})};
    const parentSelect={id:true,assetId:true,organizationUnitId:true,intakeRevisions:{where:{submittedAt:{not:null}},orderBy:{revision:'desc' as const},take:1,select:{payload:true,submittedAt:true}}} as const;
    const uc=await client.aiUseCase.findUnique({where:{id:resourceId},select:parentSelect})
      ??(await client.aiRisk.findUnique({where:{id:resourceId},select:{useCase:{select:parentSelect}}}))?.useCase
      ??(await client.aiRiskReview.findUnique({where:{id:resourceId},select:{risk:{select:{useCase:{select:parentSelect}}}}}))?.risk.useCase;
    if(uc){
      const inOrg=scope.orgUnits==='all'||!!uc.organizationUnitId&&scope.orgUnits.includes(uc.organizationUnitId);
      let inAsset=uc.assetId?!!await client.dataAsset.findFirst({where:{id:uc.assetId,...asset},select:{id:true}}):scope.domains==='all'&&scope.maxClassRank===null;
      // Specialist gates run before asset registration. Use the submitted, validated
      // intake's immutable classification publication at receipt, never request facts
      // or a platform role, to establish the classification ceiling for that stage.
      if(!uc.assetId&&scope.domains==='all'&&scope.maxClassRank!==null){
        const revision=uc.intakeRevisions[0],payload=revision?.payload;
        const code=payload&&typeof payload==='object'&&!Array.isArray(payload)?(payload as Record<string,unknown>)['data_classification']:undefined;
        if(typeof code==='string'&&revision.submittedAt){
          const versions=await client.governedReferenceVersion.findMany({where:{listCode:'L_CLASS',effectiveFrom:{lte:revision.submittedAt},OR:[{effectiveTo:null},{effectiveTo:{gt:revision.submittedAt}}],state:{in:['published','retired']}},include:{values:{where:{code}}},take:2});
          const metadata=versions.length===1?versions[0].values[0]?.metadata:null;
          const mapped=metadata&&typeof metadata==='object'&&!Array.isArray(metadata)?(metadata as Record<string,unknown>)['assetClassificationCode']:undefined;
          if(typeof mapped==='string')inAsset=!!await client.classification.findFirst({where:{code:mapped,isActive:true,deletedAt:null,rank:{lte:scope.maxClassRank}},select:{id:true}});
        }
      }
      if(!inOrg||!inAsset)throw new NotFoundException('AI business resource not found within the granted business scope');
      return;
    }
    const unit=await client.organizationUnit.findUnique({where:{id:resourceId},select:{id:true}});
    if(unit&&scope.orgUnits!=='all'&&!scope.orgUnits.includes(unit.id))throw new NotFoundException('AI business organization not found within the granted business scope');
  }

  /** Queue/configuration reads do not confer the corresponding decision authority. */
  async authorizeRead(userId:string, purposes:readonly AiPermission[], client:Prisma.TransactionClient=this.prisma) {
    return this.authorizeAny(userId,[...purposes,'case.view.aiuc.org','case.view.aiuc.all'],client);
  }

  async capabilities(userId: string, client: Prisma.TransactionClient = this.prisma) {
    const user=await client.user.findFirst({where:{id:userId,isActive:true},select:{id:true,userRoles:{where:{role:{isActive:true,deletedAt:null}},select:{role:{select:{code:true}}}}}});
    if(!user)throw new UnauthorizedException('Active authenticated user required');
    const actor={roles:user.userRoles.map(row=>row.role.code),administratorOversight:isSystemAdministrator(user.userRoles.map(row=>row.role.code))};
    const grants = await client.rolePermission.findMany({where:{role:{is:{code:{in:actor.roles},isActive:true,deletedAt:null}}},include:{role:{select:{code:true}},permission:true}});
    const permissions = effectiveAiPermissions(actor.roles, grants);
    const holds = (...codes: AiPermission[]) => codes.some(code => permissions.has(code));
    const governance = actor.administratorOversight || holds('dashboard.view.aiuc') || holds('case.view.airs.all') && !actor.roles.includes('auditor') || holds('dashboard.view.airs') && actor.roles.some(role => ['AI_WORKING_GROUP','AI_GOVERNANCE_OFFICER','AI_COMPLIANCE_OFFICER'].includes(role));
    return {administratorOversight:actor.administratorOversight,readMode:governance?'governance':actor.roles.includes('auditor')&&holds('case.view.aiuc.all','case.view.airs.all')?'audit':holds('dashboard.view.exec.ai')?'executive':permissions.size?'own':'none',permissions:[...permissions],screens:{
      useCases:holds('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all'),risks:holds('case.view.airs.own','case.view.airs.org','case.view.airs.all'),
      review:holds('case.view.aiuc.org','case.view.aiuc.all','case.approve.aiuc','aiuc.classify.assess','aiuc.asset.register','aiuc.asset.approve'),reviewOperations:holds('dashboard.view.aiuc','dashboard.view.airs','dashboard.view.exec.ai','case.view.airs.all'),
      dashboard:holds('dashboard.view.aiuc','dashboard.view.airs','dashboard.view.exec.ai','case.view.airs.all'),migration:actor.administratorOversight || actor.roles.some(role=>['AI_GOVERNANCE_OFFICER','dmo_admin','auditor'].includes(role)) && holds('case.view.airs.org','case.view.airs.all'),
    }};
  }

  async enforceDuty(actor: {id:string;roles:string[]}, action: AiDutyAction, facts: AiDutyFacts, entityId: string, completion = true) {
    const rule = aiDutyViolation(actor.id,actor.roles,action,facts,completion);
    if (!rule) return;
    // Standalone audit persists even though the caller's business operation is rejected.
    await this.audit.logRequired({actor:actor.id,action:'ai.sod.blocked',entityType:'ai_case',entityId,
      metadata:{rule,attemptedAction:action,completion,recusal:rule==='GEN-29'}});
    throw new ForbiddenException(`AI segregation-of-duties constraint ${rule}`);
  }
}

export function isAiReadPermission(permission: string): boolean {
  return permission.startsWith('case.view.') || permission.startsWith('dashboard.view.');
}

export function effectiveAiPermissions(roles: readonly string[], grants: readonly {role:{code:string};permission:{resource:string;action:string}}[]): Set<AiPermission> {
  const permissions = new Set<AiPermission>();
  for (const grant of grants) {
    const code = `${grant.permission.resource}.${grant.permission.action}` as AiPermission;
    if (AI_PERMISSIONS.includes(code) && aiRoleMayHold(grant.role.code,code) && (isAiReadPermission(code) || grant.role.code!=='system_admin'&&!roles.includes('auditor'))) permissions.add(code);
  }
  if (isSystemAdministrator(roles)) for (const code of AI_PERMISSIONS) if (isAiReadPermission(code)) permissions.add(code);
  return permissions;
}
