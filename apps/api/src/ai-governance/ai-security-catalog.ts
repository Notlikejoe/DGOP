import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AI_NEW_ROLES, AI_PERMISSIONS, aiRoleMayHold, splitAiPermission } from './ai-permissions';

// Explicit installer, never an application-startup hook. No user memberships change.
export async function syncAiSecurityCatalog(tx: Prisma.TransactionClient, audit: AuditService, actor: string, justification: string) {
  if (!actor.trim() || !justification.trim()) throw new Error('Catalog actor and justification required');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1832705420)`;
  for (const [code,nameEn,nameAr] of AI_NEW_ROLES) {
    const existing=await tx.role.findUnique({where:{code}});
    if (existing && !existing.isSystem) throw new Error(`AI role code conflicts with an existing custom role: ${code}`);
    if (!existing) {
      const role=await tx.role.create({data:{code,nameEn,nameAr,isSystem:true}});
      await audit.logRequired({actor,action:'ai.role.registered',entityType:'role',entityId:role.id,metadata:{code,justification}},tx);
    }
  }
  const roles=await tx.role.findMany({where:{isActive:true,deletedAt:null}});
  let grants=0, revocations=0;
  for (const code of AI_PERMISSIONS) {
    const key=splitAiPermission(code);
    const permission=await tx.permission.upsert({where:{resource_action:key},create:{...key,descriptionEn:code},update:{}});
    const current=await tx.rolePermission.findMany({where:{permissionId:permission.id},include:{role:true}});
    for (const grant of current) {
      if (!aiRoleMayHold(grant.role.code,code)) {
        await tx.rolePermission.delete({where:{roleId_permissionId:{roleId:grant.roleId,permissionId:permission.id}}});
        await audit.logRequired({actor,action:'ai.permission.revoked',entityType:'role',entityId:grant.roleId,metadata:{permission:code,oldValue:true,newValue:false,justification}},tx);
        revocations++;
      }
    }
    for (const role of roles) {
      if (aiRoleMayHold(role.code,code) && !current.some(g=>g.roleId===role.id)) {
        await tx.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
        await audit.logRequired({actor,action:'ai.permission.granted',entityType:'role',entityId:role.id,metadata:{permission:code,oldValue:false,newValue:true,justification}},tx);
        grants++;
      }
    }
  }
  return {roles:AI_NEW_ROLES.length,permissions:AI_PERMISSIONS.length,grants,revocations};
}
