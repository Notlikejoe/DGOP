import assert from 'node:assert/strict';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { AiSeverityService } from '../src/ai-governance/ai-severity.service';
import { AiWorkflowProjectionService } from '../src/ai-governance/ai-workflow-projection.service';

export async function testSeverity(db:PrismaClient,app:INestApplication,riskId:string,actors:Record<string,string>,ownerId:string,auditorId:string,evidenceId:string){
 const service=app.get(AiSeverityService),projection=app.get(AiWorkflowProjectionService),officer=actors.AI_GOVERNANCE_OFFICER,ethics=actors.AI_ETHICS_COMMITTEE,executive=actors.AI_EXECUTIVE_TEAM;
 const original=await db.aiRisk.findUniqueOrThrow({where:{id:riskId},include:{assessments:true,workflowCase:true}});
 const before=await service.context(officer,riskId);assert.equal(before.canPropose,true);assert.ok(before.calculatedSeverityCode);
 const code=before.calculatedSeverityCode==='P1'?'P4':'P1';
 const dto=(version:number)=>({expectedVersion:version,justification:'Synthetic independent severity justification',evidenceIds:[evidenceId]});
 await assert.rejects(service.act(ownerId,riskId,{...dto(before.version),action:'propose',severityCode:code}));
 await assert.rejects(service.act(auditorId,riskId,{...dto(before.version),action:'propose',severityCode:code}));
 await assert.rejects(service.act(officer,riskId,{...dto(before.version),action:'propose',severityCode:code,evidenceIds:[]}));
 const concurrent=await Promise.allSettled([1,2].map(()=>service.act(officer,riskId,{...dto(before.version),action:'propose',severityCode:code})));
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
 let c=await service.context(ethics,riskId);assert.equal(c.canApprove,true);assert.equal(c.effectiveSeverityCode,before.calculatedSeverityCode);
 await assert.rejects(service.act(officer,riskId,{...dto(c.version),action:'approve'}));
 await assert.rejects(service.act(executive,riskId,{...dto(c.version),action:'approve'}));
 const permission=await db.permission.findUniqueOrThrow({where:{resource_action:{resource:'airs.severity',action:'override'}}}),role=await db.role.findUniqueOrThrow({where:{code:'AI_ETHICS_COMMITTEE'}});
 await db.rolePermission.delete({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}}});
 assert.equal((await service.context(ethics,riskId)).canApprove,false);await assert.rejects(service.act(ethics,riskId,{...dto(c.version),action:'approve'}));
 await db.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
 const audit=app.get(AuditService),saved=audit.logRequired;audit.logRequired=async()=>{throw new Error('Injected severity audit failure');};
 try{await assert.rejects(service.act(ethics,riskId,{...dto(c.version),action:'approve'}),/Injected severity audit/);}finally{audit.logRequired=saved;}
 assert.deepEqual(await service.context(ethics,riskId),c);
 await service.act(ethics,riskId,{...dto(c.version),action:'approve'});
 c=await service.context(executive,riskId);assert.equal(c.effectiveSeverityCode,code);assert.equal(c.calculatedSeverityCode,before.calculatedSeverityCode);assert.equal(c.canReverse,true);
 const p=(await projection.forCases(officer,[original.workflowCaseId!])).get(original.workflowCaseId!) as Record<string,unknown>;
 assert.equal(p.effectiveSeverityCode,code);assert.equal(p.severityCode,before.calculatedSeverityCode);assert.equal(p.score,before.score);
 await assert.rejects(service.act(officer,riskId,{...dto(c.version),action:'reverse'}));
 await assert.rejects(service.act(ethics,riskId,{...dto(c.version),action:'reverse'}));
 const approved=c.events.find(e=>e.kind==='approved')!;
 await assert.rejects(db.aiRiskSeverityEvent.update({where:{id:approved.id},data:{severityCode:'P4'}}));
 await assert.rejects(db.aiRiskSeverityEvent.delete({where:{id:approved.id}}));
 await assert.rejects(db.aiRiskSeverityEvent.create({data:{...approved,id:'forged-severity-event',round:approved.round+1,kind:'reversed',actorId:officer,actorRoleCode:'STEERING_COMMITTEE',authorityLevel:4,relatedEventId:approved.id,previousSeverityCode:code,severityCode:String(before.calculatedSeverityCode),evidenceIds:[evidenceId]}}));
 await service.act(executive,riskId,{...dto(c.version),action:'reverse'});
 c=await service.context(executive,riskId);assert.equal(c.effectiveSeverityCode,before.calculatedSeverityCode);assert.equal(c.canReverse,false);
 await assert.rejects(service.act(executive,riskId,{...dto(c.version),action:'reverse'}));
 const after=await db.aiRisk.findUniqueOrThrow({where:{id:riskId},include:{assessments:true,workflowCase:true}});
 assert.deepEqual(after.assessments,original.assessments);assert.equal(after.workflowCase!.status,original.workflowCase!.status);
 // A returned proposal leaves the approved effective severity unchanged and permits another proposal.
 await service.act(officer,riskId,{...dto(c.version),action:'propose',severityCode:code});c=await service.context(ethics,riskId);
 await service.act(ethics,riskId,{...dto(c.version),action:'return'});c=await service.context(officer,riskId);
 assert.equal(c.canPropose,true);assert.equal(c.effectiveSeverityCode,before.calculatedSeverityCode);
 console.log('Severity integration passed: independent assigned authority, live purpose revocation, concurrency, immutable compensation, unchanged calculations/status and required audit rollback.');
}
