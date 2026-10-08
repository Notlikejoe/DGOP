import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportProofs } from '../src/ai-governance/ai-reporting-proof';
import { proofDigest } from '../src/ai-governance/ai-evidence.logic';
import { isManagedDemoProfile } from '../src/common/demo-profile';
const now=new Date(),earlier=new Date(now.getTime()-1000),directory=mkdtempSync(join(tmpdir(),'dgop-reporting-proof-')),previous=process.env.EVIDENCE_STORAGE_DIR;
const bytes=Buffer.from('Operational proof unit fixture'),document:any={id:'document',fileName:'proof.txt',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),updatedAt:earlier,status:'approved',provenance:'operational',deletedAt:null,expiryDate:null,submittedAt:earlier,reviewedAt:earlier,submittedBy:'author',reviewedBy:'reviewer'};
const snapshot:any={targetType:'ai_lifecycle_request',targetId:'request',action:'aiuc.lifecycle.ethics.approve',demoOnly:false,documents:[{evidenceId:document.id,sha256:document.sha256,evidenceUpdatedAt:earlier.toISOString(),uploadAuditId:'upload',approvalAuditId:'approval',linkId:'link'}]};
const row:any={entityType:snapshot.targetType,entityId:snapshot.targetId,action:snapshot.action,metadata:{taskId:'task'},aiEvidenceProof:{snapshot,digest:proofDigest(snapshot),demoOnly:false}},tx:any={auditLog:{findMany:async()=>[row]},ndiEvidence:{findMany:async()=>[document]}};
async function state(){return (await reportProofs(tx,[{entityType:snapshot.targetType,entityId:snapshot.targetId}],now)).get('task')}
async function main(){process.env.EVIDENCE_STORAGE_DIR=directory;writeFileSync(join(directory,'proof.txt'),bytes);try{
 assert.equal(await state(),'verified');document.status='revoked';assert.equal(await state(),'review_needed');document.status='approved';document.expiryDate=earlier;assert.equal(await state(),'review_needed');document.expiryDate=null;
 document.updatedAt=now;assert.equal(await state(),'review_needed');document.updatedAt=earlier;writeFileSync(join(directory,'proof.txt'),'changed');assert.equal(await state(),'review_needed');writeFileSync(join(directory,'proof.txt'),bytes);
 row.aiEvidenceProof.digest='0'.repeat(64);assert.equal(await state(),'review_needed');row.aiEvidenceProof.digest=proofDigest(snapshot);row.entityId='different';assert.equal(await state(),'review_needed');row.entityId='request';
 document.provenance='synthetic_demo';row.aiEvidenceProof.demoOnly=true;snapshot.demoOnly=true;row.aiEvidenceProof.digest=proofDigest(snapshot);assert.equal(await state(),isManagedDemoProfile()?'demo_verified':'review_needed');
 row.aiEvidenceProof=null;assert.equal(await state(),'review_needed');console.log('AI reporting proof: 9 operational, expiry, revocation, revision, file, integrity, relevance, synthetic and historical scenarios passed');
 }finally{if(previous===undefined)delete process.env.EVIDENCE_STORAGE_DIR;else process.env.EVIDENCE_STORAGE_DIR=previous;rmSync(directory,{recursive:true,force:true})}}
void main();
