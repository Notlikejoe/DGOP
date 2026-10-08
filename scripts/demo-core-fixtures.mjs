import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnvironment } from './runtime-env.mjs';
import { demoConfig, atomicJson, readManifest } from './demo-profile.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
applyEnvironment(root,true);
const config=demoConfig(root), manifest=readManifest(config);
process.env.DGOP_DEMO_ADAPTER_SCHEDULER='false';
const require=createRequire(resolve(root,'apps/api/package.json'));
const load=(path,name)=>require(resolve(root,'apps/api/dist',path+'.js'))[name];
const {NestFactory}=require('@nestjs/core');
const app=await NestFactory.createApplicationContext(load('app.module','AppModule'),{logger:false});
const db=app.get(load('prisma/prisma.service','PrismaService'));
const core=manifest.core??={assetIds:[],specIds:[],evidenceIds:[],dqIssueIds:[],assignmentIds:[]};
const save=()=>atomicJson(config.manifestPath,manifest);
const reason='SYNTHETIC DEMO ONLY: independent local example; no organizational compliance or production approval.';
async function decisionEvidence(workflow,caseId,task,reviewer,roleCode){
 const fileName=`synthetic-${roleCode}-independent-decision.txt`;
 let proof=await db.workflowTaskAttachment.findFirst({where:{caseId,taskId:task.id,fileName,createdBy:reviewer.email}});
 if(!proof){const buffer=Buffer.from(reason+'\nInstallation '+config.env.DGOP_DEMO_INSTALLATION_ID+'\nIndependent reviewer: '+reviewer.email+'\nChecked role fit, requester independence, assignment scope and synthetic accountability records.\n');proof=await workflow.addCaseAttachment(caseId,{taskId:task.id,kind:'decision_note'},{originalname:fileName,mimetype:'text/plain',size:buffer.length,buffer},reviewer);}
 core.attachmentIds??=[];if(!core.attachmentIds.includes(proof.id))core.attachmentIds.push(proof.id);save();
}
async function actor(key){
 const id=manifest.actors[key];assert.ok(id,`Missing native demo persona: ${key}`);
 const user=await db.user.findUniqueOrThrow({where:{id},include:{userRoles:{include:{role:true}}}});
 assert.ok(user.isActive&&!user.deletedAt,'Demo actor must remain active');
 const person=await db.person.findUniqueOrThrow({where:{userId:id}});
 return {id,email:user.email,roles:user.userRoles.filter(r=>r.role.isActive&&!r.role.deletedAt).map(r=>r.role.code),person};
}
// Stable business codes permit recovery after an interruption between commit and checkpoint.
async function existing(model,code,ownerCheck){
 const row=await db[model].findUnique({where:{code}});
 if(row&&!ownerCheck(row))throw Error(`Fixture ${code} belongs to another installation. Preserve it and resolve ownership.`);
 return row;
}
try{
 const requester=await actor('showcase'),owner=await actor('dataOwner'),steward=await actor('business'),reviewer=await actor('custodian');
 assert.notEqual(requester.id,reviewer.id);assert.notEqual(owner.id,reviewer.id);
 const domain=await db.dataDomain.findUniqueOrThrow({where:{code:'DGOP_DEMO_AI'}}),unit=await db.organizationUnit.findUniqueOrThrow({where:{code:'DGOP_DEMO_ORG'}});
 const classification=await db.classification.findUniqueOrThrow({where:{code:'DGOP_DEMO_RESTRICTED'}});
 const assets=app.get(load('assets/assets.service','AssetsService'));
 let asset=await existing('dataAsset','DGOP-DEMO-CORE-001',row=>row.description?.includes(config.env.DGOP_DEMO_INSTALLATION_ID));
 if(!asset)asset=await assets.create(requester.roles,{code:'DGOP-DEMO-CORE-001',nameEn:'DEMO — Synthetic service request register',nameAr:'عرض تجريبي — سجل طلبات خدمة اصطناعي',description:reason+' Installation '+config.env.DGOP_DEMO_INSTALLATION_ID,assetType:'dataset',domainId:domain.id,orgUnitId:unit.id,classificationId:classification.id,lifecycleStatus:'active'},requester.email);
 core.assetIds=[asset.id];save();
 const assignments=app.get(load('ownership/assignments.service','AssignmentsService')),workflow=app.get(load('workflow/workflow.service','WorkflowService'));
 core.assignmentIds=[];
 for(const [roleCode,assignedActor] of [['data_owner',owner],['business_steward',steward]]){
 const role=await db.roleType.findUniqueOrThrow({where:{code:roleCode}});
 let assignment=await db.stewardshipAssignment.findFirst({where:{targetType:'asset',targetId:asset.id,roleTypeId:role.id,personId:assignedActor.person.id,deletedAt:null}});
 if(assignment&&!assignment.justification?.includes(config.env.DGOP_DEMO_INSTALLATION_ID))throw Error('Asset ownership proposal belongs to another fixture installer');
 if(!assignment)assignment=await assignments.createAssignment({targetType:'asset',targetId:asset.id,roleTypeId:role.id,personId:assignedActor.person.id,isPrimary:true,saveAsProposal:true,justification:reason+' '+config.env.DGOP_DEMO_INSTALLATION_ID},requester.email,'synthetic_demo','draft',requester.roles);
 core.assignmentIds.push(assignment.id);save();
 let caseRow=await db.workflowCase.findFirst({where:{assignmentId:assignment.id},orderBy:{createdAt:'desc'}});
 if(assignment.approvalStatus==='draft'&&!caseRow)caseRow=await workflow.submitAssignmentForApproval({assignmentId:assignment.id,approverUserId:reviewer.id},requester.roles,requester.email);
 if(caseRow){if(roleCode==='data_owner')core.ownershipCaseId=caseRow.id;else core.stewardshipCaseId=caseRow.id;save();const task=await db.workflowTask.findFirst({where:{caseId:caseRow.id,status:{in:['pending','in_progress']}}});if(task){await decisionEvidence(workflow,caseRow.id,task,reviewer,roleCode);await workflow.decideTask(task.id,{decision:'approved',comment:reason},reviewer);}}
 assignment=await db.stewardshipAssignment.findUniqueOrThrow({where:{id:assignment.id}});assert.equal(assignment.approvalStatus,'approved');
 }
 const ndi=app.get(load('ndi/ndi.service','NdiSpecificationsService')),evidence=app.get(load('evidence/evidence.service','EvidenceService'));
 const ndiDomain=await db.ndiDomain.findFirstOrThrow({where:{code:'data_quality'}});
 let spec=await existing('ndiSpecification','DGOP-DEMO-DQ-001',row=>row.reference==='synthetic_demo:'+config.env.DGOP_DEMO_INSTALLATION_ID);
 if(!spec)spec=await ndi.create({code:'DGOP-DEMO-DQ-001',domainId:ndiDomain.id,nameEn:'DEMO — Synthetic quality control',nameAr:'عرض تجريبي — ضابط جودة اصطناعي',type:'control',maturityLevel:'level_2',ownerPersonId:owner.person.id,reference:'synthetic_demo:'+config.env.DGOP_DEMO_INSTALLATION_ID,acceptanceCriteria:'Synthetic records have validated IDs and documented independent review.'},requester.email);
 core.specIds=[spec.id];save();
 let proof=await db.ndiEvidence.findFirst({where:{specId:spec.id,title:'DEMO ONLY — synthetic quality review',deletedAt:null}});
 const existingProof=!!proof;
 if(proof&&!['synthetic_demo','seeded_uat'].includes(proof.provenance))throw Error('Synthetic evidence has incompatible provenance');
 if(!proof){const body=Buffer.from(reason+'\nScenario: synthetic records validated; independent review recorded.\n');proof=await evidence.create({specId:spec.id,title:'DEMO ONLY — synthetic quality review',submit:'true'},{originalname:'synthetic-quality-review.txt',mimetype:'text/plain',size:body.length,buffer:body},owner);}
 if(['submitted','under_review'].includes(proof.status))proof=await evidence.review(proof.id,{decision:'approve',comment:reason},reviewer);
 assert.equal(proof.status,'approved');assert.ok(['synthetic_demo','seeded_uat'].includes(proof.provenance));if(!existingProof)assert.equal(proof.provenance,'synthetic_demo');core.evidenceIds=[proof.id];save();
 const quality=app.get(load('data-quality/data-quality.service','DataQualityService'));
 let issue=await existing('dataQualityIssue','DGOP-DEMO-DQ-ISSUE-001',row=>row.source==='synthetic_demo:'+config.env.DGOP_DEMO_INSTALLATION_ID);
 if(!issue)issue=await quality.create(requester.roles,{code:'DGOP-DEMO-DQ-ISSUE-001',title:'DEMO — Missing synthetic request identifiers',description:reason,severity:'medium',dimension:'completeness',assetId:asset.id,responsiblePersonId:owner.person.id,source:'synthetic_demo:'+config.env.DGOP_DEMO_INSTALLATION_ID},requester.email);
 core.dqIssueIds=[issue.id];save();
 if(issue.status!=='closed')await quality.close(issue.id,reviewer.roles,{resolutionSummary:reason+' Synthetic IDs corrected and independently checked against the example records.'},reviewer.email);
 core.complete=true;save();console.log('Core synthetic asset, independently approved ownership/evidence and quality journey installed.');
}finally{await app.close();}
