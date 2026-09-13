import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { governanceDigest } from './ai-governance-ledger';
import { jsonRecord, RISK_DIMENSIONS, RISK_DIMENSION_ROLES } from './ai-risk-scoring';
export type ControlPin={versionId:string;controlCode:string;digest:string;titleEn:string;titleAr:string;dimensionPins:Prisma.JsonValue;suggestionsOnly:true};
@Injectable()
export class AiControlDomainsService {
 constructor(private readonly prisma:PrismaService,private readonly authorization:AiAuthorizationService){}
 async pins(tx:Prisma.TransactionClient,value:unknown):Promise<ControlPin[]>{
  if(!Array.isArray(value)||value.length>10||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))throw new BadRequestException('Select up to ten unique published control version identifiers');
  if(!value.length)return [];
  const now=new Date(),dimensions=await tx.governedReferenceVersion.findMany({where:{listCode:'R_IMPD',state:'published',effectiveFrom:{lte:now},OR:[{effectiveTo:null},{effectiveTo:{gt:now}}]},include:{values:true},take:2});
  const d=dimensions.length===1?dimensions[0]:null,metadata=d?.values.map(v=>jsonRecord(v.metadata))??[];
  if(!d||metadata.length!==8||RISK_DIMENSIONS.some(dim=>metadata.filter(m=>m['dimension']===dim&&m['assessorRoleCode']===RISK_DIMENSION_ROLES[dim]).length!==1)||new Set(metadata.map(m=>m['tieBreakOrder'])).size!==8||metadata.some(m=>!Number.isInteger(m['tieBreakOrder'])||Number(m['tieBreakOrder'])<1||Number(m['tieBreakOrder'])>8))throw new ConflictException('Control dimension reference configuration is not current and complete');
  await tx.$queryRaw`SELECT id FROM governed_reference_versions WHERE id=${d.id} FOR SHARE`;
  const result:ControlPin[]=[];
  for(const id of [...value].sort()){
   const v=await tx.aiControlDomainVersion.findUnique({where:{id},include:{entry:true,publication:true}}),latest=v?await tx.aiControlDomainVersion.findFirst({where:{entryId:v.entryId,publication:{isNot:null}},orderBy:{round:'desc'}}):null;
   if(!v?.publication||latest?.id!==id||governanceDigest({content:v.content,dimensionPins:v.dimensionPins})!==v.digest)throw new ConflictException('Select current published control versions');
   const pins=v.dimensionPins as Array<{versionId:string;code:string;dimension:string;labelEn:string;labelAr:string}>;
   if(!pins.length||pins.some(p=>p.versionId!==d.id||!d.values.some(x=>x.code===p.code&&jsonRecord(x.metadata)['dimension']===p.dimension&&x.labelEn===p.labelEn&&x.labelAr===p.labelAr)))throw new ConflictException('Control dimension publication changed');
   const content=jsonRecord(v.content);result.push({versionId:v.id,controlCode:v.entry.controlCode,digest:v.digest,titleEn:String(content['titleEn']),titleAr:String(content['titleAr']),dimensionPins:v.dimensionPins,suggestionsOnly:true});
  }
  if(new Set(result.map(p=>p.controlCode)).size!==result.length)throw new BadRequestException('Select one version per stable control identity');return result;
 }
 async verify(tx:Prisma.TransactionClient,value:unknown){if(!Array.isArray(value))throw new BadRequestException('Stored control pins must be an array');const pins=value as ControlPin[];const current=await this.pins(tx,pins.map(p=>p.versionId));if(governanceDigest(current)!==governanceDigest(pins))throw new ConflictException('Control tag pins changed; update the selection');return current;}
 async list(userId:string){
  await this.authorization.authorizeAny(userId,['case.view.airs.own','case.view.airs.org','case.view.airs.all']);
  const versions=await this.prisma.aiControlDomainVersion.findMany({where:{publication:{isNot:null}},include:{entry:true,publication:true},orderBy:[{entryId:'asc'},{round:'desc'}]});
  const seen=new Set<string>(),rows:ControlPin[]=[];
  for(const v of versions){if(seen.has(v.entryId))continue;seen.add(v.entryId);try{rows.push(...await this.pins(this.prisma,[v.id]));}catch(e){if(!(e instanceof ConflictException))throw e;}}
  return {rows:rows.sort((a,b)=>a.controlCode.localeCompare(b.controlCode)),suggestionsOnly:true};
 }
}
