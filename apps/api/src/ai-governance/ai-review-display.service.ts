import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { jsonRecord } from './ai-risk-scoring';
import { AiAuthorizationService } from './ai-authorization.service';

const bands=['LOW','MEDIUM','HIGH','CRITICAL'];
@Injectable()
export class AiReviewDisplayService {
  constructor(private readonly prisma:PrismaService,private readonly authorization?:AiAuthorizationService){}
  async read(userId:string){
    if(!this.authorization)throw new Error('Review display authorization is unavailable');
    await this.authorization.authorizeAny(userId,['case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.aiuc','dashboard.view.airs','dashboard.view.exec.ai']);
    return this.configuration();
  }
  async configuration(tx:Prisma.TransactionClient=this.prisma){
    const now=new Date(),versions=await tx.governedReferenceVersion.findMany({where:{listCode:{in:['R_LEVEL_DAYS','R_CADENCE']},state:'published',effectiveFrom:{lte:now},OR:[{effectiveTo:null},{effectiveTo:{gt:now}}]},include:{values:true}});
    const engines=versions.filter(v=>v.listCode==='R_LEVEL_DAYS'),labels=versions.filter(v=>v.listCode==='R_CADENCE'),engine=engines.length===1?engines[0]:null,cadence=labels.length===1?labels[0]:null;
    const engineReady=!!engine&&engine.values.length===4&&bands.every(band=>engine.values.some(v=>v.code===band&&Number.isInteger(jsonRecord(v.metadata)['intervalDays'])&&(jsonRecord(v.metadata)['intervalDays'] as number)>0&&(jsonRecord(v.metadata)['intervalDays'] as number)<=3660&&jsonRecord(v.metadata)['firstReviewImmediate']===(band==='CRITICAL')));
    const mappings=bands.map(band=>{
      const days=engine?.values.find(v=>v.code===band),intervalDays=jsonRecord(days?.metadata)['intervalDays'];
      const matches=cadence?.values.filter(v=>jsonRecord(v.metadata)['residualBandCode']===band&&jsonRecord(v.metadata)['intervalDays']===intervalDays)??[];
      const label=engineReady&&cadence?.values.length===4&&matches.length===1?matches[0]:null;
      return {bandCode:band,intervalDays:typeof intervalDays==='number'?intervalDays:null,firstReviewImmediate:band==='CRITICAL',cadenceCode:label?.code??null,labelEn:label?.labelEn??null,labelAr:label?.labelAr??null};
    });
    const ready=engineReady&&!!cadence&&cadence.values.length===4&&mappings.every(m=>!!m.cadenceCode)&&new Set(mappings.map(m=>m.cadenceCode)).size===4;
    return {ready,engineReady,engineVersionId:engine?.id??null,cadenceVersionId:cadence?.id??null,mappings,
      issues:!engineReady?['Published four-band R_LEVEL_DAYS metadata is required']:!ready?['Publish approved R_CADENCE metadata with residualBandCode and intervalDays matching the current engine policy']:[],
      metadataContract:{fields:['residualBandCode','intervalDays'],source:'FD §5.6 / risk workbook reference sheet Q5:Q8'}};
  }
  async pin(tx:Prisma.TransactionClient,bandCode:string,intervalDays:number,engineVersionId:string){
    const c=await this.configuration(tx),m=c.mappings.find(m=>m.bandCode===bandCode&&m.intervalDays===intervalDays);
    if(!c.ready||c.engineVersionId!==engineVersionId||!m?.cadenceCode)return {};
    await tx.$queryRaw`SELECT id FROM governed_reference_versions WHERE id=${c.cadenceVersionId} FOR SHARE`;
    return {cadenceReferenceVersionId:c.cadenceVersionId!,cadenceCode:m.cadenceCode,displayCadenceLabelEn:m.labelEn!,displayCadenceLabelAr:m.labelAr!};
  }
}
