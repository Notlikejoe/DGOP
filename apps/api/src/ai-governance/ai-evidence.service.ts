import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiAnnualReviewService } from './ai-annual-review.service';
import { AiReviewQueryDto, aiReviewParams } from './ai-review-query.dto';
import { visibleSnapshots } from './ai-review-history';
import { jsonRecord } from './ai-risk-scoring';
import { evidenceExclusion, proofDigest, requiresAiDecisionProof } from './ai-evidence.logic';
import { isManagedDemoProfile } from '../common/demo-profile';
import { lockVerifiedEvidence } from './ai-evidence-proof';
import { governanceTransaction } from './ai-governance-ledger';
import { toPaged } from '../common/pagination';

const changes = {
  ai_risk_library_version:'aiRiskLibraryVersion',ai_library_control_link:'aiLibraryControlLinkVersion',
  ai_category_control_mapping:'aiCategoryControlMappingVersion',ai_source_correction:'aiSourceCorrectionVersion',
  ai_control_domain:'aiControlDomainVersion',ai_migration_preview:'aiMigrationPreview',
  ai_migration_pilot_capture:'aiMigrationPilotCapture',ai_corrected_source_snapshot:'aiCorrectedSourceSnapshot',
  ai_dashboard_schedule:'aiDashboardScheduleVersion',
} as const;
export const AI_EVIDENCE_TARGET_TYPES = ['ai_lifecycle_request','ai_use_case','ai_risk','ai_risk_review','ai_annual_review','organization_unit',...Object.keys(changes)];
const readPermissions = ['case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all'] as const;
@Injectable()
export class AiEvidenceService {
  constructor(private readonly prisma:PrismaService,private readonly authorization:AiAuthorizationService,
    private readonly risks:AiRiskIntakeService,private readonly annual:AiAnnualReviewService,private readonly audit:AuditService) {}

  private async subject(tx:Prisma.TransactionClient,userId:string,targetType:string,targetId:string,write=false) {
    if(!AI_EVIDENCE_TARGET_TYPES.includes(targetType)) throw new BadRequestException('Unsupported AI evidence target');
    const actor = await this.authorization.authorizeAny(userId,readPermissions,tx,write);
    if(targetType==='ai_lifecycle_request') {
      const request=await tx.aiLifecycleRequest.findUnique({where:{id:targetId},select:{useCaseId:true}});
      if(!request)throw new NotFoundException('AI evidence target not found');
      await this.subject(tx,userId,'ai_use_case',request.useCaseId,write);
    } else if(targetType==='ai_lifecycle_request') {
      const request=await tx.aiLifecycleRequest.findUnique({where:{id:targetId},select:{useCaseId:true}});
      if(!request)throw new NotFoundException('AI evidence target not found');
      await this.subject(tx,userId,'ai_use_case',request.useCaseId,write);
    } else if(targetType==='ai_risk'||targetType==='ai_risk_review') {
      const access=await this.risks.visibility(userId,tx,!write);
      const riskId=targetType==='ai_risk'?targetId:(await tx.aiRiskReview.findUnique({where:{id:targetId},select:{riskId:true}}))?.riskId;
      if(!riskId||!await tx.aiRisk.findFirst({where:{AND:[access.where,{id:riskId}]},select:{id:true}})) throw new NotFoundException('AI evidence target not found');
    } else if(targetType==='ai_use_case') {
      const row=await tx.aiUseCase.findFirst({where:{id:targetId,deletedAt:null,isSampleData:false},include:{asset:true,owner:true}});
      if(!row) throw new NotFoundException('AI evidence target not found');
      if(!actor.administratorOversight) {
        const scope=await new ScopeService(tx as PrismaService).resolve(actor.roles);
        const grants=await tx.rolePermission.findMany({where:{role:{code:{in:actor.roles}}},include:{permission:true}});
        const broad=grants.some(g=>['case.view.aiuc.org','case.view.aiuc.all'].includes(g.permission.resource+'.'+g.permission.action));
        if(!broad&&row.requesterUserId!==userId&&row.owner?.userId!==userId&&!await tx.aiLifecycleRequest.findFirst({where:{useCaseId:row.id,...(write?{status:{in:['assessment','review','authority','confirmation']}}:{}),workflowCase:{is:{tasks:{some:{assigneeUserId:userId,...(write?{status:'pending'}:{})}}}}},select:{id:true}})) throw new NotFoundException('AI evidence target not found');
        if(scope.orgUnits!=='all'&&(!row.organizationUnitId||!scope.orgUnits.includes(row.organizationUnitId))) throw new NotFoundException('AI evidence target not found');
        if(row.asset) {
          const asset=await tx.dataAsset.findFirst({where:{id:row.asset.id,deletedAt:null,...(write?{isActive:true}:{}),
            ...(scope.domains==='all'?{}:{domainId:{in:scope.domains}}),...(scope.maxClassRank===null?{}:{classification:{rank:{lte:scope.maxClassRank}}})},select:{id:true}});
          if(!asset) throw new NotFoundException('AI evidence target not found');
        } else await this.authorization.authorizeBusiness(userId,broad?'case.view.aiuc.org':'case.view.aiuc.own',tx,targetId);
      }
    } else if(targetType==='ai_annual_review') {
      const row=await tx.aiAnnualReview.findUnique({where:{id:targetId}});
      if(!row) throw new NotFoundException('AI evidence target not found');
      const scope=await this.annual.historyScope(tx,userId,row.organizationUnitId);
      if(!(await visibleSnapshots(tx,scope.where,[row],r=>jsonRecord(r.sourceSnapshot)['members'] as Prisma.JsonValue)).length) throw new NotFoundException('AI evidence target not found');
      if(write&&(!scope.unit.isActive||!actor.roles.includes('AI_GOVERNANCE_OFFICER'))) throw new ForbiddenException('An eligible register officer must link annual evidence');
    } else if(targetType==='organization_unit') {
      const scope=await this.annual.historyScope(tx,userId,targetId);
      if(write&&(!scope.unit.isActive||!actor.roles.includes('AI_GOVERNANCE_OFFICER'))) throw new ForbiddenException('An eligible register officer must link organization evidence');
    } else {
      if(!actor.administratorOversight&&!actor.roles.some(r=>['AI_GOVERNANCE_OFFICER','dmo_admin','auditor'].includes(r))) throw new ForbiddenException('Governed change evidence requires change oversight');
      const delegate=tx[changes[targetType as keyof typeof changes]] as unknown as {findUnique:(args:{where:{id:string}})=>Promise<unknown>};
      if(!delegate||!await delegate.findUnique({where:{id:targetId}})) throw new NotFoundException('AI evidence target not found');
    }
    return actor;
  }
  async link(userId:string,targetType:string,targetId:string,evidenceIds:string[],justification:string) {
    if(typeof justification!=='string'||!justification.trim()||justification.length>5000) throw new BadRequestException('Explain how the evidence supports this case, review or change');
    return governanceTransaction(this.prisma,async tx=>{
      const actor=await this.subject(tx,userId,targetType,targetId,true), rows=await lockVerifiedEvidence(tx,evidenceIds);
      const person=await tx.person.findFirst({where:{deletedAt:null,isActive:true,OR:[{userId},{email:actor.email}]},select:{id:true}});
      const created:string[]=[];
      for(const row of rows) {
        if(!actor.roles.some(r=>['dmo_admin'].includes(r))&&row.submittedBy!==actor.email&&row.reviewedBy!==actor.email
          &&!await tx.ndiSpecification.findFirst({where:{id:row.specId,ownerPersonId:person?.id??''},select:{id:true}})) throw new NotFoundException('Evidence is outside your document access');
        const existing=await tx.aiEvidenceLink.findUnique({where:{evidenceId_targetType_targetId_evidenceUpdatedAt:{evidenceId:row.id,targetType,targetId,evidenceUpdatedAt:row.updatedAt}}});
        if(existing){created.push(existing.id);continue;}
        const saved=await tx.aiEvidenceLink.create({data:{evidenceId:row.id,targetType,targetId,evidenceUpdatedAt:row.updatedAt,sha256:row.sha256,actorId:userId,justification:justification.trim()}});
        created.push(saved.id);
        await this.audit.logRequired({actor:userId,action:'ai.evidence.linked',entityType:targetType,entityId:targetId,metadata:{linkId:saved.id,evidenceId:row.id,sha256:row.sha256,justification:justification.trim(),demoOnly:row.provenance!=='operational'}},tx);
      }
      return {linkIds:created,targetType,targetId};
    });
  }
  async read(userId:string,targetType:string,targetId:string,query:AiReviewQueryDto) {
    const page=aiReviewParams(query),now=new Date();
    return this.prisma.$transaction(async tx=>{
      const actor=await this.subject(tx,userId,targetType,targetId);
      const subject={entityType:targetType==='ai_risk_review'?'ai_risk':targetType,entityId:targetType==='ai_risk_review'
        ?(await tx.aiRiskReview.findUniqueOrThrow({where:{id:targetId},select:{riskId:true}})).riskId:targetId};
      const relevant:Prisma.AuditLogWhereInput=targetType==='organization_unit'
        ?{entityType:'ai_dashboard_schedule',metadata:{path:['organizationUnitId'],equals:targetId}}
        :targetType==='ai_source_correction'?{OR:[subject,{action:'ai.source.corrections.capture',metadata:{path:['versionId'],equals:targetId}}]}
        :targetType==='ai_risk_review'?{...subject,action:'airs.review.complete',metadata:{path:['reviewId'],equals:targetId}}:subject;
      const auditWhere:Prisma.AuditLogWhereInput={AND:[relevant,...(query.search?[{action:{contains:query.search,mode:'insensitive' as const}}]:[])]};
      // Scan bounded pages over the explicit decision contracts, preserving accurate
      // totals without treating proposals as unverified historical decisions.
      let cursor:string|undefined,total=0;const selected:string[]=[];
      do {const batch=await tx.auditLog.findMany({where:auditWhere,orderBy:[{createdAt:'desc'},{id:'desc'}],take:200,...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,action:true}});
        if(!batch.length)break;for(const row of batch)if(requiresAiDecisionProof(row.action)){if(total>=page.skip&&selected.length<page.take)selected.push(row.id);total++;}
        cursor=batch[batch.length-1].id;if(batch.length<200)break;
      }while(cursor);
      const audits=await tx.auditLog.findMany({where:{id:{in:selected}},orderBy:[{createdAt:'desc'},{id:'desc'}],include:{aiEvidenceProof:true}});
      const links=await tx.aiEvidenceLink.findMany({where:{targetType,targetId},orderBy:{createdAt:'desc'},take:200,include:{evidence:true}});
      const documentIds=[...new Set(audits.flatMap(a=>{const snap=jsonRecord(a.aiEvidenceProof?.snapshot);return Array.isArray(snap['documents'])?snap['documents'].map(d=>String(jsonRecord(d)['evidenceId'])):[]}))];
      const current=await tx.ndiEvidence.findMany({where:{id:{in:documentIds}}}),byId=new Map(current.map(r=>[r.id,r]));
      const data=audits.map(a=>{
        const proof=a.aiEvidenceProof,reasons:string[]=[];
        if(!proof) reasons.push('historical_proof_missing');
        else {if(proofDigest(proof.snapshot)!==proof.digest)reasons.push('snapshot_integrity_failed');
          const docs=jsonRecord(proof.snapshot)['documents'];
          if(!Array.isArray(docs)||!docs.length)reasons.push('snapshot_documents_missing');
          else for(const doc of docs){const pinned=jsonRecord(doc),row=byId.get(String(pinned['evidenceId']));
            if(!pinned['approvalAuditId']||!pinned['uploadAuditId'])reasons.push('historical_proof_missing');
            const reason=row?evidenceExclusion(row,now,isManagedDemoProfile()):'evidence_missing';
            if(reason)reasons.push(reason);else if(row&&(row.sha256!==pinned['sha256']||row.updatedAt.toISOString()!==pinned['evidenceUpdatedAt']))reasons.push('approved_revision_changed');}
        }
        return {id:a.id,action:a.action,createdAt:a.createdAt,assurance:reasons.length?'review_needed':proof!.demoOnly?'demo_verified':'verified',reasons:[...new Set(reasons)],proof:proof?{digest:proof.digest,snapshot:proof.snapshot}:null};
      });
      const eligibleLinkRole=actor.roles.some(role=>role!=='system_admin'&&role!=='auditor');
      const canLink=eligibleLinkRole&&!actor.roles.includes('auditor')&&(!actor.administratorOversight||actor.roles.some(role=>role.startsWith('AI_')||role==='dmo_admin'))
        &&(!['organization_unit','ai_annual_review'].includes(targetType)||actor.roles.includes('AI_GOVERNANCE_OFFICER'));
      return {...toPaged(data,total,page),evaluatedAt:now,canLink,
        links:links.map(l=>({id:l.id,evidenceId:l.evidenceId,title:l.evidence.title,justification:l.justification,demoOnly:l.evidence.provenance!=='operational',
          exclusion:evidenceExclusion(l.evidence,now,isManagedDemoProfile())??(l.evidence.updatedAt.getTime()!==l.evidenceUpdatedAt.getTime()?'approved_revision_changed':null)})),linksTruncated:links.length===200};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
  }
}
