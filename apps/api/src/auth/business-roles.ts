import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Responsibility identities only. Administrative identities can never be aliases. */
export const CANONICAL_BUSINESS_ROLES = [
  'AI_WORKING_GROUP','AI_USECASE_OWNER','AI_RISK_OWNER','AI_MODEL_OWNER','AI_MLOPS_LEAD',
  'AI_COMPLIANCE_OFFICER','AI_ETHICS_COMMITTEE','AI_EXECUTIVE_TEAM','STEERING_COMMITTEE',
  'data_owner','privacy_officer','security_reviewer','business_steward','AI_GOVERNANCE_OFFICER','ndi_reviewer',
  'security_officer','technical_steward','data_custodian','foi_officer',
] as const;

export interface ResponsibilityRole {
  code: string;
  businessRoleCode?: string | null;
  isActive?: boolean;
  deletedAt?: Date | null;
  businessRole?: { code?: string; businessRoleCode?: string | null; isActive: boolean; deletedAt: Date | null } | null;
}
export function businessRoleCode(role: Pick<ResponsibilityRole,'code'|'businessRoleCode'>): string {
  return role.businessRoleCode ?? role.code;
}
export function matchesBusinessRole(user:{roles:string[];businessRoles?:{roleCode:string;businessRoleCode:string}[]}, code:string):boolean {
  return user.roles.includes(code) || (CANONICAL_BUSINESS_ROLES as readonly string[]).includes(code)
    && !!user.businessRoles?.some(binding=>user.roles.includes(binding.roleCode)&&binding.businessRoleCode===code);
}
export function liveResponsibility(role: ResponsibilityRole): boolean {
  return role.isActive !== false && role.deletedAt == null && (!role.businessRoleCode ||
    !!role.businessRole && role.businessRole.isActive && role.businessRole.deletedAt == null && !role.businessRole.businessRoleCode);
}
export function liveRoleWhere(): Prisma.RoleWhereInput {
  return { isActive:true, deletedAt:null, OR:[{businessRoleCode:null},
    {businessRole:{is:{isActive:true,deletedAt:null,businessRoleCode:null}}}] };
}
export function responsibilityWhere(codes: string | readonly string[]): Prisma.RoleWhereInput {
  const allowed=typeof codes==='string'?[codes]:[...codes];
  return { AND:[liveRoleWhere(),{OR:[{code:{in:allowed}},{businessRoleCode:{in:allowed}}]}] };
}
/** Select actual grant-bearing roles; an alias never inherits its canonical role's grants. */
export async function businessDecisionRoles(client: Prisma.TransactionClient, actualCodes: string[],
  permission: string, eligible?: readonly string[]): Promise<string[]> {
  if(actualCodes.includes('auditor')||!actualCodes.some(code=>!['system_admin','auditor'].includes(code)))throw new ForbiddenException('An explicit live eligible business role grant is required');
  const at=permission.lastIndexOf('.');
  const roles=await client.role.findMany({where:{AND:[liveRoleWhere(),{code:{in:actualCodes,notIn:['system_admin','auditor']},
    permissions:{some:{permission:{resource:permission.slice(0,at),action:permission.slice(at+1)}}}},
    ...(eligible?[responsibilityWhere(eligible)]:[])]},select:{code:true}});
  if(!roles.length||actualCodes.includes('auditor'))throw new ForbiddenException('An explicit live eligible business role grant is required');
  return roles.map(role=>role.code);
}
export async function businessAuthoritySnapshot(client:Prisma.TransactionClient,actualCodes:string[],responsibility:string|null){
  const rows=await client.role.findMany({where:{AND:[liveRoleWhere(),{code:{in:actualCodes}}]},
    select:{id:true,code:true,businessRoleCode:true,maxClassificationRank:true,dataScopes:true},orderBy:{code:'asc'}});
  return {evaluatedResponsibility:responsibility,scopeRoleBindings:rows.map(role=>({roleId:role.id,roleCode:role.code,
    businessRoleCode:businessRoleCode(role),maxClassificationRank:role.maxClassificationRank,
    scopes:role.dataScopes.map(s=>({scopeType:s.scopeType,refId:s.refId,includeDescendants:s.includeDescendants})).sort((a,b)=>(a.scopeType+a.refId).localeCompare(b.scopeType+b.refId))}))};
}
