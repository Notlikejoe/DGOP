import { Prisma } from '@prisma/client';
import { EffectiveScope } from '../access/scope.service';

type Publication={effectiveFrom:Date|null;effectiveTo:Date|null;values:{code:string;metadata:Prisma.JsonValue}[]};
export async function submittedClassificationCatalog(tx:Prisma.TransactionClient,rank:number){
  const [versions,classes]=await Promise.all([
    tx.governedReferenceVersion.findMany({where:{listCode:'L_CLASS',state:{in:['published','retired']}},include:{values:true}}),
    tx.classification.findMany({where:{isActive:true,deletedAt:null,rank:{lte:rank}},select:{code:true}}),
  ]);
  return {versions,codes:new Set(classes.map(row=>row.code))};
}
export function eligibleSubmittedClassification(payload:Prisma.JsonValue,at:Date|null,catalog:{versions:Publication[];codes:Set<string>}):boolean{
  const code=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload['data_classification']:undefined;
  if(!at||typeof code!=='string')return false;
  const versions=catalog.versions.filter(v=>v.effectiveFrom&&v.effectiveFrom<=at&&(!v.effectiveTo||v.effectiveTo>at));
  const metadata=versions.length===1?versions[0].values.find(v=>v.code===code)?.metadata:null;
  const mapped=metadata&&typeof metadata==='object'&&!Array.isArray(metadata)?metadata['assetClassificationCode']:undefined;
  return typeof mapped==='string'&&catalog.codes.has(mapped);
}
/** Complete submitted population, bounded probes, before pages/counts or aggregates. */
export async function unregisteredScopeWhere(tx:Prisma.TransactionClient,scope:EffectiveScope):Promise<Prisma.AiUseCaseWhereInput>{
  if(scope.domains!=='all')return {id:{in:[]}};
  if(scope.maxClassRank===null)return {assetId:null};
  const catalog=await submittedClassificationCatalog(tx,scope.maxClassRank),ids:string[]=[];
  let cursor:string|undefined;
  for(;;){const rows=await tx.aiUseCase.findMany({where:{assetId:null,deletedAt:null,isSampleData:false,
      ...(scope.orgUnits==='all'?{}:{organizationUnitId:{in:scope.orgUnits}}),intakeRevisions:{some:{submittedAt:{not:null}}}},
    select:{id:true,intakeRevisions:{where:{submittedAt:{not:null}},orderBy:{revision:'desc'},take:1,select:{payload:true,submittedAt:true}}},
    orderBy:{id:'asc'},take:200,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    for(const row of rows){const r=row.intakeRevisions[0];if(r&&eligibleSubmittedClassification(r.payload,r.submittedAt,catalog))ids.push(row.id);}
    if(rows.length<200)break;cursor=rows.at(-1)!.id;
  }
  return {assetId:null,id:{in:ids}};
}
