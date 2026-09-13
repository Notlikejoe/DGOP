import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiSourceCorrectionsService } from './ai-source-corrections.service';
import { AiIntakeService } from './ai-intake.service';
import { AiRiskInitiationService } from './ai-risk-initiation.service';
import { validateInput } from './ai-risk-intake.service';
import { PreviewRow } from './ai-migration-preview';
import { jsonRecord } from './ai-risk-scoring';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
export type SourceDraftDto={requestKey:string;rowKey:string;expectedDigest:string;useCaseId?:string;justification:string;evidenceIds:string[]};
@Injectable()
export class AiSourceNativeService {
 constructor(private readonly db:PrismaService,private readonly corrections:AiSourceCorrectionsService,private readonly intake:AiIntakeService,private readonly initiation:AiRiskInitiationService,private readonly audit:AuditService){}
 async create(userId:string,snapshotId:string,dto:SourceDraftDto){const justification=governanceText(dto.justification);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.requestKey))throw new BadRequestException('Stable source draft request UUID required');return governanceTransaction(this.db,async tx=>{
  const {snapshot}=await this.corrections.approvedSnapshot(tx,userId,snapshotId);if(dto.expectedDigest!==snapshot.digest)throw new ConflictException('Source snapshot changed');const evidenceIds=await governanceEvidence(tx,dto.evidenceIds),requestDigest=governanceDigest({userId,snapshotId,rowKey:dto.rowKey,useCaseId:dto.useCaseId??null,justification,evidenceIds,expectedDigest:dto.expectedDigest}),old=await tx.aiSourceNativeDraft.findUnique({where:{requestKey:dto.requestKey}});if(old){if(old.requestDigest!==requestDigest)throw new ConflictException('Source draft key belongs to another request');return {...old,created:false};}
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-source-native'),hashtext(${snapshotId}))`;if(await tx.aiSourceNativeDraft.count({where:{snapshotId,rowKey:dto.rowKey}}))throw new ConflictException('Source row already has a native draft');const row=(jsonRecord(snapshot.report)['rows'] as PreviewRow[]).find(r=>r.key===dto.rowKey);if(!row||!['usecase','risk'].includes(row.kind)||row.sample)throw new BadRequestException('Select a nonsample use-case or causal risk row');
  // A draft can retain a legacy-assessment gap; no assessment or acceptance is imported.
  const allowed=row.kind==='risk'?['LEGACY_ASSESSMENT_AUTHORITY_REVIEW_REQUIRED']:[];if(row.issues.some(i=>!allowed.includes(i)))throw new ConflictException('Resolve source field, score, parent and computed differences before creating a native draft');
  let targetUseCaseId:string|undefined,targetRiskId:string|undefined,projection:Record<string,unknown>;
  if(row.kind==='usecase'){
   if(dto.useCaseId)throw new BadRequestException('A use-case draft cannot bind another parent');const ownerId=row.prepared['ownerPersonId'];const owner=typeof ownerId==='string'?await tx.person.findUnique({where:{id:ownerId},select:{userId:true}}):null;if(!owner?.userId)throw new ConflictException('Source owner must have a current linked native use-case-owner user');
   projection={usecase_name:row.prepared['title'],problem_desc:row.prepared['description'],objective_value:row.prepared['purpose'],data_source:row.prepared['dataSource'],proposed_owner:owner.userId,personal_data_flag:jsonRecord(row.prepared['personalData'])['code']};
   const created=await this.intake.createDraftInTransaction(tx,userId,projection);targetUseCaseId=created.id;
  }else{
   if(!dto.useCaseId)throw new BadRequestException('Select the registered native parent');const parent=await tx.aiUseCase.findFirst({where:{id:dto.useCaseId,deletedAt:null,useCaseRef:row.parentRef},select:{id:true}});if(!parent)throw new NotFoundException('Native parent must retain the original source AI identifier');
   const native=await this.initiation.createInTransaction(tx,userId,{initiationKey:dto.requestKey,useCaseId:parent.id,justification});if(!native.created)throw new ConflictException('Source request collides with an existing native initiation');targetRiskId=native.id;
   projection={title:row.prepared['title'],cause:row.prepared['cause'],event:row.prepared['event'],effect:row.prepared['effect'],current_controls:row.prepared['currentControls'],risk_category:jsonRecord(row.prepared['category'])['code'],ethics_principle:jsonRecord(row.prepared['principle'])['code'],dev_stage:jsonRecord(row.prepared['devStage'])['code'],control_effectiveness:jsonRecord(row.prepared['controlEffectiveness'])['code'],risk_source:jsonRecord(row.prepared['riskSource'])['code'],risk_intent:jsonRecord(row.prepared['riskIntent'])['code'],risk_timing:jsonRecord(row.prepared['riskTiming'])['code']};
   projection=validateInput(projection);
   const changed=await tx.aiRisk.updateMany({where:{id:native.id,riskRef:null,version:1},data:{title:String(projection['title']),cause:String(projection['cause']),event:String(projection['event']),effect:String(projection['effect']),intakeData:projection as Prisma.InputJsonObject}});if(changed.count!==1)throw new ConflictException('Native source draft changed');
  }
  const record=await tx.aiSourceNativeDraft.create({data:{snapshotId,rowKey:row.key,sourceRef:row.sourceRef,sourceDigest:governanceDigest(row.raw),projectionDigest:governanceDigest(projection),targetUseCaseId,targetRiskId,requestKey:dto.requestKey,requestDigest,createdBy:userId,justification,evidenceIds}});await this.audit.logRequired({actor:userId,action:'ai.source.native.draft',entityType:'ai_source_native_draft',entityId:record.id,metadata:{snapshotId,rowKey:row.key,sourceRef:row.sourceRef,targetUseCaseId:targetUseCaseId??null,targetRiskId:targetRiskId??null,justification,evidenceIds,authorityImported:false,identifierAllocated:false}},tx);return {...record,created:true};
 });}
}
