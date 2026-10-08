const session=require('./population-session.cjs');
(async()=>{const s=await session(2);const {db,api,ensure,transition,id,ref,manifest,actor,groups,finish,assert}=s;
const reason=manifest.marker+'; fictional records only; no operational compliance proof.';
try{
await groups([
 ['Non-admin business installer/reviewer profiles',async()=>{
  const permissions=await db.permission.findMany();const folders=['assets','ownership','workflow','data-quality','extended-domains','business-value','ndi','evidence','privacy','security-governance','open-data','foi','data-sharing','governance-operations','training','access'];
  const contracts=new Set();for(const folder of folders)for(const file of s.fs.readdirSync(s.root+'/apps/api/src/'+folder).filter(x=>x.endsWith('.controller.ts'))){const source=s.fs.readFileSync(s.root+'/apps/api/src/'+folder+'/'+file,'utf8');for(const match of source.matchAll(/@RequirePermissions\(([^)]*)\)/g))for(const code of match[1].matchAll(/'([^']+)'/g))contracts.add(code[1]);}
  const selected=permissions.map(p=>p.resource+'.'+p.action).filter(code=>contracts.has(code)&&!/^(?:users|roles|workflow_templates|workflow_runtime|integrations)\./.test(code)&&/\.(?:view|create|edit|review|approve|run)$/.test(code));
  for(const key of ['author','reviewer']){
   const code='dgop_demo_'+key+'_v1';const r=await ensure('role.'+key,'role',{code},'/roles',{code,nameEn:'DEMO — business '+key,nameAr:'عرض تجريبي — '+key,description:reason},'admin',{description:reason});
   const current=await db.rolePermission.findMany({where:{roleId:r.id},include:{permission:true}});const codes=current.map(x=>x.permission.resource+'.'+x.permission.action);
   if(selected.some(x=>!codes.includes(x)))await api('/roles/'+r.id+'/permissions',{permissions:[...new Set([...codes,...selected])],justification:reason},'admin','PUT');
   if(!await db.roleDataScope.count({where:{roleId:r.id}}))await api('/roles/'+r.id+'/scopes',{scopes:['finance','hr'].flatMap(k=>[{scopeType:'org_unit',refId:ref('org.'+k)},{scopeType:'data_domain',refId:ref('domain.'+k)}])},'admin','PUT');
   const person=await actor(key==='author'?'steward':'data-owner');const roles=person.userRoles.map(x=>x.role.code);if(!roles.includes(code))await api('/users/'+person.id+'/roles',{roleCodes:[...roles,code],justification:reason},'admin','PUT');
  }
  const code='dgop_demo_workflow_reviewer_v1';const reviewer=await ensure('role.workflow-reviewer','role',{code},'/roles',{code,nameEn:'DEMO — independent workflow reviewer',nameAr:'عرض تجريبي — مراجع سير العمل المستقل',description:reason},'admin',{description:reason});
  const grants=['workflow_tasks.view','workflow_tasks.edit','workflow_cases.view','data_assets.view'];
  const existing=await db.rolePermission.findMany({where:{roleId:reviewer.id},include:{permission:true}});if(grants.some(x=>!existing.some(p=>p.permission.resource+'.'+p.permission.action===x)))await api('/roles/'+reviewer.id+'/permissions',{permissions:grants,justification:reason},'admin','PUT');
  if(!await db.roleDataScope.count({where:{roleId:reviewer.id}}))await api('/roles/'+reviewer.id+'/scopes',{scopes:['finance','hr'].flatMap(k=>[{scopeType:'org_unit',refId:ref('org.'+k)},{scopeType:'data_domain',refId:ref('domain.'+k)}])},'admin','PUT');
  const independent=await actor('compliance');if(!independent.userRoles.some(x=>x.role.code===code))await api('/users/'+independent.id+'/roles',{roleCodes:[...independent.userRoles.map(x=>x.role.code),code],justification:reason},'admin','PUT');
 }],
 ['Connected invoice, supplier, employee and payroll assets',async()=>{
  const classification=await db.classification.findFirstOrThrow({where:{isActive:true,deletedAt:null},orderBy:{rank:'desc'}});
  for(const [key,scope,title,ar,subject]of [['invoice','finance','Invoice register','سجل الفواتير','invoices'],['supplier','finance','Supplier master','سجل الموردين','suppliers'],['supplier-copy','finance','Supplier legacy import','استيراد الموردين القديم','suppliers'],['employee','hr','Employee directory','سجل الموظفين','employees'],['employee-copy','hr','Employee legacy import','استيراد الموظفين القديم','employees'],['payroll','hr','Payroll register','سجل الرواتب','payroll']]){
   const code='DEMO-'+key.toUpperCase()+'-V1';await ensure('asset.'+key,'dataAsset',{code},'/assets',{code,nameEn:'DEMO — '+title,nameAr:'عرض تجريبي — '+ar,description:reason,assetType:'dataset',lifecycleStatus:'active',domainId:ref('domain.'+scope),orgUnitId:ref('org.'+scope),systemId:id('system.'+scope),capabilityId:id('capability.'+scope),classificationId:classification.id,subjectIds:[id('subject.'+subject)]},'steward',{description:reason});
  }
 }],
 ['Ownership rules, independent approval and pending work',async()=>{
  const owner=await actor('data-owner'),steward=await actor('steward'),role=await db.roleType.findUniqueOrThrow({where:{code:'data_owner'}});
  for(const scope of ['finance','hr'])await ensure('rule.'+scope,'assignmentRule',{nameEn:'DEMO — '+scope+' owner routing'},'/assignment-rules',{nameEn:'DEMO — '+scope+' owner routing',nameAr:'عرض تجريبي — توجيه المالك '+scope,description:reason,scopeType:'domain',refId:ref('domain.'+scope),roleTypeId:role.id,personId:owner.person.id,isPrimary:true,priority:10},'steward',{description:reason});
  for(const [key,complete]of [['invoice',true],['employee',false],['payroll',true]]){
   const assignment=await ensure('assignment.'+key,'stewardshipAssignment',{targetType:'asset',targetId:id('asset.'+key),roleTypeId:role.id,personId:owner.person.id},'/assignments',{targetType:'asset',targetId:id('asset.'+key),roleTypeId:role.id,personId:owner.person.id,isPrimary:true,saveAsProposal:true,justification:reason},'steward',{justification:reason});
   let wf=await db.workflowCase.findFirst({where:{assignmentId:assignment.id}});if(!wf)wf=await api('/workflow/assignments/submit-for-approval',{assignmentId:assignment.id,approverUserId:(await actor('compliance')).id},'steward');
   const task=await db.workflowTask.findFirst({where:{caseId:wf.id,status:{in:['pending','in_progress']}}});
   if(task&&complete){let attachment=await db.workflowTaskAttachment.findFirst({where:{caseId:wf.id,taskId:task.id,fileName:'synthetic-ownership-decision.txt'}});if(!attachment){const f=new FormData();f.set('taskId',task.id);f.set('kind','decision_note');f.set('file',new Blob([reason+'\nIndependent compliance reviewer checked role fit, Finance scope and assignment request.'],{type:'text/plain'}),'synthetic-ownership-decision.txt');await api('/workflow/cases/'+wf.id+'/attachments',f,'compliance');}await api('/workflow/tasks/'+task.id+'/decision',{decision:'approved',comment:reason+' Independent compliance review.'},'compliance');}
  }
 }],
 ['Quality rules, real CSV profiles and actionable/resolved issues',async()=>{
  for(const [key,scope,dimension,complete]of [['invoice','finance','completeness',true],['employee','hr','uniqueness',false]]){
   const code='DEMO_DQ_'+key.toUpperCase()+'_V1';let rule=await ensure('dq-rule.'+key,'dataQualityRule',{code},'/data-quality/rules',{code,nameEn:'DEMO — '+key+' identifier '+dimension,nameAr:'عرض تجريبي — جودة المعرّف '+key,description:reason,dimension,severity:'medium',assetId:id('asset.'+key),domainId:ref('domain.'+scope),ownerPersonId:(await actor('steward')).person.id,thresholdExpression:'>= 99%',definitionJson:{column:'id',operator:dimension==='uniqueness'?'unique':'not_null'}},'steward',{description:reason});
   if(complete){for(const [status,action,user]of [['draft','submit','steward'],['in_review','approve','data-owner'],['approved','deploy','steward']])rule=await transition('dq-rule.'+key,'/data-quality/rules/'+rule.id+'/'+action,{comment:reason},user,'POST',x=>x.status===status);}
   await ensure('dq-profile.'+key,'dataQualityProfile',{assetId:id('asset.'+key),source:reason},'/data-quality/profiles/run',{assetId:id('asset.'+key),domainId:ref('domain.'+scope),source:reason,datasetName:'DEMO '+key,csv:key==='invoice'?'id,supplier_id,amount\nINV-100,SUP-01,1250\nINV-101,,860\nINV-102,SUP-02,430':'id,department\nEMP-100,HR\nEMP-100,HR\nEMP-102,HR',createIssues:false,createRuleDrafts:false},'steward',{source:reason});
   const issueCode='DEMO_ISSUE_'+key.toUpperCase()+'_V1';const issue=await ensure('dq-issue.'+key,'dataQualityIssue',{code:issueCode},'/data-quality/issues',{code:issueCode,title:'DEMO — '+(key==='invoice'?'Missing supplier identifier':'Duplicate employee identifier'),description:reason,dimension,severity:'medium',priority:'P2',assetId:id('asset.'+key),source:reason,responsiblePersonId:(await actor('steward')).person.id},'steward',{source:reason});
   if(complete)await transition('dq-issue.'+key,'/data-quality/issues/'+issue.id+'/close',{resolutionSummary:reason+' Supplier identifier reconciled to SUP-02; all three synthetic rows checked.'},'data-owner','POST',x=>x.status!=='closed');
  }
 }],
 ['Duplicate resolution, golden records, reference and metadata history',async()=>{
  for(const [key,scope]of [['supplier','finance'],['employee','hr']]){
   const pair={sourceAssetId:id('asset.'+key),candidateAssetId:id('asset.'+key+'-copy')};
   const match=await ensure('mdm.'+key,'mdmMatchCandidate',pair,'/extended-domains/mdm/matches',{...pair,matchScore:96,sourceTrustRank:90,survivorshipRulesJson:{strategy:'source_trust_rank',sourceMode:'synthetic_demo'},proposedGoldenRecordJson:{name:key==='supplier'?'Fictional Cedar Supplies':'Fictional Employee 100',fixture:manifest.installationId}},'steward',pair);
   await transition('mdm.'+key,'/extended-domains/mdm/matches/'+match.id,{status:'merged',resolutionStep:'publish',resolutionNote:reason+' Independent review confirmed identifiers refer to the same fictional entity.'},'data-owner','PATCH',x=>x.status!=='merged');
   const code='DEMO_REF_'+scope.toUpperCase()+'_V1';const version=await ensure('reference.'+key,'referenceDataVersion',{code},'/extended-domains/reference/versions',{code,name:'DEMO — '+scope+' status codes',version:'1.0',domainId:ref('domain.'+scope),assetId:id('asset.'+key),changeSummary:reason,sourceTrustRank:95,valuesCount:3},'steward',{changeSummary:reason});
   if(key==='supplier')for(const decision of ['submit','approve','activate']){const wanted={submit:'draft',approve:'under_review',activate:'approved'}[decision];await transition('reference.'+key,'/extended-domains/reference/versions/'+version.id+'/decision',{decision},decision==='submit'?'steward':'data-owner','PATCH',x=>x.status===wanted);}
   const cert=await ensure('metadata.'+key,'metadataCertification',{assetId:id('asset.'+key),certificationNote:reason},'/extended-domains/metadata/certifications',{assetId:id('asset.'+key),qualityScore:94,completenessScore:97,ownerConfirmed:true,glossaryAligned:true,lineageReviewed:true,certificationNote:reason,expiresAt:'2027-10-09T00:00:00Z'},'steward',{certificationNote:reason});
   if(key==='supplier')await transition('metadata.'+key,'/extended-domains/metadata/certifications/'+cert.id,{status:'certified'},'data-owner','PATCH',x=>x.status!=='certified');
   const title='DEMO — '+scope+' source model review';const review=await ensure('architecture.'+key,'architectureReview',{title},'/extended-domains/architecture/reviews',{assetId:id('asset.'+key),title,architectureDecision:reason,lineageImpact:'Upstream synthetic source feeds the demonstration register.',riskLevel:'low'},'steward',{architectureDecision:reason});
   if(key==='supplier')await transition('architecture.'+key,'/extended-domains/architecture/reviews/'+review.id+'/decision',{decision:'approved',architectureDecision:reason},'data-owner','PATCH',x=>x.decision!=='approved');
  }
 }],
 ['Glossary, lineage, value, surveys, lifecycle, impact and KPIs',async()=>{
  for(const [key,scope,complete]of [['invoice','finance',true],['payroll','hr',false]]){
   const assetId=id('asset.'+key),domainId=ref('domain.'+scope);const termEn='DEMO — '+(key==='invoice'?'Invoice payable amount':'Payroll gross amount');
   const glossary=await ensure('glossary.'+key,'businessGlossaryTerm',{termEn},'/business-value/glossary',{termEn,termAr:key==='invoice'?'مبلغ الفاتورة المستحق':'إجمالي الراتب',definition:reason+' Amount before tax adjustments in the fictional dataset.',assetId,domainId},'steward',{termEn});
   if(complete)await transition('glossary.'+key,'/business-value/glossary/'+glossary.id,{status:'approved'},'data-owner','PATCH',x=>x.status!=='approved');
   const processName='DEMO — '+key+' processing';const sourceAssetId=id('asset.'+(key==='invoice'?'supplier':'employee'));
   const lineage=await ensure('lineage.'+key,'businessLineageMap',{processName},'/business-value/lineage',{processName,businessProcess:reason,technicalBridge:'Local synthetic CSV preparation',sourceAssetId,targetAssetId:assetId,domainId,impactScore:65,impactLevel:'high'},'steward',{processName});
   if(complete)await transition('lineage.'+key,'/business-value/lineage/'+lineage.id,{status:'verified'},'data-owner','PATCH',x=>x.status!=='verified');
   const useCase='DEMO — '+key+' processing time saved';const valuation=await ensure('valuation.'+key,'dataAssetValuation',{assetId,useCase},'/business-value/valuations',{assetId,useCase,valueDriver:reason,annualValue:120000,roiPercent:80,adoptionScore:75,surveyScore:85,ownerName:'Demonstration Data Owner'},'steward',{useCase});
   await ensure('survey.'+key,'dataUserSurvey',{valuationId:valuation.id,respondent:reason},'/business-value/surveys',{valuationId:valuation.id,assetId,respondent:reason,score:85,feedback:'Fictional users can locate definitions and accountable owners.'},'steward',{respondent:reason});
   const life=await ensure('lifecycle.'+key,'assetLifecycleDecision',{assetId,retentionBasis:reason},'/business-value/lifecycle',{assetId,proposedStatus:'active',retentionDecision:'retain',retentionBasis:reason},'steward',{retentionBasis:reason});
   if(complete)await transition('lifecycle.'+key,'/business-value/lifecycle/'+life.id,{status:'approved'},'data-owner','PATCH',x=>x.status==='proposed');
   await ensure('bia.'+key,'businessImpactAssessment',{processName},'/business-value/bia',{processName,assetId,domainId,impactScore:65,impactLevel:'high',rtoHours:8,revenueImpact:key==='invoice'?12000:0,citizenImpact:'Synthetic employees and suppliers only',operationalImpact:reason},'steward',{processName});
   const name='DEMO — '+key+' accountable records';await ensure('kpi.'+key,'dataValueKpi',{name},'/business-value/kpis',{name,valueType:'percentage',period:'2026-Q4',targetValue:100,actualValue:complete?100:65,unit:'%',useCase:reason,ownerName:'Demonstration Data Owner',assetId,domainId,status:complete?'realized':'measuring'},'steward',{name});
  }
 }]
]);
}finally{await finish();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
