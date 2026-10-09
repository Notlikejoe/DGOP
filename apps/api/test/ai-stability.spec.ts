import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/access/permissions.guard';
import { AccessService } from '../src/access/access.service';
import { RequireAnyPermissions, RequirePermissions } from '../src/auth/decorators';
import { AiAuthorizationService, aiDutyViolation, effectiveAiPermissions } from '../src/ai-governance/ai-authorization.service';
import { AiRegisterQueryDto, aiRegisterParams } from '../src/ai-governance/ai-register-query.dto';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';

@RequireAnyPermissions('example.read.org','example.read.all')
class PermissionContract {
  read() {}
  @RequirePermissions('example.edit') edit() {}
}

async function main(){
  let roles=['system_admin'];let grants:Array<{role:{code:string};permission:{resource:string;action:string}}>=[];
  const db={user:{findFirst:async()=>({id:'admin',email:'admin@isolated.test',userRoles:roles.map((code,i)=>({role:{id:String(i),code}}))})},rolePermission:{
    findFirst:async(args:any)=>grants.find(g=>args.where.OR.some((option:any)=>option.roleId.in.includes(String(roles.indexOf(g.role.code)))&&option.permission.resource===g.permission.resource&&option.permission.action===g.permission.action))??null,
    findMany:async()=>grants,
  }} as unknown as PrismaService;
  const events:any[]=[];const audit={logRequired:async(e:any)=>{events.push(e);}} as unknown as AuditService;
  const auth=new AiAuthorizationService(db,audit);
  const cap=await auth.capabilities('admin');assert.equal(cap.administratorOversight,true);assert.ok(Object.values(cap.screens).every(Boolean));
  assert.ok(cap.permissions.includes('refdata.publish'));assert.equal((await auth.authorize('admin','refdata.publish')).administratorOverride,true);
  roles=[];const none=await auth.capabilities('admin');assert.equal(none.readMode,'none');assert.ok(Object.values(none.screens).every(value=>!value));assert.deepEqual(none.permissions,[]);roles=['system_admin'];
  for(const permission of ['case.approve.aiuc','case.approve.airs','airs.risk.accept.high','aiuc.classify.assess'] as const)assert.equal((await auth.authorize('admin',permission)).administratorOverride,true);
  await auth.enforceDuty({id:'admin',roles},'approve_aiuc',{requesterId:'admin'},'case');
  roles=['system_admin','AI_GOVERNANCE_OFFICER'];grants=[{role:{code:'AI_GOVERNANCE_OFFICER'},permission:{resource:'case.approve',action:'aiuc'}}];
  const business=await auth.authorize('admin','case.approve.aiuc');assert.equal(business.administratorOverride,true);
  await auth.enforceDuty(business,'approve_aiuc',{requesterId:'admin'},'case');
  await auth.enforceDuty(business,'approve_aiuc',{requesterId:'other',useCaseOwnerId:'other'},'case');
  grants=[];assert.equal((await auth.authorize('admin','case.approve.aiuc')).administratorOverride,true,'System administrator authority does not depend on a business-role grant');
  assert.equal(aiDutyViolation('admin',['system_admin','AI_EXECUTIVE_TEAM'],'accept_high',{residualScore:16,justification:'valid',evidenceIds:['e']}),'GEN-112');
  assert.equal(aiDutyViolation('admin',['system_admin','AI_GOVERNANCE_OFFICER'],'adopt_assessment',{assessmentAssessorIds:['admin']}),'WF-05');
  const forged=effectiveAiPermissions(['AI_GOVERNANCE_OFFICER'],[{role:{code:'AI_GOVERNANCE_OFFICER'},permission:{resource:'refdata',action:'publish'}}]);assert.equal(forged.has('refdata.publish'),false);
  const auditor=effectiveAiPermissions(['system_admin','auditor','AI_GOVERNANCE_OFFICER'],[{role:{code:'AI_GOVERNANCE_OFFICER'},permission:{resource:'case.approve',action:'aiuc'}}]);assert.equal(auditor.has('case.approve.aiuc'),true);
  assert.deepEqual(aiRegisterParams(new AiRegisterQueryDto()),{page:1,pageSize:25,skip:0,take:25});
  for(const invalid of [{page:0},{page:1.5},{pageSize:201},{pageSize:0},{search:'x'.repeat(201)},{status:'fabricated'}])assert.throws(()=>aiRegisterParams(Object.assign(new AiRegisterQueryDto(),invalid)));
  assert.ok(!events.some(e=>e.action==='ai.sod.blocked'));
  let granted=['example.read.org'];
  const guard=new PermissionsGuard(new Reflector(),{permissionsForRoleCodes:async()=>granted,hasPermission:(permissions:string[],permission:string)=>permissions.includes(permission)} as unknown as AccessService,{log:async()=>undefined} as unknown as AuditService);
  const context=(method:'read'|'edit')=>({getHandler:()=>PermissionContract.prototype[method],getClass:()=>PermissionContract,switchToHttp:()=>({getRequest:()=>({user:{id:'reader',email:'reader@isolated.test',roles:['reader']},path:'/example'})})}) as never;
  assert.equal(await guard.canActivate(context('read')),true,'One live alternative permits a read');
  await assert.rejects(guard.canActivate(context('edit')),'A read alternative must not replace a required mutation permission');
  granted=['example.read.all','example.edit'];assert.equal(await guard.canActivate(context('edit')),true);
  granted=['example.edit'];await assert.rejects(guard.canActivate(context('edit')),'Required and alternative contracts are combined');
  granted=[];await assert.rejects(guard.canActivate(context('read')),'Live grant revocation denies alternatives');
  console.log('AI stability passed: administrator full authority, business-role policy, authority bands and bounded query validation.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
