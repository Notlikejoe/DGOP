const c=require('./access-sync-common.cjs'),assert=require('node:assert/strict');
const {Prisma}=c.req('@prisma/client');
const models=Prisma.dmmf.datamodel.models;
const quote=value=>{assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value));return '"'+value+'"';};
const sql=models.map(m=>{const deleted=m.fields.find(f=>f.name==='deletedAt');return "SELECT '"+m.name+"' AS model, count(*)::int AS stored, "+(deleted?'count(*) FILTER (WHERE '+quote(deleted.dbName??deleted.name)+' IS NULL)':'count(*)')+'::int AS live FROM '+quote(m.dbName??m.name);}).join(' UNION ALL ');
(async()=>{try{
 const result=await c.db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const identity=await tx.$queryRaw`SELECT current_database() AS name`;assert.equal(identity[0].name,'dgop_access_sync_qa_20261007');
  const counts=await tx.$queryRawUnsafe(sql),groups={};
  for(const name of ['AiUseCase','AiRisk','AiAssessmentRound','AiTreatmentAction','AiRiskReview','AiAnnualReview','AiMonthlySnapshot','AiMigrationPreview','WorkflowCase','WorkflowTask','NdiEvidence','PrivacyDsrRequest','DataQualityIssue']){
   const model=models.find(m=>m.name===name);if(!model)continue;
   const delegate=tx[name[0].toLowerCase()+name.slice(1)],fields=model.fields.filter(f=>['status','state','type','kind','provenance','isSampleData'].includes(f.name)&&f.kind!=='object'&&!f.isList).map(f=>f.name);
   for(const field of fields)groups[name+'.'+field]=await delegate.groupBy({by:[field],_count:{_all:true},...(model.fields.some(f=>f.name==='deletedAt')?{where:{deletedAt:null}}:{})});
  }
  const cases=await tx.aiUseCase.findMany({where:{deletedAt:null},select:{id:true,assetId:true,isSampleData:true,workflowCase:{select:{type:true,status:true}}}});
  return{checkedAt:new Date().toISOString(),database:identity[0].name,readOnly:true,counts,groups,aiUseCaseSummary:{total:cases.length,assetLinked:cases.filter(r=>r.assetId).length,workflowLinked:cases.filter(r=>r.workflowCase).length,sampleMarked:cases.filter(r=>r.isSampleData).length,workflowStatuses:cases.reduce((a,r)=>{const key=r.workflowCase?.status??'no_workflow';a[key]=(a[key]??0)+1;return a;},{})}};
 },{timeout:30000});
 const file=c.state+'/evidence/population-'+new Date().toISOString().replaceAll(':','-')+'.json';c.atomic(file,result);
 const core=['DataAsset','StewardshipAssignment','AssignmentRule','WorkflowCase','WorkflowTask','DataQualityIssue','DataQualityRule','DataQualityProfile','MaskingPolicy','AccessReview','AccessGrant','DlpIncident','ClassificationChangeRequest','OpenDataCandidate','OpenDataPublication','FoiRequest','PrivacyRopaRecord','PrivacyDpia','PrivacyDsrRequest','PrivacyBreach','PrivacyConsentRecord','PrivacyRetentionRule','DataSharingRequest','DataSharingAgreement','NdiSpecification','NdiEvidence','NdiAuditPack','IntegrationConnector','IntegrationJob','MdmMatchCandidate','MdmGoldenRecord','ReferenceDataVersion','MetadataCertification','ArchitectureReview','BusinessGlossaryTerm','BusinessLineageMap','DataAssetValuation','DataUserSurvey','AssetLifecycleDecision','BusinessImpactAssessment','DataValueKpi','GovernanceNotification','GovernanceEscalation','GovernanceCharter','GovernancePolicy','DataDomainCouncil','GovernanceMaturityAssessment','TrainingCourse','TrainingAssignment','CertificationAttempt','CommunityArticle','ExpertProfile','MentorshipPair'];
 console.log(JSON.stringify({file,checkedAt:result.checkedAt,database:result.database,core:result.counts.filter(r=>core.includes(r.model)),ai:result.counts.filter(r=>r.model.startsWith('Ai')),groups:result.groups,aiUseCaseSummary:result.aiUseCaseSummary},null,2));
}catch(e){console.error(e.message);process.exitCode=1;}finally{await c.db.$disconnect();}})();
