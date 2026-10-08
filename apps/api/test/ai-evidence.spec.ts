import assert from 'node:assert/strict';
import { evidenceExclusion, proofDigest, requiresAiDecisionProof, decisionTarget } from '../src/ai-governance/ai-evidence.logic';
const now=new Date('2026-10-05T12:00:00Z'),row={status:'approved',provenance:'operational',deletedAt:null,expiryDate:null,
  submittedBy:'author@test.invalid',submittedAt:new Date('2026-10-03'),reviewedBy:'reviewer@test.invalid',reviewedAt:new Date('2026-10-04'),sha256:'a'.repeat(64),sizeBytes:100};
assert.equal(evidenceExclusion(row,now,false),null);
for(const status of ['draft','submitted','under_review','rejected','revoked','expired'])assert.equal(evidenceExclusion({...row,status},now,true),'not_approved');
assert.equal(evidenceExclusion({...row,expiryDate:now},now,true),'expired');
assert.equal(evidenceExclusion({...row,deletedAt:now},now,true),'deleted');
for(const provenance of ['synthetic_demo','seeded_uat']){assert.equal(evidenceExclusion({...row,provenance},now,true),null);assert.equal(evidenceExclusion({...row,provenance},now,false),'provenance_not_allowed');}
assert.equal(evidenceExclusion({...row,provenance:'unknown'},now,true),'provenance_not_allowed');
for(const invalid of [{reviewedBy:row.submittedBy},{reviewedAt:null},{submittedAt:null},{reviewedAt:new Date(now.getTime()+1)},{submittedAt:now}])assert.equal(evidenceExclusion({...row,...invalid},now,true),'unverified_approval');
for(const invalid of [{sha256:'bad'},{sizeBytes:0},{sizeBytes:51*1024*1024}])assert.equal(evidenceExclusion({...row,...invalid},now,true),'unverified_file');
const finals=['aiuc.classification.verified','aiuc.classification.overridden','aiuc.review.aiuc-privacy-review.approve','aiuc.decision.approve_with_conditions','aiuc.asset.approve','aiuc.request.closed_no_action','airs.assessment.ethics.approve','airs.response.officer.approve','airs.treatment.plan.approve','airs.treatment.action.completed','airs.residual.accept_owner.accept','airs.review.complete','airs.reassessment.started','airs.severity.approved','airs.strategy.avoidance_closed','ai.annual.review.complete','ai.annual.review.handover','airs.library.publish','ai.category.controls.review','ai.source.corrections.review','ai.migration.preview.review','ai.migration.pilot.review','ai.control.domain.publish','ai.dashboard.schedule.configure'];
for(const action of finals)assert.equal(requiresAiDecisionProof(action),true,action);
for(const action of ['aiuc.classification.assessed','ai.notification.created','airs.library.propose','airs.treatment.action.progress','ai.permission.denied'])assert.equal(requiresAiDecisionProof(action),false,action);
assert.deepEqual(decisionTarget({actor:'a',action:'airs.review.complete',entityType:'ai_risk',entityId:'risk',metadata:{reviewId:'review'}}),{targetType:'ai_risk_review',targetId:'review'});
assert.equal(proofDigest({b:2,a:1}),proofDigest({a:1,b:2}));assert.notEqual(proofDigest({a:1}),proofDigest({a:2}));
console.log('AI evidence eligibility, final-action contracts, relevance target and deterministic proof digest passed');
