import assert from 'node:assert/strict';
import { AI_NEW_ROLES, AI_PERMISSIONS, aiRoleMayHold } from '../src/ai-governance/ai-permissions';
import { aiDutyViolation } from '../src/ai-governance/ai-authorization.service';
import { AI_REFERENCE_CODES, canonicalAiReference } from '../src/master-data/ai-reference.catalog';
import { AIRS_WORKFLOW_TEMPLATE } from '../src/workflow/workflow.logic';
import { validateWorkflowRoute } from '../src/workflow/workflow.bpmn';
assert.equal(AI_NEW_ROLES.length,10); assert.equal(new Set(AI_PERMISSIONS).size,31);
assert.equal(aiRoleMayHold('AI_WORKING_GROUP','aiuc.asset.register'),true);
assert.equal(aiRoleMayHold('data_owner','aiuc.asset.approve'),true);
assert.equal(aiRoleMayHold('AI_USECASE_OWNER','aiuc.asset.approve'),false);
assert.equal(aiRoleMayHold('auditor','aiuc.asset.approve'),false);
assert.equal(AI_REFERENCE_CODES.length,40);
assert.equal(canonicalAiReference('L_TIER'),'R_SDAIA_TIER');
assert.equal(canonicalAiReference('L_FUNCTIONS'),'R_DEPT');
assert.equal(aiRoleMayHold('system_admin','refdata.publish'),false);
assert.equal(aiRoleMayHold('auditor','case.create.aiuc'),false);
assert.equal(aiRoleMayHold('executive','case.create.aiuc'),false);
assert.equal(aiRoleMayHold('AI_GOVERNANCE_OFFICER','airs.risk.accept.medium'),true);
assert.equal(aiRoleMayHold('AI_EXECUTIVE_TEAM','aiuc.classify.reverse'),true);
assert.equal(aiRoleMayHold('AI_GOVERNANCE_OFFICER','aiuc.classify.reverse'),false);
assert.equal(aiDutyViolation('u',['system_admin'],'approve_aiuc',{requesterId:'u'}),'GEN-26');
assert.equal(aiDutyViolation('u',['AI_GOVERNANCE_OFFICER'],'accept_medium',{riskOwnerId:'u',residualScore:4}),'GEN-27');
assert.equal(aiDutyViolation('u',[],'execute_plan',{planApproverIds:['u']}),'GEN-28');
assert.equal(aiDutyViolation('u',[],'approve_plan',{planExecutorIds:['u']}),'GEN-28');
assert.equal(aiDutyViolation('u',['AI_ETHICS_COMMITTEE'],'ethics_review',{riskOwnerId:'u'}),'GEN-29');
assert.equal(aiDutyViolation('u',['AI_GOVERNANCE_OFFICER'],'adopt_assessment',{riskOwnerId:'u'}),'WF-05');
assert.equal(aiDutyViolation('u',['AI_GOVERNANCE_OFFICER'],'adopt_assessment',{assessmentAssessorIds:['u']}),'WF-05');
assert.equal(aiDutyViolation('u',['AI_GOVERNANCE_OFFICER'],'adopt_assessment',{riskOwnerId:'other',assessmentAssessorIds:['other']}),null);
assert.equal(aiDutyViolation('u',['auditor','AI_EXECUTIVE_TEAM'],'accept_high',{residualScore:8}),'GEN-30');
assert.equal(aiDutyViolation('u',['AI_EXECUTIVE_TEAM'],'accept_high',{residualScore:8}),'GEN-31');
assert.equal(aiDutyViolation('u',['STEERING_COMMITTEE'],'accept_high',{residualScore:16}),'GEN-112');
assert.equal(aiDutyViolation('u',['AI_USECASE_OWNER'],'accept_low',{residualScore:2,useCaseOwnerId:'other'}),'GEN-25');
assert.equal(aiDutyViolation('u',['AI_EXECUTIVE_TEAM'],'accept_high',{residualScore:12,justification:'approved',evidenceIds:['evidence-id']}),null);
assert.equal(aiDutyViolation('u',['STEERING_COMMITTEE'],'restrict_critical',{residualScore:16,justification:'stop',evidenceIds:['evidence-id']}),null);
const route = validateWorkflowRoute(AIRS_WORKFLOW_TEMPLATE.stages.map((stage, index) => ({ ...stage, sortOrder: index + 1,
  isStart: !!stage.isStart, isDecision: !!stage.isDecision, isFinal: !!stage.isFinal, isActive: true })),
  AIRS_WORKFLOW_TEMPLATE.transitions.map((transition, index) => ({ fromStageId: transition.from, toStageId: transition.to, sortOrder: index + 1,
    labelEn: transition.labelEn, labelAr: transition.labelAr, connectorType: transition.connectorType,
    decision: transition.decision ?? null, isDefaultPath: !!transition.isDefaultPath, isHappyPath: transition.isHappyPath ?? true })));
assert.notEqual(route.status, 'blocked', route.errors.join('; '));
console.log('AI security contracts passed: exact catalog, existing-role mappings, authority and SoD rules.');

for (const permission of ['airs.risk.reverse','airs.strategy.decide'] as const) { assert.equal(aiRoleMayHold('executive',permission),false); assert.equal(aiRoleMayHold('auditor',permission),false); assert.equal(aiRoleMayHold('AI_RISK_OWNER',permission),false); assert.equal(aiRoleMayHold('AI_ETHICS_COMMITTEE',permission),true); }
