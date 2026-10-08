module.exports=async function reporting(s){await s.native(async get=>{
 const annual=get('ai-governance/ai-annual-review.service','AiAnnualReviewService'),monthly=get('ai-governance/ai-monthly-review.service','AiMonthlyReviewService'),reports=get('ai-governance/ai-dashboard-reports.service','AiDashboardReportsService');
 const officer=await s.actor('officer'),evidenceIds=[s.id('proof.finance')],reason=s.manifest.marker+'; synthetic exercise, no organizational compliance acceptance.';
 s.manifest.ai.reporting??={};
 for(const scope of ['finance','hr']){
  const unit=s.ref('org.'+scope);let context=await annual.context(officer.id,unit);
  if(context.canRegister)await annual.register(officer.id,unit);
  context=await annual.context(officer.id,unit);
  if(!context.history.some(r=>r.completion)){const r=context.history.find(r=>r.canComplete);s.assert(r);await annual.complete(officer.id,r.id,{expectedRound:r.round,expectedHandoverRound:r.handoverRound,trendsSummary:reason+' Reviewed current synthetic risk and treatment trends.',controlEffectivenessSummary:'Human approval, masked examples and quality review were demonstrated; production effectiveness remains untested.',nonconformitySummary:'No real operational proof is supplied. Retain manual oversight and reassess before real use.',evidenceIds});}
  const now=new Date(),month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
  if(!await s.db.aiMonthlyReviewReport.findUnique({where:{organizationUnitId_periodMonth:{organizationUnitId:unit,periodMonth:month}}}))await monthly.capture(officer.id,unit,month);
  let snapshot=await s.db.aiDashboardSnapshot.findFirst({where:{organizationUnitId:unit,frequency:'manual',createdBy:officer.id}});if(!snapshot)snapshot=await reports.capture(officer.id,unit);
  let schedule=await s.db.aiDashboardScheduleVersion.findFirst({where:{organizationUnitId:unit}});if(!schedule)schedule=await reports.configure(officer.id,unit,{expectedRound:0,dailyEnabled:true,monthlyEnabled:true,justification:reason+' Local report schedule; worker remains disabled.',evidenceIds});
  s.manifest.ai.reporting[scope]={annualHistory:(await annual.context(officer.id,unit)).history.map(r=>({id:r.id,status:r.status})),monthlyMonth:month,dashboardSnapshotId:snapshot.id,scheduleVersionId:schedule.id,workerEnabled:false};s.save();
 }
});};
