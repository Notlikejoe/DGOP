// Explicit local demonstration installer. Never targets the original or a remote database.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
Object.assign(process.env,parseEnv(readFileSync(resolve(root,'.env'),'utf8')));
const connection=new URL(process.env.DATABASE_URL);
if(process.argv[2]!=='--local-demo'||connection.hostname!=='127.0.0.1'||connection.port!=='55436'||!/^\/dgop_ai_preview_\d+$/.test(connection.pathname)||process.env.NODE_ENV!=='development')throw Error('Explicit isolated local preview required; original database is prohibited');
const require=createRequire(resolve(root,'apps/api/package.json'));
const {NestFactory}=require('@nestjs/core'),{AppModule}=require(resolve(root,'apps/api/dist/app.module.js'));
const load=(name,klass)=>require(resolve(root,'apps/api/dist',name+'.js'))[klass];
const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
const db=app.get(load('prisma/prisma.service','PrismaService')),audit=app.get(load('audit/audit.service','AuditService'));
const retryService=service=>new Proxy(service,{get(target,key){const member=target[key];if(typeof member!=='function')return member;return async(...args)=>{for(let n=0;;n++)try{return await member.apply(target,args);}catch(e){if(n>=7||!(e.code==='P2034'||e.code==='P2002'&&JSON.stringify(e.meta?.target).includes('previousHash')))throw e;await new Promise(done=>setTimeout(done,40*(n+1)));}};}});
const get=(file,name)=>retryService(app.get(load('ai-governance/'+file,name)));
const manifestPath=resolve(root,'storage/ai-preview/demo-manifest.json');
const credentialsPath=resolve(root,'../../outputs/DGOP_AI_Demo_Logins.local.json');
const manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):{demoOnly:true,database:connection.pathname.slice(1),actors:{},cases:[],references:{}};
if(manifest.demoOnly!==true||manifest.database!==connection.pathname.slice(1))throw Error('Demo manifest belongs to another database');
const credentials=existsSync(credentialsPath)?JSON.parse(readFileSync(credentialsPath,'utf8')):{previewUrl:'http://localhost:4206/',demoOnly:true,accounts:[]};
const save=()=>{writeFileSync(manifestPath,JSON.stringify(manifest,null,2));writeFileSync(credentialsPath,JSON.stringify(credentials,null,2));};
const digest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const riskLibrarySource=JSON.parse(readFileSync(resolve(root,'scripts/data/sdaia-ai-risk-library.json'),'utf8'));
const reason='User-requested isolated demonstration; synthetic evidence/configuration, no actual organization approval or migration pilot acceptance';
const actors={};
try {
 const demoActorRoles={
  showcase:['AI_GOVERNANCE_OFFICER','AI_WORKING_GROUP','dmo_admin'],working:['AI_WORKING_GROUP'],officer:['AI_GOVERNANCE_OFFICER'],owner:['AI_USECASE_OWNER'],riskOwner:['AI_RISK_OWNER'],dataOwner:['data_owner'],executive:['AI_EXECUTIVE_TEAM'],ethics:['AI_ETHICS_COMMITTEE'],custodian:['dmo_admin'],privacy:['privacy_officer'],security:['security_reviewer'],model:['AI_MODEL_OWNER'],mlops:['AI_MLOPS_LEAD'],business:['business_steward'],steering:['STEERING_COMMITTEE'],
  compliance:['AI_COMPLIANCE_OFFICER'],auditor:['auditor'],executiveViewer:['executive'],workflowDesigner:['workflow_designer'],workflowPublisher:['workflow_publisher'],workflowReviewer:['workflow_reviewer'],administrator:['system_admin'],
 };
 credentials.previewUrl='http://localhost:4206/';
 for(const [key,roles] of Object.entries(demoActorRoles)){
  const email=`demo.${key.toLowerCase()}@dgop.local`;let user=await db.user.findUnique({where:{email}});
  if(!user){const password=randomBytes(18).toString('base64url'),passwordHash=await require('bcryptjs').hash(password,12);
   user=await db.$transaction(async tx=>{const roleRows=await tx.role.findMany({where:{code:{in:roles},isActive:true,deletedAt:null}});if(roleRows.length!==roles.length)throw Error('Required installed demo role missing');const u=await tx.user.create({data:{email,displayName:`Demo · ${key}`,passwordHash,userRoles:{create:roleRows.map(r=>({roleId:r.id}))}}});await audit.logRequired({actor:'local-ai-demo',action:'ai.demo.actor.created',entityType:'user',entityId:u.id,metadata:{roles,reason,demoOnly:true}},tx);return u;});
   credentials.accounts.push({email,password,roles,purpose:key});
  }else if(manifest.actors[key]!==user.id)throw Error('Existing account is outside this demo manifest');
  const person=await db.person.upsert({where:{userId:user.id},create:{userId:user.id,email,fullNameEn:`Demo ${key}`,fullNameAr:`حساب تجريبي ${key}`},update:{}});
  actors[key]={...user,person};manifest.actors[key]=user.id;save();
 }
 const unit=await db.organizationUnit.upsert({where:{code:'DGOP_DEMO_ORG'},create:{code:'DGOP_DEMO_ORG',nameEn:'Organization — Demonstration',nameAr:'الجهة — بيانات توضيحية'},update:{}});
 const domain=await db.dataDomain.upsert({where:{code:'DGOP_DEMO_AI'},create:{code:'DGOP_DEMO_AI',nameEn:'AI services — Demonstration',nameAr:'خدمات الذكاء الاصطناعي — بيانات توضيحية'},update:{}});
 const classification=await db.classification.upsert({where:{code:'DGOP_DEMO_RESTRICTED'},create:{code:'DGOP_DEMO_RESTRICTED',nameEn:'Restricted',nameAr:'مقيدة',rank:2,color:'#f59e0b'},update:{}});
 await db.person.update({where:{id:actors.owner.person.id},data:{organization:unit.code}});
 await db.roleType.upsert({where:{code:'data_owner'},create:{code:'data_owner',nameEn:'Data Owner',nameAr:'مالك البيانات'},update:{}});
 const {AI_CLASSIFICATION_CRITERIA}=require(resolve(root,'apps/api/dist/ai-governance/ai-governance.contracts'));
 const {RISK_DIMENSION_ROLES}=require(resolve(root,'apps/api/dist/ai-governance/ai-risk-scoring'));
 const value=(code,labelEn=code,labelAr=labelEn,metadata={})=>({code,labelEn,labelAr,metadata});
 const sourceValues=(base,listCode)=>[...new Map([...base,...riskLibrarySource.references[listCode]].map(v=>[v.code,v])).values()];
 const bands=[['LOW',1,2,'P4',365,'منخفض'],['MEDIUM',3,6,'P3',180,'متوسط'],['HIGH',8,12,'P2',90,'مرتفع'],['CRITICAL',16,16,'P1',1,'حرج']];
 const refs={
  L_STREAMS:[value('EFFICIENCY','Service efficiency','كفاءة الخدمات')],L_PROGRAMS:[value('OPERATIONS','Operations','العمليات')],L_HUMAN:[value('HUMAN_APPROVAL','Human approval','اعتماد بشري')],L_STAGE:[value('PILOT','Pilot','تجربة محدودة',{airsLifecycleCode:'PILOT'})],L_MODEL:[value('INTERNAL','Internal','داخلي',{thirdParty:false})],L_AVAIL:[value('AVAILABLE','Available','متاحة')],R_YN:[value('YES','Yes','نعم'),value('NO','No','لا')],L_CLASS:[value('RESTRICTED','Restricted','مقيدة',{assetClassificationCode:classification.code})],L_BUDGET:[value('FUNDED','Funded','معتمدة')],
  R_SDAIA_SCORE:[1,2,3,4,5].map(score=>value(`SCORE_${score}`,`Score ${score}`,`الدرجة ${score}`,{score,anchors:Object.fromEntries(AI_CLASSIFICATION_CRITERIA.map(c=>[c,{labelEn:`Demonstration ${c} level ${score}`,labelAr:`معيار توضيحي ${c} ${score}`}]))})),
  R_SDAIA_TIER:[value('MINIMAL','Minimal','قليلة',{automatic:true,minScore:1,maxScore:2,cadenceLevelCode:'LOW'}),value('LIMITED','Limited','محدودة',{automatic:true,minScore:3,maxScore:3,cadenceLevelCode:'MEDIUM'}),value('HIGH','High','عالية',{automatic:true,minScore:4,maxScore:5,cadenceLevelCode:'HIGH'}),value('UNACCEPTABLE','Unacceptable','غير مقبولة',{automatic:false})],
  R_SCORE14:[1,2,3,4].map(score=>value(`SCORE_${score}`,`Score ${score}`,`الدرجة ${score}`,{score,anchors:{likelihood:{en:`Demonstration likelihood ${score}`,ar:`احتمالية توضيحية ${score}`},impact:{en:`Demonstration impact ${score}`,ar:`أثر توضيحي ${score}`}}})),
  R_IMPD:Object.entries(RISK_DIMENSION_ROLES).map(([dimension,assessorRoleCode],i)=>value(dimension.toUpperCase(),dimension,dimension,{dimension,assessorRoleCode,tieBreakOrder:i+1})),
  R_LEVEL:bands.map(([code,minScore,maxScore,severityCode,,ar])=>value(code,code,ar||code,{minScore,maxScore,severityCode})),
  R_LEVEL_DAYS:bands.map(([code,,,,days,ar])=>value(code,code,ar,{days,intervalDays:days,firstReviewImmediate:code==='CRITICAL'})),
  R_CADENCE:bands.map(([code,,,,intervalDays,ar])=>value('CADENCE_'+code,`${intervalDays} days`,`${intervalDays} يوم`,{residualBandCode:code,intervalDays})),
  R_LIFECYCLE:sourceValues([value('PILOT','Pilot','تجربة محدودة')],'R_LIFECYCLE'),R_DEPT:[value('OPERATIONS','Operations','العمليات',{adoptionFunction:true,organizationUnitId:unit.id})],R_TECH:[value('ML','Machine learning','تعلم الآلة')],R_RELIANCE:[value('ASSISTED','Assisted','مساعد')],R_HITL:[value('REQUIRED','Human review required','مراجعة بشرية إلزامية')],R_UCSTATUS:[value('ACTIVE','Active','نشط')],
  R_RISKCAT:sourceValues([value('PRIVACY','Privacy','الخصوصية'),value('QUALITY','Quality','الجودة')],'R_RISKCAT'),R_ETHICS:sourceValues([value('PRIVACY','Privacy','الخصوصية'),value('FAIRNESS','Fairness','العدالة')],'R_ETHICS'),R_CTRLEFF:[value('EFFECTIVE','Effective','فعالة'),value('PARTIAL','Partial','جزئية')],R_STRATEGY:['AVOID','MITIGATE','TRANSFER','ACCEPT','ESCALATE'].map(c=>value(c)),R_SOURCE:[value('INTERNAL','Internal','داخلي')],R_INTENT:[value('UNINTENDED','Unintended','غير مقصود')],R_TIMING:[value('CURRENT','Current','حالي')],R_ACTTYPE:['PREVENTIVE','DETECTIVE','CORRECTIVE','IMPROVEMENT'].map(c=>value(c)),R_PRIORITY:['LOW','NORMAL','HIGH','CRITICAL'].map(c=>value(c,c,c,{dgopPriorityCode:c})),R_TREATSTATUS:[value('PLANNED'),value('IN_PROGRESS'),value('COMPLETED')]
 };
 const publications=retryService(app.get(load('master-data/ai-reference-publication.service','AiReferencePublicationService')));
 for(const [code,values] of Object.entries(refs)){
  const current=await db.governedReferenceVersion.findFirst({where:{listCode:code,state:'published'}});
  if(current){if(manifest.references[code]!==current.id)throw Error(`Existing ${code} publication is outside this installer`);continue;}
  const v=await publications.propose(actors.officer.id,code,{nameEn:`${code} — local demonstration`,nameAr:`${code} — إعداد توضيحي محلي`,justification:reason,sourceSha256:digest(values),sourceLocator:'local-demonstration:seed-ai-demo-v1',values:values.map((v,sortOrder)=>({...v,sortOrder}))});
  if(['R_ETHICS','R_RISKCAT','R_SDAIA_TIER','R_LEVEL_DAYS','R_MINSCORE'].includes(code))await publications.approve(actors.ethics.id,v.id,reason);
  await publications.publish(actors.custodian.id,v.id,reason);manifest.references[code]=v.id;save();
 }
 const evidenceDomain=await db.ndiDomain.upsert({where:{code:'DGOP_AI_DEMO'},create:{code:'DGOP_AI_DEMO',nameEn:'AI demonstration evidence',nameAr:'أدلة توضيحية للذكاء الاصطناعي'},update:{}});
 const spec=await db.ndiSpecification.upsert({where:{code:'DGOP-AI-DEMO-001'},create:{code:'DGOP-AI-DEMO-001',domainId:evidenceDomain.id,nameEn:'Synthetic demonstration record',nameAr:'سجل توضيحي اصطناعي'},update:{}});
 if(!manifest.evidenceId){const body=Buffer.from('# Local AI demonstration evidence\n\n'+reason+'\nNo real assessor, organization approval, policy acceptance or production pilot is represented.\n');const folder=resolve(root,'storage/evidence');mkdirSync(folder,{recursive:true});writeFileSync(resolve(folder,'dgop-ai-demo-evidence.txt'),body);const e=await db.ndiEvidence.create({data:{specId:spec.id,title:'DEMO ONLY — synthetic decisions and control evidence',fileName:'dgop-ai-demo-evidence.txt',originalName:'dgop-ai-demo-evidence.txt',mimeType:'text/plain',sizeBytes:body.length,sha256:digest(body),submittedBy:actors.showcase.id,status:'approved',reviewedBy:actors.officer.id,reviewedAt:new Date()}});manifest.evidenceId=e.id;save();}
 const evidenceIds=[manifest.evidenceId],intake=get('ai-intake.service','AiIntakeService'),classify=get('ai-classification.service','AiClassificationService'),decide=get('ai-decision.service','AiDecisionService'),register=get('ai-registration.service','AiRegistrationService'),risks=get('ai-risk-intake.service','AiRiskIntakeService'),assess=get('ai-risk-assessment.service','AiRiskAssessmentService'),adopt=get('ai-risk-adoption.service','AiRiskAdoptionService'),response=get('ai-risk-response.service','AiRiskResponseService'),treat=get('ai-treatment.service','AiTreatmentService'),residual=get('ai-residual-assessment.service','AiResidualAssessmentService'),authority=get('ai-residual-decision.service','AiResidualDecisionService'),review=get('ai-risk-review.service','AiRiskReviewService');
 const version=async id=>(await db.aiRisk.findUniqueOrThrow({where:{id}})).version;
 const ucVersion=async id=>(await db.aiUseCase.findUniqueOrThrow({where:{id}})).version;
 const decision=expectedVersion=>({expectedVersion,decision:'approve',justification:reason,evidenceIds,conditions:['DEMO ONLY: retain human oversight and evidence; no production approval']});
 const roleActor=role=>Object.values(actors).find(a=>a.id!==actors.showcase.id&&credentials.accounts.find(c=>c.email===a.email)?.roles.includes(role));
 const demoProfiles=[
  {name:'Document Classification Assistant',riskTitle:'DEMO — Misclassification or document exposure',riskCategory:'PRIVACY',ethicsPrinciple:'PRIVACY'},
  {name:'Service Request Routing Assistant',riskTitle:'DEMO — Incorrect routing or uneven service',riskCategory:'QUALITY',ethicsPrinciple:'FAIRNESS'},
  {name:'Policy Guidance Assistant',riskTitle:'DEMO — Outdated or unsupported policy guidance',riskCategory:'QUALITY',ethicsPrinciple:'FAIRNESS'},
 ];
 for(const [index,profile] of demoProfiles.entries()){
  const {name,riskTitle,riskCategory,ethicsPrinciple}=profile;
  let m=manifest.cases[index];if(m?.complete)continue;
  if(!m){const d=await intake.createDraft(actors.showcase.id,{usecase_name:'DEMO — '+name,proposed_owner:actors.owner.id});m={useCaseId:d.id,name,stage:'draft',demoOnly:true};manifest.cases[index]=m;save();}
  const id=m.useCaseId;
  if(m.stage==='draft'){
   if(!(await db.aiUseCase.findUniqueOrThrow({where:{id}})).workflowCaseId){const payload={request_date:new Date().toISOString().slice(0,10),requester:actors.showcase.id,usecase_name:'DEMO — '+name,proposed_owner:actors.owner.id,strategic_streams:['EFFICIENCY'],values_alignment:'Transparent and accountable service delivery',program_platform:'OPERATIONS',problem_desc:index?'Manual service routing delays responses':'Manual document categorization takes too long',beneficiary_group:'Organization service teams',current_state:'Human teams review every request manually',objective_value:'Reduce handling time while preserving human oversight',success_kpi:'Median handling time in minutes',kpi_baseline:'30',kpi_target:'10',simpler_alternatives:{answer:true,justification:'Demonstration comparison of rules and supervised machine learning'},existing_solutions_check:{answer:true,details:'Existing organization tools reviewed for this demonstration'},human_role:'HUMAN_APPROVAL',target_stage:'PILOT',execution_model:'INTERNAL',data_source:'Synthetic demonstration documents and requests',data_owner:actors.dataOwner.id,data_availability:'AVAILABLE',personal_data_flag:'YES',data_classification:'RESTRICTED',budget_band:'FUNDED',executive_sponsor:actors.executive.id,constraints_dependencies:{text:'Local demonstration only',none:false},attachments:evidenceIds};
   await intake.updateDraft(actors.showcase.id,id,await ucVersion(id),payload);await intake.submit(actors.showcase.id,id,await ucVersion(id));await intake.triage(actors.working.id,id,await ucVersion(id),'accept');await classify.assess(actors.working.id,id,await ucVersion(id),{kind:'classification',scores:Array.from({length:6},()=>({value:index?4:3,justification:reason}))});await classify.verify(actors.officer.id,id,await ucVersion(id));}
   for(let n=0;n<10;n++){const tasks=await db.workflowTask.findMany({where:{caseId:(await db.aiUseCase.findUniqueOrThrow({where:{id}})).workflowCaseId,status:'pending',templateStage:{is:{code:{in:['aiuc-privacy-review','aiuc-security-review','aiuc-ethics-review']}}}}});if(!tasks.length)break;for(const t of tasks)await classify.reviewGate(roleActor(t.assigneeRoleCode).id,id,t.id,await ucVersion(id),'approve',reason,evidenceIds);}
   const uc=await db.aiUseCase.findUniqueOrThrow({where:{id}}),task=await db.workflowTask.findFirst({where:{caseId:uc.workflowCaseId,status:'pending',templateStage:{is:{code:'aiuc-decision'}}}});if(task)await decide.record(roleActor(task.assigneeRoleCode).id,id,task.id,{...decision(await ucVersion(id)),conditions:undefined});
   const handover=await db.workflowTask.findFirstOrThrow({where:{caseId:uc.workflowCaseId,status:'pending',templateStage:{is:{code:'aiuc-asset-registration'}}}});const proposed=await register.propose(actors.working.id,id,handover.id,{expectedVersion:await ucVersion(id),justification:reason,mode:'create',nameEn:name+' — Demonstration',nameAr:index?'مساعد توجيه طلبات الخدمة — توضيحي':'مساعد تصنيف المستندات — توضيحي',assetSubtype:'recommendation_system',domainId:domain.id,classificationId:classification.id});await register.decide(actors.dataOwner.id,id,proposed.nextTaskId,decision(await ucVersion(id)));m.riskId=(await db.aiRisk.findUniqueOrThrow({where:{aiucHandoffSourceId:id}})).id;m.stage='risk';save();
  }
  const riskId=m.riskId;
  if(m.stage==='risk'){
   if(!(await db.aiRisk.findUniqueOrThrow({where:{id:riskId}})).riskRef){await risks.assign(actors.working.id,riskId,{expectedVersion:await version(riskId),ownerUserId:actors.riskOwner.id,justification:reason});await risks.save(actors.riskOwner.id,riskId,await version(riskId),{title:riskTitle,cause:'Synthetic model and data quality weaknesses',event:'An incorrect recommendation is presented',effect:'Service quality or privacy could be affected',current_controls:'Human review, restricted access and synthetic inputs',risk_category:riskCategory,ethics_principle:ethicsPrinciple,dev_stage:'PILOT',control_effectiveness:'PARTIAL',risk_source:'INTERNAL',risk_intent:'UNINTENDED',risk_timing:'CURRENT',third_party_involved:false,evidence:evidenceIds,notes:reason});await risks.submit(actors.riskOwner.id,riskId,await version(riskId));}if((await assess.context(actors.riskOwner.id,riskId)).canStart)await assess.start(actors.riskOwner.id,riskId,await version(riskId));for(const t of (await assess.context(actors.riskOwner.id,riskId)).tasks.filter(t=>t.score===null))await assess.contribute(roleActor(t.assessorRoleCode).id,riskId,t.id,{expectedVersion:await version(riskId),value:4,justification:reason});if((await assess.context(actors.riskOwner.id,riskId)).canComplete)await assess.complete(actors.riskOwner.id,riskId,{expectedVersion:await version(riskId),likelihood:3,justification:reason});let a=await adopt.context(actors.officer.id,riskId);if(a.canPrepare)await adopt.prepare(actors.officer.id,riskId,await version(riskId));a=await adopt.context(actors.officer.id,riskId);for(const t of [...a.tasks].sort((a,b)=>a.kind==='ethics'?-1:1))await adopt.review(t.kind==='ethics'?actors.ethics.id:actors.officer.id,riskId,t.id,decision(await version(riskId)));if((await response.context(actors.riskOwner.id,riskId)).canPrepare)await response.prepare(actors.riskOwner.id,riskId,await version(riskId));if((await response.context(actors.riskOwner.id,riskId)).canPropose)await response.propose(actors.riskOwner.id,riskId,{expectedVersion:await version(riskId),strategyCode:'MITIGATE',justification:reason,evidenceIds,offshoreProcessing:false});const c=await response.context(actors.officer.id,riskId);if(c.tasks.some(t=>t.kind==='officer'))await response.decide(actors.officer.id,riskId,c.tasks.find(t=>t.kind==='officer').id,decision(await version(riskId)));m.stage='treatment';save();
  }
  if(m.stage==='treatment'){
   const existing=await db.aiTreatmentAction.findMany({where:{riskId,deletedAt:null}});for(let n=existing.length;n<2;n++)await treat.save(actors.riskOwner.id,riskId,{expectedVersion:await version(riskId),title:n?'DEMO — Validate fairness and routing quality':'DEMO — Enforce access and human review',description:reason,actionType:n?'DETECTIVE':'PREVENTIVE',priorityCode:'HIGH',assigneeUserId:actors.model.id,targetDate:new Date(Date.now()+14*86400000).toISOString().slice(0,10),evidenceRequired:'Synthetic local demonstration validation record',evidenceIds,taskType:'evidence_upload'});await treat.submit(actors.riskOwner.id,riskId,await version(riskId));const c=await treat.context(actors.officer.id,riskId);await treat.review(actors.officer.id,riskId,c.taskId,decision(await version(riskId)));for(const action of await db.aiTreatmentAction.findMany({where:{riskId,deletedAt:null}}))await treat.execute(actors.model.id,riskId,action.id,{expectedVersion:await version(riskId),completionPct:100,justification:reason,evidenceIds});m.stage='residual';save();
  }
  if(m.stage==='residual'){
   await residual.start(actors.riskOwner.id,riskId,await version(riskId));for(const t of (await residual.context(actors.riskOwner.id,riskId)).tasks)await residual.contribute(roleActor(t.assessorRoleCode).id,riskId,t.id,{expectedVersion:await version(riskId),value:index?2:1,justification:reason});await residual.complete(actors.riskOwner.id,riskId,{expectedVersion:await version(riskId),likelihood:2,justification:reason,currentControls:'Human oversight, access controls and demonstrated quality checks',controlEffectivenessCode:'EFFECTIVE'});
   for(let n=0;n<5;n++){const c=await authority.context(actors.officer.id,riskId);if(!c.tasks.length)break;const t=c.tasks[0],user=t.kind==='accept_owner'?actors.owner:t.kind==='ethics'?actors.ethics:t.kind==='executive'?actors.executive:actors.officer;await authority.decide(user.id,riskId,t.id,{...decision(await version(riskId)),decision:['accept_owner','countersign','executive'].includes(t.kind)?'accept':'approve'});}
   await review.register(actors.officer.id,riskId,await version(riskId));m.stage='monitoring';save();
  }
  if(m.stage==='monitoring'){const c=await review.context(actors.riskOwner.id,riskId);const r=c.history.find(r=>r.canComplete);if(r)await review.complete(actors.riskOwner.id,riskId,r.id,{expectedVersion:await version(riskId),justification:reason,evidenceIds});m.complete=true;save();}
  console.log(`Completed local demonstration: ${name}`);
 }
 if(!manifest.sourcePreviewId){const s=await get('ai-migration-preview.service','AiMigrationPreviewService').create(actors.officer.id,{requestKey:require('node:crypto').randomUUID(),justification:reason,evidenceIds});manifest.sourcePreviewId=s.id;save();}
 const annual=get('ai-annual-review.service','AiAnnualReviewService');if((await annual.context(actors.officer.id,unit.id)).canRegister)await annual.register(actors.officer.id,unit.id);
 if(!manifest.dashboardCaptureId){const r=await get('ai-dashboard-reports.service','AiDashboardReportsService').capture(actors.officer.id,unit.id);manifest.dashboardCaptureId=r.id;save();}
 if(!manifest.completeExampleCaptureId){const r=await get('ai-dashboard-reports.service','AiDashboardReportsService').capture(actors.officer.id,unit.id);manifest.completeExampleCaptureId=r.id;save();}
 manifest.endToEndExample={useCaseId:manifest.cases[2].useCaseId,riskId:manifest.cases[2].riskId,dashboardCaptureId:manifest.completeExampleCaptureId,complete:manifest.cases[2].complete===true,demoOnly:true};save();
 console.log('Three complete local AI demonstrations installed, including treatment, monitoring and a saved reporting capture. Private login details saved to outputs/DGOP_AI_Demo_Logins.local.json; original accounts/database unchanged.');
}finally{await app.close();}
