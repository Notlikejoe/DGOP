module.exports=async function foundations(s){
 const {db,api,manifest,assert,ensure,atomic,fs,save,ref}=s;
 const reason=manifest.marker+'; synthetic demonstration; independently reviewed; no operational compliance proof.';
 for(const [code,needed] of Object.entries(s.definition.sharedRoleAiRequirements)){
  const role=await db.role.findUniqueOrThrow({where:{code},include:{permissions:{include:{permission:true}}}});
  const existing=role.permissions.map(x=>x.permission.resource+'.'+x.permission.action);
  if(needed.some(p=>!existing.includes(p)))await api('/roles/'+role.id+'/permissions',{permissions:[...new Set([...existing,...needed])],justification:reason+' Human explicitly approved these shared-role AI grants in 4208 only.'},'admin','PUT');
 }
 manifest.approvedExceptions??={};manifest.approvedExceptions.sharedRoleAiPermissions={grants:s.definition.sharedRoleAiRequirements,authorization:'Human approved required AI permissions in 4208 only',at:manifest.approvedExceptions.sharedRoleAiPermissions?.at??new Date().toISOString()};save();
 const credentials=JSON.parse(fs.readFileSync(manifest.credentialRef));
 for(const scope of ['finance','hr']){
  const key='owner-'+scope;let account=credentials.accounts.find(x=>x.key===key);
  if(!account){account={key,email:'demo.'+key+'@dgop.local',password:'Dm8!'+s.crypto.randomBytes(18).toString('base64url')};credentials.accounts.push(account);atomic(manifest.credentialRef,credentials);}
  const roleCodes=['AI_USECASE_OWNER','dgop_demo_support_v1'];
  const user=await ensure('user.'+key,'user',{email:account.email},'/users',{email:account.email,displayName:'DEMO — '+scope+' AI Use Case Owner',password:account.password,roleCodes,justification:reason},'admin',{email:account.email});
  const unit=await db.organizationUnit.findUniqueOrThrow({where:{id:ref('org.'+scope)}});
  await ensure('person.'+key,'person',{userId:user.id},'/people',{fullNameEn:'DEMO — '+scope+' AI Use Case Owner',fullNameAr:'عرض تجريبي — مالك حالة الذكاء الاصطناعي '+scope,email:account.email,userId:user.id,organization:unit.code,jobTitle:'AI use case business owner'},'admin',{organization:unit.code});
 }
 await s.native(async(get)=>{
  const publications=get('master-data/ai-reference-publication.service','AiReferencePublicationService');
  const load=(file)=>s.config.req(s.root+'/apps/api/dist/ai-governance/'+file+'.js');
  const {AI_CLASSIFICATION_CRITERIA}=load('ai-governance.contracts'),{RISK_DIMENSION_ROLES}=load('ai-risk-scoring');
  const classification=await db.classification.findFirstOrThrow({where:{isActive:true,deletedAt:null},orderBy:{rank:'desc'}});
  const source=JSON.parse(fs.readFileSync(s.root+'/scripts/data/sdaia-ai-risk-library.json'));
  const v=(code,labelEn=code,labelAr=labelEn,metadata={})=>({code,labelEn,labelAr,metadata});
  const sourceValues=(base,list)=>[...new Map([...base,...source.references[list]].map(x=>[x.code,x])).values()];
  const bands=[['LOW',1,2,'P4',365,'منخفض'],['MEDIUM',3,6,'P3',180,'متوسط'],['HIGH',8,12,'P2',90,'مرتفع'],['CRITICAL',16,16,'P1',1,'حرج']];
  const refs={
   L_STREAMS:[v('EFFICIENCY','Service efficiency','كفاءة الخدمات')],L_PROGRAMS:[v('OPERATIONS','Operations','العمليات')],L_HUMAN:[v('HUMAN_APPROVAL','Human approval','اعتماد بشري')],L_STAGE:[v('PILOT','Pilot','تجربة محدودة',{airsLifecycleCode:'PILOT'})],L_MODEL:[v('INTERNAL','Internal','داخلي',{thirdParty:false})],L_AVAIL:[v('AVAILABLE','Available','متاحة')],R_YN:[v('YES','Yes','نعم'),v('NO','No','لا')],L_CLASS:[v('RESTRICTED','Restricted','مقيدة',{assetClassificationCode:classification.code})],L_BUDGET:[v('FUNDED','Funded','معتمدة')],
   R_SDAIA_SCORE:[1,2,3,4,5].map(score=>v('SCORE_'+score,'Score '+score,'الدرجة '+score,{score,anchors:Object.fromEntries(AI_CLASSIFICATION_CRITERIA.map(c=>[c,{labelEn:'Synthetic '+c+' level '+score,labelAr:'معيار توضيحي '+c+' '+score}]))})),
   R_SDAIA_TIER:[v('MINIMAL','Minimal','قليلة',{automatic:true,minScore:1,maxScore:2,cadenceLevelCode:'LOW'}),v('LIMITED','Limited','محدودة',{automatic:true,minScore:3,maxScore:3,cadenceLevelCode:'MEDIUM'}),v('HIGH','High','عالية',{automatic:true,minScore:4,maxScore:5,cadenceLevelCode:'HIGH'}),v('UNACCEPTABLE','Unacceptable','غير مقبولة',{automatic:false})],
   R_SCORE14:[1,2,3,4].map(score=>v('SCORE_'+score,'Score '+score,'الدرجة '+score,{score,anchors:{likelihood:{en:'Synthetic likelihood '+score,ar:'احتمالية توضيحية '+score},impact:{en:'Synthetic impact '+score,ar:'أثر توضيحي '+score}}})),
   R_IMPD:Object.entries(RISK_DIMENSION_ROLES).map(([dimension,assessorRoleCode],i)=>v(dimension.toUpperCase(),dimension,dimension,{dimension,assessorRoleCode,tieBreakOrder:i+1})),
   R_LEVEL:bands.map(([code,minScore,maxScore,severityCode,,ar])=>v(code,code,ar,{minScore,maxScore,severityCode})),R_LEVEL_DAYS:bands.map(([code,,,,days,ar])=>v(code,code,ar,{days,intervalDays:days,firstReviewImmediate:code==='CRITICAL'})),R_CADENCE:bands.map(([code,,,,intervalDays,ar])=>v('CADENCE_'+code,intervalDays+' days',intervalDays+' يوم',{residualBandCode:code,intervalDays})),
   R_LIFECYCLE:sourceValues([v('PILOT','Pilot','تجربة محدودة')],'R_LIFECYCLE'),R_DEPT:await Promise.all(['finance','hr'].map(async scope=>v(scope.toUpperCase(),scope,scope==='finance'?'المالية':'الموارد البشرية',{adoptionFunction:true,organizationUnitId:ref('org.'+scope)}))),R_TECH:[v('ML','Machine learning','تعلم الآلة')],R_RELIANCE:[v('ASSISTED','Assisted','مساعد')],R_HITL:[v('REQUIRED','Human review required','مراجعة بشرية إلزامية')],R_UCSTATUS:[v('ACTIVE','Active','نشط')],
   R_RISKCAT:sourceValues([v('PRIVACY','Privacy','الخصوصية'),v('QUALITY','Quality','الجودة')],'R_RISKCAT'),R_ETHICS:sourceValues([v('PRIVACY','Privacy','الخصوصية'),v('FAIRNESS','Fairness','العدالة')],'R_ETHICS'),R_CTRLEFF:[v('EFFECTIVE','Effective','فعالة'),v('PARTIAL','Partial','جزئية')],R_STRATEGY:['AVOID','MITIGATE','TRANSFER','ACCEPT','ESCALATE'].map(c=>v(c)),R_SOURCE:[v('INTERNAL','Internal','داخلي')],R_INTENT:[v('UNINTENDED','Unintended','غير مقصود')],R_TIMING:[v('CURRENT','Current','حالي')],R_ACTTYPE:['PREVENTIVE','DETECTIVE','CORRECTIVE','IMPROVEMENT'].map(c=>v(c)),R_PRIORITY:['LOW','NORMAL','HIGH','CRITICAL'].map(c=>v(c,c,c,{dgopPriorityCode:c})),R_TREATSTATUS:[v('PLANNED'),v('IN_PROGRESS'),v('COMPLETED')]
  };
  manifest.ai??={references:{},cases:[],pending:[]};const officer=await s.actor('officer'),ethics=await s.actor('ethics'),admin=await s.actor('admin');
  for(const [code,values] of Object.entries(refs)){
   const locator='synthetic_demo:'+manifest.installationId+':'+code;
   let current=await db.governedReferenceVersion.findFirst({where:{listCode:code,state:'published'}});
   if(current){assert.equal(current.sourceLocator,locator,'Conflicting governed reference '+code);manifest.ai.references[code]=current.id;save();continue;}
   current=await db.governedReferenceVersion.findFirst({where:{listCode:code,sourceLocator:locator}});
   if(!current)current=await publications.propose(officer.id,code,{nameEn:code+' — synthetic demonstration',nameAr:code+' — عرض تجريبي',justification:reason,sourceSha256:s.digest(values),sourceLocator:locator,values:values.map((x,sortOrder)=>({...x,sortOrder}))});
   manifest.ai.references[code]=current.id;save();
   if(['R_ETHICS','R_RISKCAT','R_SDAIA_TIER','R_LEVEL_DAYS','R_MINSCORE'].includes(code)&&current.state!=='approved')await publications.approve(ethics.id,current.id,reason);
   await publications.publish(admin.id,current.id,reason);console.log('Published governed reference '+code);
  }save();
 });
};
