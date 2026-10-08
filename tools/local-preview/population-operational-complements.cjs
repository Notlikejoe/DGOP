module.exports=(s,reason)=>{const {db,api,ensure,transition,id,ref,actor,manifest,assert}=s;return [
 ['Open-data candidates, real readiness and locally simulated publications',async()=>{
  const role=await db.role.findUniqueOrThrow({where:{code:'dgop_demo_workflow_reviewer_v1'}});const grants=await db.rolePermission.findMany({where:{roleId:role.id},include:{permission:true}});const permissions=grants.map(x=>x.permission.resource+'.'+x.permission.action);if(!permissions.includes('open_data_candidates.edit'))await api('/roles/'+role.id+'/permissions',{permissions:[...permissions,'open_data_candidates.view','open_data_candidates.edit'],justification:reason},'admin','PUT');
  for(const key of ['privacy','mlops']){const user=await actor(key),codes=user.userRoles.map(x=>x.role.code),extra=[role.code,...key==='mlops'?['technical_steward','dq_steward']:[]];for(const code of extra)assert(await db.role.findUnique({where:{code}}),'Missing installed reviewer role '+code);if(extra.some(code=>!codes.includes(code)))await api('/users/'+user.id+'/roles',{roleCodes:[...new Set([...codes,...extra])],justification:reason},'admin','PUT');}
  const classification=await db.classification.findFirstOrThrow({where:{isActive:true,deletedAt:null,rank:1}});
  for(const [scope,complete]of [['finance',true],['hr',true],['finance-pending',false]]){
   const actual=scope.startsWith('finance')?'finance':'hr',code='DEMO-PUBLIC-'+scope.toUpperCase()+'-V1';
   const asset=await ensure('public-asset.'+scope,'dataAsset',{code},'/assets',{code,nameEn:'DEMO — '+scope+' synthetic aggregate totals',nameAr:'عرض تجريبي — إجماليات اصطناعية '+scope,description:reason,assetType:'dataset',domainId:ref('domain.'+actual),orgUnitId:ref('org.'+actual),classificationId:classification.id,systemId:id('system.'+actual)},'steward',{description:reason});
   await ensure('public-profile.'+scope,'dataQualityProfile',{assetId:asset.id,source:reason},'/data-quality/profiles/run',{assetId:asset.id,source:reason,datasetName:'Synthetic aggregates',csv:'period,total\n2026-Q1,120\n2026-Q2,145\n2026-Q3,160',createIssues:false,createRuleDrafts:false},'steward',{source:reason});
   const candidate=await ensure('open-data.'+scope,'openDataCandidate',{assetId:asset.id,description:reason},'/open-data-candidates',{assetId:asset.id,titleEn:'DEMO — '+scope+' aggregate publication',titleAr:'عرض تجريبي — نشر الإجماليات '+scope,description:reason,personalDataAssessment:'none',publicationValueScore:90,ownerPersonId:(await actor('data-owner')).person.id,stewardPersonId:(await actor('steward')).person.id,odiaoReviewerPersonId:(await actor('compliance')).person.id},'steward',{description:reason});
   if(complete&&(await db.openDataCandidate.findUniqueOrThrow({where:{id:candidate.id}})).status!=='published'){
    const steward=(await actor('mlops')).person.id;if(candidate.stewardPersonId!==steward){assert.equal(candidate.stewardPersonId,(await actor('steward')).person.id,'Candidate reviewer was manually changed');await api('/open-data-candidates/'+candidate.id,{stewardPersonId:steward},'steward','PATCH');}
    if(!await db.openDataAssessment.count({where:{candidateId:candidate.id,status:'completed'}}))await api('/open-data-candidates/'+candidate.id+'/assessment',{complete:true,publicClassification:true,restrictedInformation:false,aggregationApplied:true,anonymizationApplied:true,dqAcceptable:true,metadataComplete:true,privacyReviewComplete:true,legalReviewComplete:true,note:reason+' Inspected invented aggregate rows; no identifiable people or restricted fields.'},'steward');
    for(const approval of await db.openDataApproval.findMany({where:{candidateId:candidate.id,decision:{not:'approved'}}})){
     const reviewer=({steward:'mlops',data_quality:'mlops',owner:'data-owner',privacy:'privacy',legal:'admin',odiao:'compliance'})[approval.step];assert(reviewer,'Unknown approval step '+approval.step);
     await api('/open-data-candidates/'+candidate.id+'/approvals/'+approval.id,{decision:'approved',note:reason+' Assigned reviewer checked aggregate source, quality profile and publication safeguards.'},reviewer,'PATCH');
    }
    await api('/open-data-candidates/'+candidate.id+'/publish',{portalRecordId:'SYNTHETIC-LOCAL-'+scope,note:reason+' Native local simulation; nothing published to an external portal.'},'data-owner');
   }
  }
 }],
 ['Native calendar occurrences and overdue task escalation examples',async()=>{
  const now=new Date(),templateIds=['finance','hr'].map(k=>id('calendar.'+k));
  assert.equal(await db.complianceCalendarTemplate.count({where:{id:{notIn:templateIds},status:'active',nextRunAt:{lte:now},type:{notIn:['ai_risk_review','ai_annual_review']}}}),0,'An unrelated calendar template is due; preserve it and inspect before generating');
  const before=await db.complianceCalendarOccurrence.count({where:{templateId:{in:templateIds}}});if(before<2){for(const templateId of templateIds){const t=await db.complianceCalendarTemplate.findUniqueOrThrow({where:{id:templateId}});if(!t.lastRunAt&&t.nextRunAt>now)await api('/governance-operations/calendar/templates/'+templateId,{nextRunAt:manifest.createdAt.slice(0,10)+'T00:00:00Z'},'steward','PATCH');}await api('/governance-operations/calendar/generate',{},'steward');}
  const occurrences=await db.complianceCalendarOccurrence.findMany({where:{templateId:{in:templateIds}}});assert.equal(occurrences.length,2);
  const tasks=[];for(const occurrence of occurrences){const task=await db.workflowTask.findFirstOrThrow({where:{caseId:occurrence.workflowCaseId,status:'pending'}});tasks.push(task);const assigneeUserId=(await actor('steward')).id;if(!task.dueDate||task.dueDate>new Date('2026-10-01T00:00:00Z')||task.assigneeUserId!==assigneeUserId)await api('/workflow/tasks/'+task.id,{dueDate:'2026-10-01T00:00:00Z',assigneeUserId},'steward','PATCH');}
  if(await db.governanceEscalation.count({where:{workflowTaskId:{in:tasks.map(x=>x.id)}}})<2)await s.native(async get=>{
   const held=await actor('steward');assert(held.userRoles.some(x=>x.role.code==='dgop_demo_author_v1'));
   const restricted={id:held.id,email:held.email,roles:['dgop_demo_author_v1']};
   const operations=get('governance-operations/governance-operations.service','GovernanceOperationsService');
   const where=await operations.scopedTaskWhere(restricted);
   const visibleOverdue=await db.workflowTask.findMany({where:{AND:[where,{status:{in:['pending','in_progress']},dueDate:{lt:now}}]},select:{id:true,case:{select:{description:true}}}});
   assert(visibleOverdue.every(x=>tasks.some(t=>t.id===x.id)||x.case.description?.includes(manifest.installationId)),'Unexpected scoped overdue work; preserve it before generating SLA records');
   await operations.recalculateSla(restricted);
  });
  assert.equal(await db.governanceEscalation.count({where:{workflowTaskId:{in:tasks.map(x=>x.id)}}}),2);
 }],
 ['Operational audit packs exclude synthetic proof',async()=>{
  for(const [key,domainId]of [['all',null],['quality',(await db.ndiDomain.findUniqueOrThrow({where:{code:'data_quality'}})).id]]){
   await ensure('audit-pack.'+key,'ndiAuditPack',{domainId,createdAt:{gte:new Date(manifest.createdAt)},requestedBy:(await actor('admin')).email},'/ndi/audit-packs',domainId?{domainId}:{},'admin',{});
  }
  for(const key of ['all','quality']){const pack=await s.row('audit-pack.'+key);const text=JSON.stringify(pack.manifestJson);assert(!text.includes(id('proof.finance')),'Synthetic proof leaked into an operational manifest');}
 }]
];};
