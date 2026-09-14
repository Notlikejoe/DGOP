import { testAiSharedOperational } from './ai-shared-operational.integration';
import { testAuthorityStrategy } from './ai-authority-strategy.integration';
import { testAiHistory } from './ai-history.integration';
import assert from 'node:assert/strict';
import { Prisma, PrismaClient, TaskDecision } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AiAuthorizationService } from '../src/ai-governance/ai-authorization.service';
import { AiIdentifiersService } from '../src/ai-governance/ai-identifiers.service';
import { AiIntakeService } from '../src/ai-governance/ai-intake.service';
import { AiClassificationService } from '../src/ai-governance/ai-classification.service';
import { AiDecisionService } from '../src/ai-governance/ai-decision.service';
import { AiRegistrationService } from '../src/ai-governance/ai-registration.service';
import { AiRiskIntakeService } from '../src/ai-governance/ai-risk-intake.service';
import { AiAssetFacade } from '../src/ai-governance/ai-asset.facade';
import { ScopeService } from '../src/access/scope.service';
import { AIUC_STAGE, AiWorkflowRoutingService } from '../src/ai-governance/ai-workflow-routing.service';
import { AI_CLASSIFICATION_CRITERIA } from '../src/ai-governance/ai-governance.contracts';
import { AIUC_WORKFLOW_TEMPLATE } from '../src/workflow/workflow.logic';
import { WorkflowService } from '../src/workflow/workflow.service';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { testPhase3B } from './ai-phase3b.integration';

export async function testPhase2A(db: PrismaClient) {
  const prisma = db as PrismaService;
  const audit = new AuditService(prisma);
  const authorization = new AiAuthorizationService(prisma, audit);
  const routing = new AiWorkflowRoutingService(prisma);
  const service = new AiIntakeService(prisma, authorization, new AiIdentifiersService(), audit, routing);
  const classification = new AiClassificationService(prisma, authorization, audit, routing);
  const decisions = new AiDecisionService(prisma, authorization, audit, routing);
  const scope = new ScopeService(prisma);
  const assetFacade = new AiAssetFacade(scope);
  const registrations = new AiRegistrationService(prisma, authorization, routing, assetFacade, new AiIdentifiersService(), audit, scope);

  if (!await db.workflowTemplate.findUnique({ where: { code: AIUC_WORKFLOW_TEMPLATE.code } })) {
    await db.workflowTemplate.create({
      data: {
        code: AIUC_WORKFLOW_TEMPLATE.code,
        caseType: AIUC_WORKFLOW_TEMPLATE.caseType,
        trigger: AIUC_WORKFLOW_TEMPLATE.trigger,
        nameEn: AIUC_WORKFLOW_TEMPLATE.nameEn,
        nameAr: AIUC_WORKFLOW_TEMPLATE.nameAr,
        description: AIUC_WORKFLOW_TEMPLATE.description,
        defaultSlaDays: AIUC_WORKFLOW_TEMPLATE.defaultSlaDays,
        isSystem: true,
        createdBy: 'system',
        stages: {
          create: AIUC_WORKFLOW_TEMPLATE.stages.map((stage, index) => ({
            code: stage.code,
            nameEn: stage.nameEn,
            nameAr: stage.nameAr,
            description: stage.description,
            kind: stage.kind,
            nodeType: stage.nodeType ?? (stage.taskType === 'approval' ? 'approval_task' : 'user_task'),
            taskType: stage.taskType,
            assignmentStrategy: stage.assignmentStrategy ?? 'role',
            assignmentConfigJson: (stage.assignmentConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            assigneeRoleCode: stage.assigneeRoleCode,
            dueDays: stage.dueDays,
            formSchemaJson: (stage.formSchemaJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            evidenceRequirementsJson: (stage.evidenceRequirementsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            gatewayConfigJson: (stage.gatewayConfigJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            parallelGroup: stage.parallelGroup,
            sortOrder: index + 1,
            isStart: stage.isStart ?? false,
            isDecision: stage.isDecision ?? false,
            isFinal: stage.isFinal ?? false,
          })),
        },
      },
    });
  }

  const oldTemplate = await db.workflowTemplate.findUniqueOrThrow({ where: { code: AIUC_WORKFLOW_TEMPLATE.code }, include: { stages: true } });
  await db.workflowTemplate.update({ where: { id: oldTemplate.id }, data: {
    designerJson: { source: 'route_seed', seedRevision: 'v6-volume2-complete-3', managedBy: 'system' },
  } });
  await db.workflowTemplateStage.update({ where: { id: oldTemplate.stages.find(stage => stage.code === AIUC_STAGE.ethics)!.id }, data: {
    assignmentConfigJson: { ruleId: 'AR-AIUC-04', priority: 10, activation: { variablePath: 'aiuc.approvedTier', operator: 'in', values: ['HIGH', 'UNACCEPTABLE'] } },
  } });
  const seedUpgradeApp = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await seedUpgradeApp.close();
  const updatedEthicsStage = await db.workflowTemplateStage.findUniqueOrThrow({ where: { templateId_code: { templateId: oldTemplate.id, code: AIUC_STAGE.ethics } } });
  assert.equal(Array.isArray((updatedEthicsStage.assignmentConfigJson as { activation: { any: unknown[] } }).activation.any), true,
    'managed Phase 2E templates must receive the corrected High-proposal Ethics rule');

  async function createActor(label: string, roleCode: string) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await db.user.create({
      data: {
        email: `${label}@phase2a.test`, displayName: label, passwordHash: 'not-a-login',
        userRoles: { create: { roleId: role.id } },
      },
    });
    const person = await db.person.create({
      data: { fullNameEn: label, fullNameAr: label, email: `${label}-person@phase2a.test`, userId: user.id },
    });
    return { ...user, person };
  }

  const requester = await createActor('intake-requester', 'business_steward');
  const owner = await createActor('intake-owner', 'AI_USECASE_OWNER');
  const dataOwner = await createActor('intake-data-owner', 'data_owner');
  const assetOrg = await db.organizationUnit.create({ data: { code: 'AI-P2G-DEPT', nameEn: 'AI department', nameAr: 'إدارة الذكاء الاصطناعي' } });
  const assetDomain = await db.dataDomain.create({ data: { code: 'AI-P2G-DOMAIN', nameEn: 'AI products', nameAr: 'منتجات الذكاء الاصطناعي' } });
  const assetClass = await db.classification.create({ data: { code: 'AI_P2G_RESTRICTED', nameEn: 'Restricted', nameAr: 'مقيدة', rank: 2, color: '#ff9900' } });
  const assetOwnerRoleType = await db.roleType.upsert({ where: { code: 'data_owner' }, create: { code: 'data_owner', nameEn: 'Data Owner', nameAr: 'مالك البيانات' }, update: {} });
  await db.person.update({ where: { id: owner.person.id }, data: { organization: assetOrg.code } });
  const sponsor = await createActor('intake-sponsor', 'AI_EXECUTIVE_TEAM');
  const triageReviewer = await createActor('intake-triage', 'AI_WORKING_GROUP');
  const officer = await createActor('intake-officer', 'AI_GOVERNANCE_OFFICER');
  const privacyReviewer = await createActor('intake-privacy', 'privacy_officer');
  const securityReviewer = await createActor('intake-security', 'security_reviewer');
  const ethicsReviewer = await createActor('intake-ethics', 'AI_ETHICS_COMMITTEE');
  const steeringReviewer = await createActor('intake-steering', 'STEERING_COMMITTEE');

  const lists: Record<string, Array<[string, string, string]>> = {
    L_STREAMS: [['STREAM_1', 'Stream 1', 'المسار الأول']],
    L_PROGRAMS: [['PROGRAM_1', 'Program 1', 'البرنامج الأول']],
    L_HUMAN: [['HUMAN_APPROVAL', 'Human approval', 'اعتماد بشري']],
    L_STAGE: [['PILOT', 'Pilot', 'تجربة محدودة']],
    L_MODEL: [['INTERNAL', 'Internal', 'تطوير داخلي']],
    L_AVAIL: [['AVAILABLE', 'Available', 'متاحة']],
    R_YN: [['YES', 'Yes', 'نعم'], ['NO', 'No', 'لا']],
    L_CLASS: [['RESTRICTED', 'Restricted', 'مقيدة'], ['CONFIDENTIAL', 'Confidential', 'سرية'], ['UNKNOWN', 'Unknown', 'غير معروف']],
    L_BUDGET: [['FUNDED', 'Funded', 'معتمدة']],
  };
  for (const [code, values] of Object.entries(lists)) {
    await db.governedReferenceList.create({
      data: { code, nameEn: code, nameAr: code, ownerRoleCode: 'AI_GOVERNANCE_OFFICER' },
    });
    const version = await db.governedReferenceVersion.create({ data: { listCode: code, version: 1, createdBy: 'phase2a-fixture' } });
    await db.governedReferenceValue.createMany({
      data: values.map(([valueCode, labelEn, labelAr], sortOrder) => ({ versionId: version.id, code: valueCode, labelEn, labelAr, sortOrder,
        metadata: code === 'L_STAGE' ? { airsLifecycleCode: 'PILOT' } : code === 'L_MODEL' ? { thirdParty: false }
          : code === 'L_CLASS' && valueCode === 'RESTRICTED' ? { assetClassificationCode: assetClass.code } : {},
      })),
    });
    await db.governedReferenceVersion.update({
      where: { id: version.id },
      data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedBy: 'phase2a-fixture', approvedAt: new Date('2020-01-01') },
    });
  }

  await db.governedReferenceList.upsert({
    where: { code: 'R_SDAIA_SCORE' },
    create: { code: 'R_SDAIA_SCORE', nameEn: 'SDAIA score', nameAr: 'درجة سدايا', ownerRoleCode: 'AI_GOVERNANCE_OFFICER' },
    update: {},
  });
  await db.governedReferenceVersion.updateMany({
    where: { listCode: 'R_SDAIA_SCORE', state: 'published' },
    data: { state: 'retired', effectiveTo: new Date('2099-01-01') },
  });
  const scoreVersionNumber = (await db.governedReferenceVersion.aggregate({ where: { listCode: 'R_SDAIA_SCORE' }, _max: { version: true } }))._max.version ?? 0;
  const scoreVersion = await db.governedReferenceVersion.create({ data: { listCode: 'R_SDAIA_SCORE', version: scoreVersionNumber + 1, createdBy: 'phase2a-fixture' } });
  await db.governedReferenceValue.createMany({
    data: [1, 2, 3, 4, 5].map(score => ({
      versionId: scoreVersion.id,
      code: `SCORE_${score}`,
      labelEn: `Score ${score}`,
      labelAr: `الدرجة ${score}`,
      sortOrder: score,
      metadata: {
        score,
        anchors: Object.fromEntries(AI_CLASSIFICATION_CRITERIA.map(criterion => [criterion, {
          labelEn: `${criterion} anchor ${score}`,
          labelAr: `${criterion} ${score}`,
        }])),
      },
    })),
  });
  await db.governedReferenceVersion.update({
    where: { id: scoreVersion.id },
    data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedBy: 'phase2a-fixture', approvedAt: new Date('2020-01-01') },
  });

  const evidenceDomain = await db.ndiDomain.create({
    data: { code: 'AI_PHASE_2D', nameEn: 'AI governance decisions', nameAr: 'قرارات حوكمة الذكاء الاصطناعي' },
  });
  const evidenceSpecification = await db.ndiSpecification.create({
    data: {
      code: 'AI-P2D-001', domainId: evidenceDomain.id,
      nameEn: 'Classification decision evidence', nameAr: 'دليل قرار التصنيف',
    },
  });
  const decisionEvidence = await db.ndiEvidence.create({
    data: {
      specId: evidenceSpecification.id, title: 'Phase 2D decision minute',
      fileName: 'phase-2d-decision.pdf', originalName: 'phase-2d-decision.pdf', mimeType: 'application/pdf',
      sizeBytes: 4, sha256: 'a'.repeat(64), submittedBy: officer.email, status: 'approved',
      reviewedBy: officer.email, reviewedAt: new Date('2026-09-10T08:00:00Z'),
    },
  });

  await db.governedReferenceList.upsert({
    where: { code: 'R_SDAIA_TIER' },
    create: { code: 'R_SDAIA_TIER', nameEn: 'SDAIA tier', nameAr: 'تصنيف سدايا', ownerRoleCode: 'AI_GOVERNANCE_OFFICER' },
    update: {},
  });
  await db.governedReferenceVersion.updateMany({
    where: { listCode: 'R_SDAIA_TIER', state: 'published' },
    data: { state: 'retired', effectiveTo: new Date('2099-01-01') },
  });
  const tierVersionNumber = (await db.governedReferenceVersion.aggregate({ where: { listCode: 'R_SDAIA_TIER' }, _max: { version: true } }))._max.version ?? 0;
  const tierVersion = await db.governedReferenceVersion.create({ data: { listCode: 'R_SDAIA_TIER', version: tierVersionNumber + 1, createdBy: 'phase2a-fixture' } });
  await db.governedReferenceValue.createMany({
    data: [
      { code: 'MINIMAL', labelEn: 'Minimal or none', labelAr: 'مخاطر قليلة أو معدومة', metadata: { automatic: true, minScore: 1, maxScore: 2, cadenceLevelCode: 'LOW' } },
      { code: 'LIMITED', labelEn: 'Limited', labelAr: 'مخاطر محدودة', metadata: { automatic: true, minScore: 3, maxScore: 3, cadenceLevelCode: 'MEDIUM' } },
      { code: 'HIGH', labelEn: 'High', labelAr: 'مخاطر عالية', metadata: { automatic: true, minScore: 4, maxScore: 5, cadenceLevelCode: 'HIGH' } },
      { code: 'UNACCEPTABLE', labelEn: 'Unacceptable', labelAr: 'مخاطر غير مقبولة', metadata: { automatic: false } },
    ].map((value, sortOrder) => ({ ...value, sortOrder, versionId: tierVersion.id })),
  });
  await db.governedReferenceVersion.update({
    where: { id: tierVersion.id },
    data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedBy: 'phase2a-fixture', approvedAt: new Date('2020-01-01') },
  });

  const draft = await service.createDraft(requester.id, { usecase_name: 'Assisted matching', proposed_owner: owner.id });
  assert.equal(draft.version, 1);
  assert.equal(draft.workflowCaseId, null);
  assert.equal(draft.intakeRevisions[0].revision, 1);

  const complete = {
    request_date: '2026-09-10', requester: requester.id, usecase_name: 'Assisted matching', proposed_owner: owner.id,
    strategic_streams: ['STREAM_1'], values_alignment: 'Supports equitable access', program_platform: 'PROGRAM_1',
    problem_desc: 'Manual matching takes too long', beneficiary_group: 'Job seekers', current_state: 'Manual review',
    objective_value: 'Reduce review time', success_kpi: 'Minutes per match', kpi_baseline: '30', kpi_target: '10',
    simpler_alternatives: { answer: true, justification: 'Rules were insufficient' },
    existing_solutions_check: { answer: true, details: 'Reviewed existing organization solutions' },
    human_role: 'HUMAN_APPROVAL', target_stage: 'PILOT', execution_model: 'INTERNAL', data_source: 'Matching records',
    data_owner: dataOwner.id, data_availability: 'AVAILABLE', personal_data_flag: 'YES', data_classification: 'RESTRICTED',
    budget_band: 'FUNDED', executive_sponsor: sponsor.id,
    constraints_dependencies: { text: '', none: true }, attachments: [],
  };
  const revised = await service.updateDraft(requester.id, draft.id, 1, complete);
  assert.equal(revised.version, 2);
  assert.equal(revised.conditions.personalDataInvolved, true);
  await assert.rejects(service.updateDraft(requester.id, draft.id, 1, { problem_desc: 'stale' }));

  const submitted = await service.submit(requester.id, draft.id, 2);
  assert.match(submitted.workflowCase!.code, /^AIUC-\d{4}-\d{6}$/u);
  assert.equal(submitted.workflowCase!.status, 'submitted');
  const boundWorkflow = await db.workflowCase.findUniqueOrThrow({ where: { id: submitted.workflowCase!.id }, include: { template: true } });
  assert.equal(boundWorkflow.template?.code, AIUC_WORKFLOW_TEMPLATE.code);
  assert.equal(submitted.useCaseRef, null, 'AI-### must wait for triage acceptance');
  assert.equal(submitted.version, 3);
  assert.equal(submitted.intakeRevisions[0].revision, 3);
  assert.ok(submitted.intakeRevisions[0].submittedAt);
  assert.equal(await db.aiIntakeRevision.count({ where: { useCaseId: draft.id } }), 3);
  const initialTriageTask = await db.workflowTask.findFirstOrThrow({
    where: { caseId: submitted.workflowCase!.id, status: 'pending', assigneeRoleCode: 'AI_WORKING_GROUP' },
  });
  assert.equal(initialTriageTask.type, 'review');
  assert.ok(initialTriageTask.dueDate);
  await assert.rejects(service.updateDraft(requester.id, draft.id, 3, { problem_desc: 'too late' }));
  await assert.rejects(service.submit(requester.id, draft.id, 3));

  assert.equal((await service.triageQueue(triageReviewer.id)).length, 1);
  await assert.rejects(service.triage(triageReviewer.id, draft.id, 3, 'return'));
  const returned = await service.triage(triageReviewer.id, draft.id, 3, 'return', 'Clarify the current-state baseline');
  assert.equal(returned.workflowCase!.status, 'awaiting_information');
  assert.equal(returned.version, 4);
  assert.equal(returned.useCaseRef, null);
  const clarified = await service.updateDraft(requester.id, draft.id, 4, { current_state: 'Manual review measured over the last quarter' });
  assert.equal(clarified.version, 5);
  assert.equal(clarified.intakeRevisions[0].revision, 4);
  const resubmitted = await service.resubmit(requester.id, draft.id, 5);
  assert.equal(resubmitted.workflowCase!.status, 'submitted');
  assert.equal(resubmitted.version, 6);
  assert.equal(resubmitted.intakeRevisions[0].revision, 5);
  const accepted = await service.triage(triageReviewer.id, draft.id, 6, 'accept');
  assert.equal(accepted.workflowCase!.status, 'under_review');
  assert.match(accepted.useCaseRef!, /^AI-\d{3,}$/u);
  assert.equal(accepted.version, 7);
  assert.equal(await db.workflowTask.count({ where: { caseId: accepted.workflowCase!.id, status: 'pending', title: { contains: 'classification' } } }), 1);
  const classificationConfig = await classification.configuration(triageReviewer.id);
  assert.equal(classificationConfig.ready, true);
  assert.equal((await classification.queue(triageReviewer.id)).length, 1);
  await assert.rejects(classification.assess(triageReviewer.id, draft.id, 7, {
    kind: 'classification', scores: Array(5).fill({ value: 3, justification: 'Evidence reviewed' }),
  }));
  const assessed = await classification.assess(triageReviewer.id, draft.id, 7, {
    kind: 'classification',
    scores: [1, 2, 3, 4, 5, 4].map(value => ({ value, justification: `Criterion evidence supports score ${value}` })),
  });
  assert.equal(assessed.version, 8);
  assert.equal((assessed.assessments[0].result as { scoreMax: number }).scoreMax, 5);
  assert.equal((assessed.assessments[0].result as { proposedTierCode: string }).proposedTierCode, 'HIGH');
  assert.equal(await db.aiAssessmentRound.count({ where: { useCaseId: draft.id, kind: 'classification' } }), 1);
  assert.equal(await db.workflowTask.count({ where: { caseId: accepted.workflowCase!.id, status: 'pending', assigneeRoleCode: 'AI_GOVERNANCE_OFFICER' } }), 1);
  assert.equal((await classification.verificationQueue(officer.id)).length, 1);
  await assert.rejects(classification.verificationQueue(triageReviewer.id));
  await assert.rejects(classification.override(officer.id, draft.id, 8, 'LIMITED',
    'A supported override', [], 'RAIO-P2D-001'));
  const overridden = await classification.override(officer.id, draft.id, 8, 'LIMITED',
    'Observed operational controls reduce the governed exposure', [decisionEvidence.id], 'RAIO-P2D-001', '127.0.0.1');
  assert.equal(overridden.version, 9);
  const overrideResult = overridden.assessments[0].result as {
    proposedTierCode: string; approvedTierCode: string; officerDecision: { evidenceIds: string[]; authorityReference: string };
  };
  assert.equal(overrideResult.proposedTierCode, 'HIGH');
  assert.equal(overrideResult.approvedTierCode, 'LIMITED');
  assert.deepEqual(overrideResult.officerDecision.evidenceIds, [decisionEvidence.id]);
  assert.equal(overrideResult.officerDecision.authorityReference, 'RAIO-P2D-001');
  assert.equal(await db.aiAssessmentRound.count({ where: { useCaseId: draft.id, kind: 'classification' } }), 2);
  const privacyTask = await db.workflowTask.findFirstOrThrow({ where: {
    caseId: accepted.workflowCase!.id, status: 'pending', assigneeRoleCode: 'privacy_officer',
    templateStage: { is: { code: AIUC_STAGE.privacy } },
  } });
  assert.equal((privacyTask.formDataJson as { assignmentRuleId: string }).assignmentRuleId, 'AR-AIUC-02');
  assert.equal(await db.workflowTask.count({ where: {
    caseId: accepted.workflowCase!.id, status: 'pending', templateStage: { is: { code: AIUC_STAGE.decision } },
  } }), 0, 'tier decision must wait for every instantiated specialist review');
  assert.equal((await classification.reviewQueue(privacyReviewer.id)).length, 1);
  assert.equal((await classification.reviewQueue(securityReviewer.id)).length, 0);
  assert.equal((await classification.reviewQueue(ethicsReviewer.id)).length, 1, 'High proposals require Ethics even when the approved tier is lowered');
  const privacyApproved = await classification.reviewGate(
    privacyReviewer.id, draft.id, privacyTask.id, 9, 'approve',
    'Privacy basis and controls are supported by the attached decision evidence', [decisionEvidence.id], '127.0.0.4',
  );
  assert.equal(privacyApproved.version, 10);
  assert.equal(privacyApproved.workflowCase!.status, 'under_review');
  assert.equal(await db.workflowTask.count({ where: {
    caseId: accepted.workflowCase!.id, status: 'pending', templateStage: { is: { code: AIUC_STAGE.decision } },
  } }), 0);
  const downgradedEthicsTask = await db.workflowTask.findFirstOrThrow({ where: {
    caseId: accepted.workflowCase!.id, status: 'pending', templateStage: { is: { code: AIUC_STAGE.ethics } },
  } });
  const downgradeReviewed = await classification.reviewGate(
    ethicsReviewer.id, draft.id, downgradedEthicsTask.id, 10, 'approve',
    'The committee reviewed the original High proposal and the officer override', [decisionEvidence.id], '127.0.0.8',
  );
  assert.equal(downgradeReviewed.version, 11);
  assert.equal(downgradeReviewed.workflowCase!.status, 'decision_made');
  const limitedDecisionTask = await db.workflowTask.findFirstOrThrow({ where: {
    caseId: accepted.workflowCase!.id, status: 'pending', assigneeRoleCode: 'AI_GOVERNANCE_OFFICER',
    templateStage: { is: { code: AIUC_STAGE.decision } },
  } });
  assert.equal((limitedDecisionTask.formDataJson as { assignmentRuleId: string }).assignmentRuleId, 'AR-AIUC-01');
  assert.equal((await classification.verificationQueue(officer.id)).length, 0);
  const overrideAudit = await db.auditLog.findFirstOrThrow({ where: { entityId: draft.id, action: 'aiuc.classification.overridden' } });
  assert.equal((overrideAudit.metadata as { clientIp: string }).clientIp, '127.0.0.1');
  assert.equal((await classification.queue(triageReviewer.id)).length, 0);
  await assert.rejects(classification.assess(triageReviewer.id, draft.id, 8, {
    kind: 'classification', scores: Array(6).fill({ value: 3, justification: 'Cannot assess twice' }),
  }));
  await assert.rejects(service.updateDraft(requester.id, draft.id, 7, { problem_desc: 'too late again' }));
  assert.equal((await service.triageQueue(triageReviewer.id)).length, 0);
  assert.equal(await db.auditLog.count({ where: { entityId: draft.id, action: { startsWith: 'aiuc.intake.' } } }), 5);
  assert.equal((await service.listOwn(requester.id)).length, 1);
  assert.equal((await service.getOwn(requester.id, draft.id)).id, draft.id);

  const approval = {
    expectedVersion: 11, decision: 'approve_with_conditions' as const,
    justification: 'Adopt the verified Limited tier subject to operational controls',
    evidenceIds: [decisionEvidence.id], conditions: ['Retain human approval for every matching decision'],
  };
  assert.equal((await decisions.queue(officer.id)).length, 1);
  await assert.rejects(decisions.record(officer.id, draft.id, limitedDecisionTask.id, { ...approval, evidenceIds: [] }));
  await assert.rejects(decisions.record(officer.id, draft.id, limitedDecisionTask.id, {
    ...approval, evidenceIds: ['11111111-1111-4111-8111-111111111111'],
  }));
  await assert.rejects(decisions.record(officer.id, draft.id, limitedDecisionTask.id, { ...approval, justification: ' ' }));
  await assert.rejects(decisions.record(officer.id, draft.id, limitedDecisionTask.id, { ...approval, conditions: [] }));
  await assert.rejects(decisions.record(sponsor.id, draft.id, limitedDecisionTask.id, approval));
  const officerRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_GOVERNANCE_OFFICER' } });
  await db.userRole.create({ data: { userId: owner.id, roleId: officerRole.id } });
  await assert.rejects(decisions.record(owner.id, draft.id, limitedDecisionTask.id, approval));
  assert.equal((await decisions.queue(owner.id)).length, 0, 'owners cannot hold their own stage-6 queue item');
  await db.userRole.create({ data: { userId: requester.id, roleId: officerRole.id } });
  await assert.rejects(decisions.record(requester.id, draft.id, limitedDecisionTask.id, approval));
  assert.equal((await decisions.queue(requester.id)).length, 0, 'requesters cannot hold their own stage-6 queue item');
  await db.userRole.delete({ where: { userId_roleId: { userId: requester.id, roleId: officerRole.id } } });
  await db.workflowTask.update({ where: { id: downgradedEthicsTask.id }, data: { status: 'cancelled' } });
  await assert.rejects(decisions.record(officer.id, draft.id, limitedDecisionTask.id, approval));
  await db.workflowTask.update({ where: { id: downgradedEthicsTask.id }, data: { status: 'completed' } });
  const failedAuditDecision = new AiDecisionService(prisma, authorization, {
    logRequired: async () => { throw new Error('Injected decision audit failure'); },
  } as unknown as AuditService, routing);
  await assert.rejects(failedAuditDecision.record(officer.id, draft.id, limitedDecisionTask.id, approval), /Injected decision audit failure/);
  assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: draft.id } })).version, 11);
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: limitedDecisionTask.id } })).status, 'pending');
  assert.equal(await db.aiApprovalObligation.count({ where: { useCaseId: draft.id } }), 0);
  assert.equal(await db.workflowTask.count({ where: { caseId: accepted.workflowCase!.id, templateStage: { is: { code: AIUC_STAGE.assetRegistration } } } }), 0);
  const adopted = await decisions.record(officer.id, draft.id, limitedDecisionTask.id, approval, '127.0.0.9');
  assert.equal(adopted.version, 12);
  assert.equal(adopted.workflowCase.status, 'approved');
  assert.equal(adopted.decision.resolutionCode, 'Approved with Conditions');
  assert.equal(adopted.decision.authorityReference, 'RAIO-P2D-001');
  assert.equal(await db.aiApprovalObligation.count({ where: { useCaseId: draft.id } }), 1);
  const handoverTask = await db.workflowTask.findUniqueOrThrow({ where: { id: adopted.nextTaskId! }, include: { templateStage: true } });
  assert.equal(handoverTask.templateStage!.code, AIUC_STAGE.assetRegistration);
  assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: draft.id } })).assetId, null, 'asset registration remains a separate gate');
  const adoptionAudit = await db.auditLog.findFirstOrThrow({ where: { entityId: draft.id, action: 'aiuc.decision.approve_with_conditions' } });
  assert.equal((adoptionAudit.metadata as { clientIp: string }).clientIp, '127.0.0.9');
  await assert.rejects(decisions.record(officer.id, draft.id, limitedDecisionTask.id, approval));

  const manualDraft = await service.createDraft(requester.id, { usecase_name: 'Automated eligibility', proposed_owner: owner.id });
  await service.updateDraft(requester.id, manualDraft.id, 1, {
    ...complete,
    usecase_name: 'Automated eligibility',
    personal_data_flag: 'NO',
    data_classification: 'CONFIDENTIAL',
  });
  const manualSubmitted = await service.submit(requester.id, manualDraft.id, 2);
  const manualAccepted = await service.triage(triageReviewer.id, manualDraft.id, 3, 'accept');
  const manualAssessed = await classification.assess(triageReviewer.id, manualDraft.id, 4, {
    kind: 'classification', scores: Array(6).fill(null).map((_, index) => ({ value: 2, justification: `Initial criterion evidence ${index + 1}` })),
  });
  assert.equal(manualAssessed.version, 5);
  const returnedAssessment = await classification.returnForReassessment(officer.id, manualDraft.id, 5,
    'Reassess the autonomy evidence before the officer decision', '127.0.0.2');
  assert.equal(returnedAssessment.version, 6);
  assert.equal(await db.workflowTask.count({ where: {
    caseId: manualSubmitted.workflowCase!.id, status: 'pending', assigneeRoleCode: 'AI_WORKING_GROUP',
    title: 'Six-criterion SDAIA classification assessment',
  } }), 1);
  const reassessed = await classification.assess(triageReviewer.id, manualDraft.id, 6, {
    kind: 'classification', scores: Array(6).fill(null).map((_, index) => ({ value: 3, justification: `Reassessed criterion evidence ${index + 1}` })),
  });
  assert.equal(reassessed.version, 7);
  await assert.rejects(classification.unacceptable(officer.id, manualDraft.id, 7,
    'The residual impact is prohibited', [], 'ETHICS-2026-04'));
  const unacceptable = await classification.unacceptable(officer.id, manualDraft.id, 7,
    'The residual impact is prohibited despite the calculated tier', [decisionEvidence.id], 'ETHICS-2026-04', '127.0.0.3');
  assert.equal(unacceptable.version, 8);
  const unacceptableResult = unacceptable.assessments[0].result as { proposedTierCode: string; approvedTierCode: string };
  assert.equal(unacceptableResult.proposedTierCode, 'LIMITED');
  assert.equal(unacceptableResult.approvedTierCode, 'UNACCEPTABLE');
  assert.equal(await db.aiAssessmentRound.count({ where: { useCaseId: manualDraft.id, kind: 'classification' } }), 3);
  const conditionalTasks = await db.workflowTask.findMany({
    where: {
      caseId: manualAccepted.workflowCase!.id,
      status: 'pending',
      templateStage: { is: { code: { in: [AIUC_STAGE.privacy, AIUC_STAGE.security, AIUC_STAGE.ethics] } } },
    },
    include: { templateStage: true },
  });
  assert.deepEqual(conditionalTasks.map(task => task.templateStage!.code).sort(), [AIUC_STAGE.ethics, AIUC_STAGE.security].sort());
  assert.equal((await classification.reviewQueue(securityReviewer.id)).length, 1);
  assert.equal((await classification.reviewQueue(ethicsReviewer.id)).length, 1);
  const securityTask = conditionalTasks.find(task => task.templateStage!.code === AIUC_STAGE.security)!;
  const ethicsTask = conditionalTasks.find(task => task.templateStage!.code === AIUC_STAGE.ethics)!;
  const securityApproved = await classification.reviewGate(
    securityReviewer.id, manualDraft.id, securityTask.id, 8, 'approve',
    'Security controls and confidential-data handling were reviewed', [decisionEvidence.id], '127.0.0.5',
  );
  assert.equal(securityApproved.version, 9);
  assert.equal(await db.workflowTask.count({ where: {
    caseId: manualAccepted.workflowCase!.id, status: 'pending', templateStage: { is: { code: AIUC_STAGE.decision } },
  } }), 0, 'decision must remain blocked while the Ethics review is open');
  const ethicsRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_ETHICS_COMMITTEE' } });
  await db.userRole.create({ data: { userId: owner.id, roleId: ethicsRole.id } });
  await assert.rejects(classification.reviewGate(
    owner.id, manualDraft.id, ethicsTask.id, 9, 'approve',
    'An owner must be recused from the Ethics review', [decisionEvidence.id], '127.0.0.7',
  ));
  assert.equal(await db.auditLog.count({ where: {
    entityId: manualDraft.id,
    action: 'ai.sod.blocked',
    metadata: { path: ['recusal'], equals: true },
  } }), 1);
  const ethicsApproved = await classification.reviewGate(
    ethicsReviewer.id, manualDraft.id, ethicsTask.id, 9, 'approve',
    'The committee independently reviewed the prohibited-risk evidence', [decisionEvidence.id], '127.0.0.6',
  );
  assert.equal(ethicsApproved.version, 10);
  const steeringTask = await db.workflowTask.findFirstOrThrow({ where: {
    caseId: manualAccepted.workflowCase!.id, status: 'pending', assigneeRoleCode: 'STEERING_COMMITTEE',
    templateStage: { is: { code: AIUC_STAGE.decision } },
  } });
  assert.equal((steeringTask.formDataJson as { assignmentRuleId: string }).assignmentRuleId, 'AR-AIUC-05');
  const stopDecision = {
    expectedVersion: 10, decision: 'stop' as const, justification: 'The Steering Committee prohibits this Unacceptable use',
    evidenceIds: [decisionEvidence.id],
  };
  assert.equal((await decisions.queue(steeringReviewer.id)).length, 1);
  await assert.rejects(decisions.record(steeringReviewer.id, manualDraft.id, steeringTask.id, { ...stopDecision, decision: 'approve' }));
  const stopped = await decisions.record(steeringReviewer.id, manualDraft.id, steeringTask.id, stopDecision, '127.0.0.10');
  assert.equal(stopped.workflowCase.status, 'rejected');
  assert.equal(stopped.decision.approvedTierCode, 'UNACCEPTABLE');
  assert.equal(stopped.nextTaskId, null);
  assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: manualDraft.id } })).useCaseRef, manualAccepted.useCaseRef);
  assert.equal(await db.aiRisk.count({ where: { useCaseId: manualDraft.id } }), 0);

  async function prepareHighCase(name: string) {
    const caseDraft = await service.createDraft(requester.id, { usecase_name: name, proposed_owner: owner.id });
    await service.updateDraft(requester.id, caseDraft.id, 1, { ...complete, usecase_name: name, personal_data_flag: 'NO' });
    await service.submit(requester.id, caseDraft.id, 2);
    await service.triage(triageReviewer.id, caseDraft.id, 3, 'accept');
    await classification.assess(triageReviewer.id, caseDraft.id, 4, {
      kind: 'classification', scores: Array(6).fill({ value: 4, justification: 'High impact is supported by the governed evidence' }),
    });
    const verified = await classification.verify(officer.id, caseDraft.id, 5, 'Confirmed High proposal');
    const ethics = await db.workflowTask.findFirstOrThrow({ where: {
      caseId: verified.workflowCaseId!, status: 'pending', templateStage: { is: { code: AIUC_STAGE.ethics } },
    } });
    await classification.reviewGate(ethicsReviewer.id, caseDraft.id, ethics.id, 6, 'approve', 'Independent Ethics review completed', [decisionEvidence.id]);
    const decisionTask = await db.workflowTask.findFirstOrThrow({ where: {
      caseId: verified.workflowCaseId!, status: 'pending', templateStage: { is: { code: AIUC_STAGE.decision } },
    } });
    assert.equal(decisionTask.assigneeRoleCode, 'AI_EXECUTIVE_TEAM');
    return { id: caseDraft.id, taskId: decisionTask.id, caseId: verified.workflowCaseId! };
  }
  const highReturned = await prepareHighCase('High autonomy proposal');
  const highReturn = { expectedVersion: 7, decision: 'return' as const, justification: 'Reduce decision autonomy and reassess', evidenceIds: [decisionEvidence.id] };
  await assert.rejects(decisions.record(officer.id, highReturned.id, highReturned.taskId, highReturn));
  const returnedDecision = await decisions.record(sponsor.id, highReturned.id, highReturned.taskId, highReturn);
  assert.equal(returnedDecision.version, 8);
  assert.equal(returnedDecision.workflowCase.status, 'under_review');
  await classification.assess(triageReviewer.id, highReturned.id, 8, {
    kind: 'classification', scores: Array(6).fill({ value: 3, justification: 'Revised controls support the Limited tier' }),
  });
  const revisedVerified = await classification.verify(officer.id, highReturned.id, 9);
  assert.equal(revisedVerified.workflowCase!.status, 'decision_made');
  const rejectTask = await db.workflowTask.findFirstOrThrow({ where: {
    caseId: highReturned.caseId, status: 'pending', templateStage: { is: { code: AIUC_STAGE.decision } },
  } });
  const rejectedDecision = await decisions.record(officer.id, highReturned.id, rejectTask.id, {
    expectedVersion: 10, decision: 'reject', justification: 'The adoption benefits are insufficient', evidenceIds: [decisionEvidence.id],
  });
  assert.equal(rejectedDecision.workflowCase.status, 'rejected');
  assert.equal(rejectedDecision.nextTaskId, null);

  const highApproved = await prepareHighCase('High supervised recommendation');
  const executiveApproved = await decisions.record(sponsor.id, highApproved.id, highApproved.taskId, {
    expectedVersion: 7, decision: 'approve', justification: 'Executive approval follows completed Ethics review', evidenceIds: [decisionEvidence.id],
  });
  assert.equal(executiveApproved.workflowCase.status, 'approved');
  assert.ok(executiveApproved.nextTaskId);

  const incomplete = await service.createDraft(requester.id, { usecase_name: 'Incomplete request', proposed_owner: owner.id });
  await assert.rejects(service.submit(requester.id, incomplete.id, 1));
  assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: incomplete.id } })).workflowCaseId, null);

  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const jwt = app.get(JwtService);
    const sharedWorkflow = app.get(WorkflowService);
    const genericAdmin = { id: officer.id, email: officer.email, roles: ['system_admin'] };
    await assert.rejects(sharedWorkflow.decideTask(handoverTask.id, { decision: TaskDecision.approved }, genericAdmin), /AI Governance actions/);
    await assert.rejects(sharedWorkflow.saveTaskFormDraft(handoverTask.id, { data: { approvedTierCode: 'MINIMAL' } }, genericAdmin), /AI Governance actions/);
    assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: handoverTask.id } })).status, 'pending');
    const headers = {
      authorization: `Bearer ${jwt.sign({ sub: requester.id, tokenVersion: 0, roles: ['business_steward'] })}`,
      'content-type': 'application/json',
    };
    const reviewerHeaders = {
      authorization: `Bearer ${jwt.sign({ sub: triageReviewer.id, tokenVersion: 0, roles: ['AI_WORKING_GROUP'] })}`,
      'content-type': 'application/json',
    };
    const officerHeaders = {
      authorization: `Bearer ${jwt.sign({ sub: officer.id, tokenVersion: 0, roles: ['AI_GOVERNANCE_OFFICER'] })}`,
      'content-type': 'application/json',
    };
    const privacyHeaders = {
      authorization: `Bearer ${jwt.sign({ sub: privacyReviewer.id, tokenVersion: 0, roles: ['privacy_officer'] })}`,
      'content-type': 'application/json',
    };
    assert.equal((await fetch(`${base}/api/ai/use-cases`)).status, 401);
    const httpCreate = await fetch(`${base}/api/ai/use-cases`, {
      method: 'POST', headers,
      body: JSON.stringify({ payload: { usecase_name: 'HTTP draft', proposed_owner: owner.id } }),
    });
    assert.equal(httpCreate.status, 201);
    assert.equal((await fetch(`${base}/api/ai/use-cases`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/triage`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/configuration`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/configuration`, { headers: reviewerHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/queue`, { headers: reviewerHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/verification/queue`, { headers: reviewerHeaders })).status, 403);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/verification/queue`, { headers: officerHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/reviews/queue`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/ai/use-cases/classification/reviews/queue`, { headers: privacyHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/decisions/queue`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/ai/use-cases/decisions/queue`, { headers: officerHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/registration/queue`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/ai/use-cases/registration/queue`, { headers: reviewerHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/registration/lookups`, { headers: reviewerHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/use-cases/registration/${draft.id}/${handoverTask.id}/propose`, {
      method: 'POST', headers: reviewerHeaders, body: JSON.stringify({ expectedVersion: 12, justification: 'Injected mapping', mode: 'create', domainId: assetDomain.id, classificationId: assetClass.id, injectedTier: 'MINIMAL' }),
    })).status, 400);
    const badDecision = await fetch(`${base}/api/ai/use-cases/decisions/${draft.id}/${limitedDecisionTask.id}`, {
      method: 'POST', headers: officerHeaders,
      body: JSON.stringify({ ...approval, injectedTier: 'MINIMAL' }),
    });
    assert.equal(badDecision.status, 400);
    const lookups = await fetch(`${base}/api/ai/use-cases/lookups`, { headers });
    assert.equal(lookups.status, 200);
    assert.equal((await lookups.json() as { ready: boolean }).ready, true);
    const rejected = await fetch(`${base}/api/ai/use-cases`, {
      method: 'POST', headers,
      body: JSON.stringify({ payload: {}, injectedField: true }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
  }

  const proposal = { expectedVersion: 12, justification: 'Register the approved supervised matching product', mode: 'create' as const,
    nameEn: 'Assisted matching product', nameAr: 'منتج المطابقة المساعدة', assetSubtype: 'recommendation_system',
    domainId: assetDomain.id, classificationId: assetClass.id };
  assert.ok((await registrations.queue(triageReviewer.id)).some(value => value.id === draft.id));
  await assert.rejects(registrations.propose(officer.id, draft.id, handoverTask.id, proposal));
  const workingGroupRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_WORKING_GROUP' } });
  await db.userRole.create({ data: { userId: dataOwner.id, roleId: workingGroupRole.id } });
  await assert.rejects(registrations.propose(dataOwner.id, draft.id, handoverTask.id, proposal), /independent/i,
    'a Data Owner with a working-group role cannot prepare their own approval');
  await db.userRole.delete({ where: { userId_roleId: { userId: dataOwner.id, roleId: workingGroupRole.id } } });
  const proposedAsset = await registrations.propose(triageReviewer.id, draft.id, handoverTask.id, proposal);
  assert.equal(proposedAsset.version, 13);
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: proposedAsset.nextTaskId } })).assigneeUserId, dataOwner.id);
  assert.ok((await registrations.queue(dataOwner.id)).some(value => value.id === draft.id));
  const assetDecision = { expectedVersion: 13, decision: 'return' as const, justification: 'Please refine the registration names', evidenceIds: [decisionEvidence.id] };
  await assert.rejects(registrations.decide(requester.id, draft.id, proposedAsset.nextTaskId, assetDecision));
  await assert.rejects(registrations.decide(dataOwner.id, draft.id, proposedAsset.nextTaskId, { ...assetDecision, evidenceIds: [] }));
  const returnedAsset = await registrations.decide(dataOwner.id, draft.id, proposedAsset.nextTaskId, assetDecision);
  assert.equal(returnedAsset.version, 14);
  assert.equal(await db.aiRisk.count({ where: { aiucHandoffSourceId: draft.id } }), 0);
  assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: draft.id } })).assetId, null);
  const resubmittedAsset = await registrations.propose(triageReviewer.id, draft.id, returnedAsset.nextTaskId!, { ...proposal, expectedVersion: 14 });
  const finalAssetDecision = { ...assetDecision, expectedVersion: 15, decision: 'approve' as const, justification: 'The independent Data Owner approves registration and handover' };
  await assert.rejects(registrations.decide(dataOwner.id, draft.id, resubmittedAsset.nextTaskId, finalAssetDecision), /mapping|metadata/i,
    'unpublished handoff mappings must block without creating an asset');
  assert.equal(await db.dataAsset.count({ where: { code: `AST-${accepted.useCaseRef}` } }), 0);
  async function publishHandoffMapping(listCode: string, values: Array<{ code: string; metadata: Prisma.InputJsonObject }>) {
    await db.governedReferenceList.upsert({ where: { code: listCode }, create: { code: listCode, nameEn: listCode, nameAr: listCode, ownerRoleCode: 'AI_GOVERNANCE_OFFICER' }, update: {} });
    await db.governedReferenceVersion.updateMany({ where: { listCode, state: 'published' }, data: { state: 'retired', effectiveTo: new Date() } });
    const versionNumber = (await db.governedReferenceVersion.aggregate({ where: { listCode }, _max: { version: true } }))._max.version ?? 0;
    const version = await db.governedReferenceVersion.create({ data: { listCode, version: versionNumber + 1, createdBy: 'phase2g-fixture' } });
    await db.governedReferenceValue.createMany({ data: values.map(value => ({ ...value, versionId: version.id, labelEn: value.code, labelAr: value.code })) });
    await db.governedReferenceVersion.update({ where: { id: version.id }, data: { state: 'published', effectiveFrom: new Date('2020-01-01'), approvedBy: 'phase2g-fixture', approvedAt: new Date('2020-01-01') } });
  }
  await publishHandoffMapping('R_LEVEL_DAYS', [ { code: 'LOW', metadata: { days: 365 } }, { code: 'MEDIUM', metadata: { days: 180 } }, { code: 'HIGH', metadata: { days: 90 } } ]);
  await publishHandoffMapping('R_LIFECYCLE', [{ code: 'PILOT', metadata: {} }]);
  const failedHandoff = new AiRegistrationService(prisma, authorization, routing, assetFacade, new AiIdentifiersService(), {
    logRequired: async () => { throw new Error('Injected handoff audit failure'); },
  } as unknown as AuditService, scope);
  await assert.rejects(failedHandoff.decide(dataOwner.id, draft.id, resubmittedAsset.nextTaskId, finalAssetDecision), /Injected handoff audit failure/);
  assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: draft.id } })).version, 15);
  assert.equal((await db.workflowCase.findUniqueOrThrow({ where: { id: accepted.workflowCase!.id } })).status, 'approved');
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: resubmittedAsset.nextTaskId } })).status, 'pending');
  assert.equal(await db.dataAsset.count({ where: { code: `AST-${accepted.useCaseRef}` } }), 0);
  assert.equal(await db.aiRisk.count({ where: { aiucHandoffSourceId: draft.id } }), 0);
  const concurrentHandoffs = await Promise.allSettled([
    registrations.decide(dataOwner.id, draft.id, resubmittedAsset.nextTaskId, finalAssetDecision, '127.0.0.10'),
    registrations.decide(dataOwner.id, draft.id, resubmittedAsset.nextTaskId, finalAssetDecision, '127.0.0.10'),
  ]);
  assert.equal(concurrentHandoffs.filter(value => value.status === 'fulfilled').length, 1, 'exactly one concurrent handoff commits');
  assert.equal(await db.aiRisk.count({ where: { aiucHandoffSourceId: draft.id } }), 1);
  const handedOver = await db.aiRisk.findUniqueOrThrow({ where: { aiucHandoffSourceId: draft.id }, include: { workflowCase: true } });
  const handoffPayload = handedOver.handoffPayload as { relatedAssetId: string; nextReviewBasisDays: number; personalDataInvolved: boolean; sensitiveDataInvolved: boolean; ownerPersonId: string; organizationUnitId: string };
  assert.equal(handedOver.riskRef, null, 'AIR identifier is allocated only on later risk submission');
  assert.equal(handedOver.workflowCase!.type, 'AIRS'); assert.equal(handedOver.workflowCase!.status, 'draft');
  assert.equal(handedOver.workflowCase!.assetId, handoffPayload.relatedAssetId);
  assert.equal(handoffPayload.nextReviewBasisDays, 180); assert.equal(handoffPayload.personalDataInvolved, true); assert.equal(handoffPayload.sensitiveDataInvolved, false);
  assert.equal(handoffPayload.ownerPersonId, owner.person.id); assert.equal(handoffPayload.organizationUnitId, assetOrg.id);
  const registeredAsset = await db.dataAsset.findUniqueOrThrow({ where: { id: handoffPayload.relatedAssetId } });
  assert.equal(registeredAsset.assetType, 'ai_data_product'); assert.equal(registeredAsset.assetSubtype, 'recommendation_system');
  assert.equal((await db.stewardshipAssignment.findFirstOrThrow({ where: { targetType: 'asset', targetId: registeredAsset.id,
    roleTypeId: assetOwnerRoleType.id, approvalStatus: 'approved', isPrimary: true } })).personId, dataOwner.person.id);
  assert.equal((registeredAsset.typeMetadataJson as { aiUseCaseRef: string }).aiUseCaseRef, accepted.useCaseRef);
  assert.equal((await db.aiUseCase.findUniqueOrThrow({ where: { id: draft.id } })).assetId, registeredAsset.id);
  assert.equal((await db.workflowCase.findUniqueOrThrow({ where: { id: accepted.workflowCase!.id } })).status, 'closed');
  const handedCondition = await db.aiApprovalObligation.findFirstOrThrow({ where: { useCaseId: draft.id } });
  assert.equal(handedCondition.assetId, registeredAsset.id); assert.equal(handedCondition.riskId, handedOver.id);
  await assert.rejects(registrations.decide(dataOwner.id, draft.id, resubmittedAsset.nextTaskId, finalAssetDecision));
  await assert.rejects(db.aiRisk.update({ where: { id: handedOver.id }, data: { handoffPayload: {}, version: { increment: 1 } } }));
  await assert.rejects(db.aiRisk.create({ data: { useCaseId: draft.id, aiucHandoffSourceId: draft.id, handoffPayload: {}, createdBy: 'duplicate-fixture' } }));

  const existingProduct = await db.dataAsset.create({ data: { code: 'AST-AI-P2G-EXISTING', nameEn: 'Existing prediction service', nameAr: 'خدمة تنبؤ قائمة',
    assetType: 'ai_data_product', assetSubtype: 'prediction_service', orgUnitId: assetOrg.id, domainId: assetDomain.id, classificationId: assetClass.id } });
  const linkedProposal = { expectedVersion: 8, justification: 'Link the existing governed prediction product', mode: 'link' as const,
    existingAssetId: existingProduct.id, domainId: assetDomain.id, classificationId: assetClass.id };
  await assert.rejects(registrations.propose(triageReviewer.id, highApproved.id, executiveApproved.nextTaskId!, linkedProposal), /primary approved Data Owner/i);
  await assert.rejects(registrations.propose(triageReviewer.id, highApproved.id, executiveApproved.nextTaskId!, { ...linkedProposal, existingAssetId: registeredAsset.id }), /another AI use-case identity/i);
  await db.stewardshipAssignment.create({ data: { targetType: 'asset', targetId: existingProduct.id, roleTypeId: assetOwnerRoleType.id, personId: dataOwner.person.id, approvalStatus: 'approved' } });
  const linkedSubmission = await registrations.propose(triageReviewer.id, highApproved.id, executiveApproved.nextTaskId!, linkedProposal);
  const beforeLinkCount = await db.dataAsset.count();
  const linkedHandoff = await registrations.decide(dataOwner.id, highApproved.id, linkedSubmission.nextTaskId, {
    expectedVersion: 9, decision: 'approve', justification: 'Data Owner independently approves the existing-product handover', evidenceIds: [decisionEvidence.id],
  });
  assert.equal(linkedHandoff.assetId, existingProduct.id); assert.equal(await db.dataAsset.count(), beforeLinkCount);
  assert.equal(await db.aiRisk.count({ where: { aiucHandoffSourceId: highApproved.id } }), 1);
  await assert.rejects(db.aiUseCase.update({ where: { id: draft.id }, data: { assetId: existingProduct.id, version: { increment: 1 } } }));
  await assert.rejects(db.dataAsset.update({ where: { id: registeredAsset.id }, data: { typeMetadataJson: {} } }));
  await assert.rejects(db.aiApprovalObligation.update({ where: { id: handedCondition.id }, data: { assetId: existingProduct.id, version: { increment: 1 } } }));
  const risks = new AiRiskIntakeService(prisma, authorization, scope, routing, new AiIdentifiersService(), audit);
  const riskOwner = await createActor('risk-owner', 'AI_RISK_OWNER');
  const otherRiskOwner = await createActor('other-risk-owner', 'AI_RISK_OWNER');
  const preservedHandoff = JSON.stringify(handedOver.handoffPayload);
  assert.ok((await risks.list(triageReviewer.id)).some(item => item.id === handedOver.id));
  assert.ok(!(await risks.list(riskOwner.id)).some(item => item.id === handedOver.id));
  const assignment = { expectedVersion: 1, ownerUserId: riskOwner.id, justification: 'Assign the eligible product risk owner' };
  const brokenAudit = { logRequired: async () => { throw new Error('Injected risk audit failure'); } } as unknown as AuditService;
  const failingRisks = new AiRiskIntakeService(prisma, authorization, scope, routing, new AiIdentifiersService(), brokenAudit);
  await assert.rejects(failingRisks.assign(triageReviewer.id, handedOver.id, assignment), /Injected risk audit failure/);
  assert.equal((await db.aiRisk.findUniqueOrThrow({ where: { id: handedOver.id } })).ownerPersonId, null);
  await risks.assign(triageReviewer.id, handedOver.id, assignment);
  assert.equal((await risks.get(riskOwner.id, handedOver.id)).canEdit, true);
  const identificationTask = await db.workflowTask.findFirstOrThrow({ where: { caseId: handedOver.workflowCaseId!, status: 'pending' }, include: { templateStage: true } });
  assert.equal(identificationTask.templateStage!.code, 'airs-identification');
  assert.equal(identificationTask.assigneeUserId, riskOwner.id);
  assert.ok(identificationTask.dueDate);
  await assert.rejects(risks.assign(riskOwner.id, handedOver.id, { ...assignment, expectedVersion: 2 }), /working group/);
  await assert.rejects(risks.save(otherRiskOwner.id, handedOver.id, 2, { title: 'Unauthorized edit' }));
  await assert.rejects(failingRisks.save(riskOwner.id, handedOver.id, 2, { title: 'Rolled back title' }), /Injected risk audit failure/);
  assert.equal((await db.aiRisk.findUniqueOrThrow({ where: { id: handedOver.id } })).version, 2);
  await risks.save(riskOwner.id, handedOver.id, 2, { title: 'Bias in assisted matching', cause: 'Unrepresentative source data' });
  await assert.rejects(risks.submit(riskOwner.id, handedOver.id, 3), error => {
    const response = (error as { getResponse(): { issues: Array<{ field: string }> } }).getResponse();
    return ['event', 'effect', 'current_controls'].every(field => response.issues.some(issue => issue.field === field));
  });
  assert.equal((await db.aiRisk.findUniqueOrThrow({ where: { id: handedOver.id } })).riskRef, null);
  await assert.rejects(risks.save(riskOwner.id, handedOver.id, 2, { title: 'Stale edit' }), /changed/);
  await assert.rejects(risks.save(riskOwner.id, handedOver.id, 3, { inherentScore: 16 }), /validation/);
  await assert.rejects(risks.save(riskOwner.id, handedOver.id, 3, { risk_category: 'UNPUBLISHED' }), /references/);
  await assert.rejects(risks.save(riskOwner.id, handedOver.id, 3, { evidence: ['00000000-0000-4000-8000-000000000099'] }), /references/);
  const classifications = { risk_category: 'FAIRNESS', ethics_principle: 'FAIRNESS', dev_stage: 'PILOT',
    control_effectiveness: 'PARTIAL', risk_source: 'SYSTEM', risk_intent: 'UNINTENDED', risk_timing: 'BEFORE_LAUNCH' };
  for (const [listCode, code] of [['R_RISKCAT', 'FAIRNESS'], ['R_ETHICS', 'FAIRNESS'], ['R_CTRLEFF', 'PARTIAL'],
    ['R_SOURCE', 'SYSTEM'], ['R_INTENT', 'UNINTENDED'], ['R_TIMING', 'BEFORE_LAUNCH']]) {
    await publishHandoffMapping(listCode, [{ code, metadata: {} }]);
  }
  assert.equal((await risks.lookups(riskOwner.id)).ready, true);
  await risks.save(riskOwner.id, handedOver.id, 3, { ...classifications, event: 'Unequal recommendations',
    effect: 'Unfair allocation', current_controls: 'Human review and sampling', third_party_involved: false, evidence: [decisionEvidence.id] });
  await assert.rejects(failingRisks.submit(riskOwner.id, handedOver.id, 4), /Injected risk audit failure/);
  const rolledBackRisk = await db.aiRisk.findUniqueOrThrow({ where: { id: handedOver.id }, include: { workflowCase: true } });
  assert.equal(rolledBackRisk.version, 4); assert.equal(rolledBackRisk.riskRef, null); assert.equal(rolledBackRisk.workflowCase!.status, 'draft');
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: identificationTask.id } })).status, 'pending');
  assert.equal(await db.workflowTask.count({ where: { caseId: handedOver.workflowCaseId!, templateStage: { code: 'airs-inherent-assessment' } } }), 0);
  const submissions = await Promise.allSettled([risks.submit(riskOwner.id, handedOver.id, 4), risks.submit(riskOwner.id, handedOver.id, 4)]);
  assert.equal(submissions.filter(result => result.status === 'fulfilled').length, 1);
  const submittedRisk = await db.aiRisk.findUniqueOrThrow({ where: { id: handedOver.id }, include: { workflowCase: true } });
  assert.match(submittedRisk.riskRef!, /^AIR-\d{3,}$/); assert.equal(submittedRisk.version, 5);
  assert.equal(submittedRisk.workflowCase!.code, handedOver.workflowCase!.code); assert.equal(submittedRisk.workflowCase!.status, 'under_review');
  assert.equal(await db.aiAssessmentRound.count({ where: { riskId: handedOver.id } }), 0);
  assert.equal(JSON.stringify(submittedRisk.handoffPayload), preservedHandoff);
  const submittedIntake = submittedRisk.intakeData as { referenceVersionIds: Record<string, string>; resolvedValues: Record<string, { code: string }> };
  assert.equal(Object.keys(submittedIntake.referenceVersionIds).length, 7);
  assert.equal(submittedIntake.resolvedValues.risk_category.code, 'FAIRNESS');
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: identificationTask.id } })).status, 'completed');
  const assessmentTask = await db.workflowTask.findFirstOrThrow({ where: { caseId: handedOver.workflowCaseId!, status: 'pending' }, include: { templateStage: true } });
  assert.equal(assessmentTask.templateStage!.code, 'airs-inherent-assessment'); assert.equal(assessmentTask.assigneeUserId, riskOwner.id);
  assert.equal(await db.workflowTask.count({ where: { caseId: handedOver.workflowCaseId!, status: 'pending' } }), 1);
  assert.equal((await risks.get(riskOwner.id, handedOver.id)).canEdit, false);
  await assert.rejects(risks.save(riskOwner.id, handedOver.id, 5, { title: 'Edit after submission' }));
  await assert.rejects(risks.submit(riskOwner.id, handedOver.id, 4));
  await assert.rejects(risks.assign(triageReviewer.id, handedOver.id, { ...assignment, expectedVersion: 5, ownerUserId: otherRiskOwner.id }));
  assert.equal((await db.aiApprovalObligation.findUniqueOrThrow({ where: { id: handedCondition.id } })).riskId, handedOver.id);

  const linkedRisk = await db.aiRisk.findUniqueOrThrow({ where: { aiucHandoffSourceId: highApproved.id } });
  await risks.assign(triageReviewer.id, linkedRisk.id, assignment);
  const oldAssignmentTask = await db.workflowTask.findFirstOrThrow({ where: { caseId: linkedRisk.workflowCaseId!, status: 'pending' } });
  await risks.assign(triageReviewer.id, linkedRisk.id, { ...assignment, expectedVersion: 2, ownerUserId: otherRiskOwner.id });
  assert.equal((await db.workflowTask.findUniqueOrThrow({ where: { id: oldAssignmentTask.id } })).status, 'cancelled');
  await assert.rejects(risks.save(riskOwner.id, linkedRisk.id, 3, { title: 'Former owner edit' }));
  await db.user.update({ where: { id: riskOwner.id }, data: { isActive: false } });
  await assert.rejects(risks.assign(triageReviewer.id, linkedRisk.id, { ...assignment, expectedVersion: 3 }));
  await db.user.update({ where: { id: riskOwner.id }, data: { isActive: true } });
  const riskOwnerRole = await db.role.findUniqueOrThrow({ where: { code: 'AI_RISK_OWNER' } });
  const excludedOrg = await db.organizationUnit.create({ data: { code: 'AI-P3A-EXCLUDED', nameEn: 'Other department', nameAr: 'إدارة أخرى' } });
  const restrictedScope = await db.roleDataScope.create({ data: { roleId: riskOwnerRole.id, scopeType: 'org_unit', refId: excludedOrg.id, includeDescendants: false } });
  await assert.rejects(risks.get(riskOwner.id, handedOver.id), /not found/);
  await assert.rejects(risks.assign(triageReviewer.id, linkedRisk.id, { ...assignment, expectedVersion: 3 }), /scope/);
  await db.roleDataScope.delete({ where: { id: restrictedScope.id } });
  const auditor = await createActor('risk-auditor', 'auditor');
  assert.ok((await risks.list(auditor.id)).some(item => item.id === handedOver.id));
  await assert.rejects(risks.save(auditor.id, linkedRisk.id, 3, { title: 'Auditor edit' }));
  const riskApp = await NestFactory.create(AppModule, { logger: false });
  try {
    riskApp.setGlobalPrefix('api');
    riskApp.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await riskApp.listen(0, '127.0.0.1');
    const base = await riskApp.getUrl(), jwt = riskApp.get(JwtService);
    const riskHeaders = { authorization: `Bearer ${jwt.sign({ sub: otherRiskOwner.id, tokenVersion: 0, roles: ['system_admin'] })}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/api/ai/risks`)).status, 401);
    assert.equal((await fetch(`${base}/api/ai/risks`, { headers: riskHeaders })).status, 200);
    assert.equal((await fetch(`${base}/api/ai/risks/${handedOver.id}`, { headers: riskHeaders })).status, 404);
    assert.equal((await fetch(`${base}/api/ai/risks/${linkedRisk.id}/intake`, { method: 'PATCH', headers: riskHeaders,
      body: JSON.stringify({ expectedVersion: 3, input: { inherentScore: 16 } }) })).status, 400);
    assert.equal((await fetch(`${base}/api/ai/risks/${linkedRisk.id}/intake`, { method: 'PATCH', headers: riskHeaders,
      body: JSON.stringify({ expectedVersion: 3, input: {}, injectedOwner: riskOwner.id }) })).status, 400);
    await assert.rejects(riskApp.get(WorkflowService).decideTask(assessmentTask.id, { decision: TaskDecision.approved },
      { id: riskOwner.id, email: riskOwner.email, roles: ['system_admin'] }), /AI Governance actions/);
  } finally { await riskApp.close(); }
  await testPhase3B(db, { riskId: handedOver.id, riskOwnerId: riskOwner.id, useCaseOwnerId: owner.id, otherRiskOwnerId: otherRiskOwner.id,
    privacyId: privacyReviewer.id, securityId: securityReviewer.id, auditorId: auditor.id, officerId: officer.id });
  await testAuthorityStrategy(db,{riskId:handedOver.id,riskOwnerId:riskOwner.id,officerId:officer.id,auditorId:auditor.id});
  await testAiSharedOperational(db,officer.id,riskOwner.id);
  await testAiHistory(db, officer.id, riskOwner.id, handedOver.useCaseId);
  console.log('Phase 2/3A integration passed: AIUC reviews/decisions/asset handoff; scoped risk ownership and reassignment, causal validation, published intake snapshots, audit rollback, exactly-one AIR allocation/assessment task and HTTP authorization.');
}
