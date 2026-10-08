import assert from 'node:assert/strict';
import { AiDashboardService, projectRisk } from '../src/ai-governance/ai-dashboard.service';
import { reportingAssessments, indexBy, ReportAssessment } from '../src/ai-governance/ai-reporting-projection';
import { governanceDigest } from '../src/ai-governance/ai-governance-ledger';
import { reviewMeasures } from '../src/ai-governance/ai-review-report.service';
const old=new Date('2026-01-01'),now=new Date('2026-02-01'),payload={name:'effective'},risk={id:'risk',version:2};
const config={id:'config',sourceRequestId:'request',tierCode:'HIGH',payload,createdAt:now,riskSnapshot:[{riskId:'risk',version:2,configurationDigest:governanceDigest(payload),score:4,bandCode:'MEDIUM'}]};
const native:ReportAssessment[]=[{id:'inherent-old',riskId:'risk',kind:'inherent',round:1,result:{score:16,bandCode:'CRITICAL'},inputs:{},createdAt:old},{id:'residual-old',riskId:'risk',kind:'residual',round:1,result:{score:1},inputs:{inherentAssessmentId:'inherent-old'},createdAt:old}];
assert.deepEqual(reportingAssessments(risk,native,null),native);
assert.deepEqual(reportingAssessments(risk,native,{...config,sourceRequestId:null}),native);
const current=reportingAssessments(risk,native,config);assert.equal(current.length,1);assert.equal((current[0].result as any).score,4);
const p=projectRisk({id:'risk',riskRef:'AIRS-1',title:'Risk',ownerPersonId:'owner',workflowCase:{status:'closed'},reassessments:[],responses:[],actions:[],assessments:current},now);
assert.equal(p.inherentScore,4);assert.equal(p.residualScore,null);assert.equal(p.reduction,null);assert.equal(p.hasPlan,false);
assert.deepEqual(reportingAssessments({...risk,version:3},native,config),[]);
assert.deepEqual(reportingAssessments(risk,native,{...config,payload:{name:'different'}}),[]);
assert.deepEqual(reportingAssessments(risk,native,{...config,riskSnapshot:[...config.riskSnapshot,...config.riskSnapshot]}),[]);
const fresh={...native[0],id:'fresh',createdAt:new Date(now.getTime()+1)};assert.deepEqual(reportingAssessments(risk,[fresh,native[1]],config),[fresh]);
const measures=reviewMeasures([{dueAt:old,completion:null,retirement:{}},{dueAt:old,completion:null,cancellation:{}},{dueAt:old,completion:{completedAt:new Date(now.getTime()+1)}},{dueAt:old,completion:{completedAt:old}}],now);
assert.equal(measures.retired,1);assert.equal(measures.superseded,1);assert.equal(measures.due,2);assert.equal(measures.overdue,1);assert.equal(measures.completed,1);assert.equal(measures.closedOnTime,1);

async function capacity(){
 const count=400,sourceReads={count:0},childReads={count:0};
 const sourceRisks=Array.from({length:count},(_,i)=>new Proxy({id:String(i),riskRef:String(i),title:'Risk',reassessments:[],useCase:{effectiveConfiguration:null}},{get(t,k){if(k==='id')sourceReads.count++;return (t as any)[k]}}));
 const coordinators=sourceRisks.map((r,i)=>({id:'c'+i,riskId:String(i),caseId:'case'+i,templateId:'template',stageCode:'airs-inherent-assessment',dueDate:old,createdAt:old,formDataJson:{assessmentRound:1}}));
 const children=coordinators.flatMap(c=>Array.from({length:8},()=>new Proxy({caseId:c.caseId,templateStage:{templateId:'template',code:c.stageCode},formDataJson:{coordinatorTaskId:c.id}},{get(t,k){if(k==='templateStage')childReads.count++;return (t as any)[k]}})));
 const tx:any={$queryRaw:async()=>coordinators,workflowTask:{findMany:async()=>children},aiUseCase:{findMany:async()=>[]},aiLifecycleRequest:{findMany:async()=>[]},ndiEvidence:{findMany:async()=>[]}};
 const dashboard=new AiDashboardService({} as any,{} as any,{} as any),begin=performance.now();
 const result=await (dashboard as any).governance(tx,{a:{canPipeline:true,pipelineWhere:{}},asOf:now,sourceRisks,latest:[]});
 assert.equal(result.measures.assessmentDue,count);assert.equal(result.measures.assessmentComplete,0);
 assert.ok(sourceReads.count<=count*3,'risk indexing must be linear');assert.ok(childReads.count<=children.length*5,'dimension tasks must be grouped before traversal');
 assert.equal(indexBy(sourceRisks,r=>r.id).size,count);
 console.log(JSON.stringify({passed:true,scenarios:10,capacity:{risks:count,tasks:children.length,riskIdReads:sourceReads.count,taskStageReads:childReads.count,elapsedMs:Math.round(performance.now()-begin)}}));
}
void capacity();
