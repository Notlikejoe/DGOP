import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { BusinessValueService } from '../src/business-value/business-value.service';
import { DataQualityService } from '../src/data-quality/data-quality.service';
import { EvidenceService } from '../src/evidence/evidence.service';
import { ReportsService } from '../src/reports/reports.service';
import { AccessService } from '../src/access/access.service';
import { SecurityGovernanceService } from '../src/security-governance/security-governance.service';
import { ExtendedDomainsService } from '../src/extended-domains/extended-domains.service';
import { PrivacyService } from '../src/privacy/privacy.service';
import { DataSharingService } from '../src/data-sharing/data-sharing.service';
import { FoiService } from '../src/foi/foi.service';
import { OpenDataService } from '../src/open-data/open-data.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { parseMdmRule } from '../src/extended-domains/mdm-rule';
import { evaluateMdmMatch } from '../src/extended-domains/extended-domains.logic';
import { toSimplePdf } from '../src/reports/reports.logic';

/** Real PostgreSQL regressions for the second review's functional findings.
 * Scope is deliberately unrestricted here; cross-scope checks run separately.
 * Barriers force the audited interleaving against actual database writes.
 */
export async function testGovernanceFunctionalStability(db: PrismaClient): Promise<void> {
  const scope: any = { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) };
  const audit = new AuditService(db as any);
  const prefix = 'FST-' + Date.now();
  const makeUser = async (suffix: string) => db.user.create({ data: { email: prefix.toLowerCase() + '-' + suffix + '@example.test', displayName: 'Synthetic functional reviewer', passwordHash: 'test-only-unusable' } });
  const creator = await makeUser('creator'), reviewer = await makeUser('reviewer'), other = await makeUser('other');
  const person = await db.person.create({ data: { email: reviewer.email, userId: reviewer.id, fullNameEn: 'Synthetic reviewer', fullNameAr: 'مراجع تجريبي' } });
  const asset = await db.dataAsset.create({ data: { code: prefix, nameEn: 'Synthetic regression asset', nameAr: 'أصل تجريبي', lifecycleStatus: 'active' } });
  const business = new BusinessValueService(db as any, audit, scope);
  const term = await db.businessGlossaryTerm.create({ data: { code: prefix, termEn: 'Synthetic term', definition: 'Synthetic governance definition', createdBy: creator.email, status: 'under_review', assetId: asset.id } });
  await assert.rejects(() => business.decideGlossaryTerm(['system_admin'], term.id, { status: 'approved' }, creator.email), /creators cannot/);
  await business.decideGlossaryTerm(['dmo_admin'], term.id, { status: 'approved' }, reviewer.email);
  const draft = await db.businessGlossaryTerm.create({ data: { code: prefix + '-DRAFT', termEn: 'Draft term', definition: 'Draft', createdBy: creator.email, assetId: asset.id } });
  await assert.rejects(() => business.decideGlossaryTerm(['dmo_admin'], draft.id, { status: 'approved' }, reviewer.email), /preceding review/);
  const quality = new DataQualityService(db as any, audit, scope);
  const rule: any = await quality.createRule(['system_admin'], { nameEn: 'Synthetic quality rule', nameAr: 'قاعدة تجريبية', assetId: asset.id, definitionJson: { type: 'not_null' } }, creator.email);
  await quality.transitionRule(rule.id, ['system_admin'], 'submit', {}, creator.email);
  await assert.rejects(() => quality.transitionRule(rule.id, ['system_admin'], 'approve', {}, creator.email), /creators cannot/);
  const lifecycle = await db.assetLifecycleDecision.create({ data: { code: prefix, assetId: asset.id, currentStatus: 'active', proposedStatus: 'retired', createdBy: creator.email } });
  await assert.rejects(() => business.decideLifecycle(['dmo_admin'], lifecycle.id, { status: 'implemented' }, reviewer.email), /preceding review/);
  await business.decideLifecycle(['dmo_admin'], lifecycle.id, { status: 'approved' }, reviewer.email);
  const approved = await db.assetLifecycleDecision.findUniqueOrThrow({ where: { id: lifecycle.id } });
  await business.decideLifecycle(['dmo_admin'], lifecycle.id, { status: 'implemented' }, other.email);
  const implemented = await db.assetLifecycleDecision.findUniqueOrThrow({ where: { id: lifecycle.id } });
  assert.equal(implemented.approvedBy, approved.approvedBy);
  assert.equal(implemented.approvedAt?.toISOString(), approved.approvedAt?.toISOString());
  assert.equal((await db.dataAsset.findUniqueOrThrow({ where: { id: asset.id } })).lifecycleStatus, 'retired');

  const ndiDomain = await db.ndiDomain.create({ data: { code: prefix, nameEn: 'Synthetic governance control', nameAr: 'ضابط تجريبي' } });
  const spec = await db.ndiSpecification.create({ data: { code: prefix, domainId: ndiDomain.id, nameEn: 'Synthetic proof', nameAr: 'دليل تجريبي' } });
  process.env.EVIDENCE_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'dgop-functional-proof-'));
  const evidenceService = new EvidenceService(db as any, audit);
  const actor = { id: creator.id, email: creator.email, roles: ['system_admin'] };
  const reviewerActor = { id: reviewer.id, email: reviewer.email, roles: ['dmo_admin'] };
  const failingAudit: any = { log: async () => {}, logRequired: async () => { throw Error('Injected required-audit outage'); } };
  const failingEvidence = new EvidenceService(db as any, failingAudit);
  const bytes = Buffer.from('Synthetic governance proof');
  const upload = { originalname: 'synthetic.txt', mimetype: 'text/plain', size: bytes.length, buffer: bytes };
  const beforeFiles = readdirSync(process.env.EVIDENCE_STORAGE_DIR).length;
  await assert.rejects(() => failingEvidence.create({ specId: spec.id, title: 'Rollback' }, upload, actor), /audit outage/);
  assert.equal(await db.ndiEvidence.count({ where: { specId: spec.id } }), 0);
  assert.equal(readdirSync(process.env.EVIDENCE_STORAGE_DIR).length, beforeFiles);
  const evidence: any = await evidenceService.create({ specId: spec.id, title: 'Concurrent review', submit: 'true' }, upload, actor);
  const barrier = (() => { let count = 0; let release!: () => void; const waiting = new Promise<void>((done) => release = done); return async () => { if (++count === 2) release(); await waiting; }; })();
  const racingDb = new Proxy(db, { get(target: any, key) {
    if (key === 'ndiEvidence') return new Proxy(target.ndiEvidence, { get(model, method) {
      if (method === 'findFirst') return async (args: any) => { const row = await model.findFirst(args); await barrier(); return row; };
      const value = model[method]; return typeof value === 'function' ? value.bind(model) : value;
    } });
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const racingEvidence = new EvidenceService(racingDb as any, audit);
  const decisions = await Promise.allSettled([
    racingEvidence.review(evidence.id, { decision: 'approve', comment: 'Independent approval' }, reviewerActor),
    racingEvidence.review(evidence.id, { decision: 'reject', comment: 'Independent rejection' }, { id: other.id, email: other.email, roles: ['dmo_admin'] }),
  ]);
  assert.equal(decisions.filter((result) => result.status === 'fulfilled').length, 1);
  const conflict: any = decisions.find((result) => result.status === 'rejected');
  assert.equal(conflict.reason.getStatus(), 409);
  assert.equal(await db.auditLog.count({ where: { entityId: evidence.id, action: { in: ['evidence.approve', 'evidence.reject'] } } }), 1);
  const statusBefore = (await db.ndiEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).status;
  await assert.rejects(() => failingEvidence.remove(evidence.id, actor), /audit outage/);
  assert.equal((await db.ndiEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).deletedAt, null);
  await evidenceService.remove(evidence.id, actor);
  assert.ok(existsSync(join(process.env.EVIDENCE_STORAGE_DIR, evidence.fileName)));
  assert.equal((await db.ndiEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).status, statusBefore);
  const expired = await db.ndiEvidence.create({ data: { specId: spec.id, title: 'Expired synthetic proof', status: 'approved', provenance: 'seeded_uat', expiryDate: new Date(0), fileName: 'synthetic.txt', originalName: 'synthetic.txt', mimeType: 'text/plain', sizeBytes: 1, sha256: 'synthetic', submittedBy: creator.email } });
  const reports = new ReportsService(db as any, scope, { permissionsForRoleCodes: async () => ['*'], hasPermission: () => true } as any);
  assert.equal((await reports.run(actor, 'ndi-readiness', { domainId: ndiDomain.id })).rows[0].readiness, 0);
  await db.ndiEvidence.update({ where: { id: expired.id }, data: { provenance: 'operational', expiryDate: new Date(Date.now() + 86400000) } });
  assert.equal((await reports.run(actor, 'ndi-readiness', { domainId: ndiDomain.id })).rows[0].readiness, 100);

  const grant = await db.accessGrant.create({ data: { code: prefix, assetId: asset.id, principalId: reviewer.id, permissionCode: 'read', status: 'active', enforcementStatus: 'enforced', justification: 'Synthetic business need', createdBy: creator.email, expiresAt: new Date(Date.now() + 30 * 86400000) } });
  const role = await db.role.upsert({ where: { code: 'functional_reviewer' }, update: {}, create: { code: 'functional_reviewer', nameEn: 'Synthetic review role', nameAr: 'دور تجريبي' } });
  const review = await db.accessReview.create({ data: { code: prefix, title: 'Synthetic access campaign', status: 'active', ownerUserId: creator.id, createdBy: creator.email } });
  const item = await db.accessReviewItem.create({ data: { reviewId: review.id, userId: reviewer.id, roleId: role.id, assetId: asset.id, grantId: grant.id } });
  const newerExpiry = new Date(Date.now() + 86400000);
  const racingGrantDb = new Proxy(db, { get(target: any, key) {
    if (key === '$transaction') return (callback: any) => target.$transaction((tx: any) => callback(new Proxy(tx, { get(client, member) {
      if (member === 'accessReviewItem') return new Proxy(client.accessReviewItem, { get(model, method) {
        if (method === 'update') return async (args: any) => { await db.accessGrant.update({ where: { id: grant.id }, data: { expiresAt: newerExpiry, version: { increment: 1 } } }); return model.update(args); };
        const value = model[method]; return typeof value === 'function' ? value.bind(model) : value;
      } });
      const value = client[member]; return typeof value === 'function' ? value.bind(client) : value;
    } })));
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(() => new SecurityGovernanceService(racingGrantDb as any, audit, scope).updateReviewItem(item.id, ['system_admin'], { decision: 'shorten_expiry', newExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), justification: 'Synthetic stale review' }, creator.email), (error: any) => error.getStatus() === 409);
  assert.equal((await db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).expiresAt?.toISOString(), newerExpiry.toISOString());
  assert.equal((await db.accessReviewItem.findUniqueOrThrow({ where: { id: item.id } })).decision, 'pending');
  assert.equal(await db.auditLog.count({ where: { action: 'access_review_item.decide', entityId: item.id } }), 0);

  const extended = new ExtendedDomainsService(db as any, audit, scope);
  const reference = await db.referenceDataVersion.create({ data: { code: prefix, name: 'Synthetic reference', version: '1', assetId: asset.id, createdBy: creator.email } });
  await assert.rejects(() => extended.decideReferenceVersion(['dmo_admin'], reference.id, { decision: 'activate' }, reviewer.email), /preceding review/);
  await extended.decideReferenceVersion(['dmo_admin'], reference.id, { decision: 'submit' }, creator.email);
  await extended.decideReferenceVersion(['dmo_admin'], reference.id, { decision: 'approve' }, reviewer.email);
  await extended.decideReferenceVersion(['dmo_admin'], reference.id, { decision: 'activate' }, other.email);
  assert.equal((await db.referenceDataVersion.findUniqueOrThrow({ where: { id: reference.id } })).approvedBy, reviewer.email);
  const certification = await db.metadataCertification.create({ data: { code: prefix, assetId: asset.id, createdBy: creator.email } });
  await assert.rejects(() => extended.saveCertification(['system_admin'], certification.id, { status: 'certified' }, reviewer.email), /required certification checks/);
  await assert.rejects(() => extended.saveCertification(['dq_steward'], certification.id, { status: 'certified', qualityScore: 100, completenessScore: 100, ownerConfirmed: true, glossaryAligned: true, lineageReviewed: true }, reviewer.email), /current operational proof/);
  const parsed = parseMdmRule({ sameFields: ['domainId'] }, { name: 100 }, { strategy: 'candidate' });
  assert.throws(() => parseMdmRule({ unsupported: true }, {}, null), /Supported blocking/);
  const profile = { id: 'a', code: 'A', nameEn: 'Synthetic identical name', domainId: 'one' };
  assert.equal(evaluateMdmMatch(profile, { ...profile, id: 'b', domainId: 'two' }, parsed), null);
  const scored = evaluateMdmMatch(profile, { ...profile, id: 'b', code: 'B' }, parsed)!;
  assert.equal(scored.matchScore, 100);
  assert.equal((scored.proposedGoldenRecordJson.fields as any).code, 'B');
  const mdmSource = await db.dataAsset.create({ data: { code: prefix + '-MDM-S', nameEn: 'Same synthetic dataset', nameAr: 'مجموعة بيانات تجريبية' } });
  const mdmCandidate = await db.dataAsset.create({ data: { code: prefix + '-MDM-C', nameEn: 'Same synthetic dataset', nameAr: 'مجموعة بيانات تجريبية' } });
  const savedRule = await db.mdmMatchRule.create({ data: { code: prefix, name: 'Synthetic persisted match control', blockingJson: {}, weightsJson: { name: 100 }, survivorshipJson: { strategy: 'candidate' }, thresholdScore: 90, createdBy: creator.email } });
  const options = { sourceAssetId: mdmSource.id, candidateAssetIds: [mdmCandidate.id], ruleCode: savedRule.code, persist: false };
  const matching: any = await extended.runMdmMatching(['system_admin'], options, reviewer.email);
  assert.equal(matching.rule.id, savedRule.id);
  assert.equal(matching.threshold, 90);
  assert.equal(matching.candidates.length, 1);
  assert.equal(matching.candidates[0].matchScore, 100);
  assert.equal(matching.candidates[0].proposedGoldenRecordJson.fields.code, mdmCandidate.code);
  await db.mdmMatchRule.update({ where: { id: savedRule.id }, data: { weightsJson: { code: 100 } } });
  const different: any = await extended.runMdmMatching(['system_admin'], options, reviewer.email);
  assert.notEqual(different.rule.digest, matching.rule.digest);
  assert.equal(different.candidates.length, 0, 'Editing the persisted rule must materially change matching');
  await assert.rejects(() => extended.runMdmMatching(['system_admin'], { ...options, threshold: 1 }, reviewer.email), /saved rule owns/);

  const failingExtended = new ExtendedDomainsService(db as any, failingAudit, scope);
  const newRuleCode = prefix + '-ROLLBACK-RULE';
  await assert.rejects(() => failingExtended.upsertMdmMatchRule(['system_admin'], { code: newRuleCode, name: 'Rollback rule', blockingJson: {}, weightsJson: { name: 100 } }, reviewer.email), /audit outage/);
  assert.equal(await db.mdmMatchRule.count({ where: { code: newRuleCode } }), 0);
  const ruleBefore = await db.mdmMatchRule.findUniqueOrThrow({ where: { id: savedRule.id } });
  await assert.rejects(() => failingExtended.upsertMdmMatchRule(['system_admin'], { code: savedRule.code, name: 'Uncommitted amendment', blockingJson: {}, weightsJson: { name: 100 } }, reviewer.email), /audit outage/);
  assert.equal((await db.mdmMatchRule.findUniqueOrThrow({ where: { id: savedRule.id } })).updatedAt.toISOString(), ruleBefore.updatedAt.toISOString());
  await db.mdmMatchRule.update({ where: { id: savedRule.id }, data: { weightsJson: { name: 100 } } });
  await assert.rejects(() => failingExtended.runMdmMatching(['system_admin'], { ...options, persist: true }, reviewer.email), /audit outage/);
  assert.equal(await db.mdmMatchCandidate.count({ where: { sourceAssetId: mdmSource.id, candidateAssetId: mdmCandidate.id } }), 0);
  const persistedMatching = await extended.runMdmMatching(['system_admin'], { ...options, persist: true }, creator.email);
  assert.equal(persistedMatching.createdCount, 1);
  const match: any = persistedMatching.candidates[0];
  await db.mdmMatchCandidate.update({ where: { id: match.id }, data: { status: 'under_review' } });
  const decisionBarrier = (() => { let count = 0; let release!: () => void; const waiting = new Promise<void>((done) => release = done); return async () => { if (++count === 2) release(); await waiting; }; })();
  const racingMatchDb = new Proxy(db, { get(target: any, key) {
    if (key === 'mdmMatchCandidate') return new Proxy(target.mdmMatchCandidate, { get(model, method) {
      if (method === 'findFirst') return async (args: any) => { const value = await model.findFirst(args); await decisionBarrier(); return value; };
      const value = model[method]; return typeof value === 'function' ? value.bind(model) : value;
    } });
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const racingMatchService = new ExtendedDomainsService(racingMatchDb as any, audit, scope);
  const resolutions = await Promise.allSettled([
    racingMatchService.resolveMatch(['dq_steward'], match.id, { status: 'rejected', resolutionNote: 'Independent synthetic rejection' }, reviewer.email),
    racingMatchService.resolveMatch(['dq_steward'], match.id, { status: 'superseded', resolutionNote: 'Competing synthetic disposition' }, other.email),
  ]);
  assert.equal(resolutions.filter((result) => result.status === 'fulfilled').length, 1);
  const rejectedResolution = resolutions.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejectedResolution.reason.getStatus(), 409);
  assert.equal(await db.mdmMergeSplitEvent.count({ where: { matchCandidateId: match.id } }), 1);
  assert.equal(await db.auditLog.count({ where: { action: 'extended_domains.mdm_match.resolve', entityId: match.id } }), 1);
  await assert.rejects(() => extended.resolveMatch(['dq_steward'], match.id, { status: 'merged', resolutionNote: 'Replay must not overwrite the final decision' }, other.email), (error: any) => error.getStatus() === 409);
  await assert.rejects(() => new BusinessValueService(db as any, failingAudit, scope).createLineage(['system_admin'], { sourceAssetId: mdmSource.id, targetAssetId: mdmCandidate.id, processName: 'Uncommitted lineage' }, creator.email), /audit outage/);
  assert.equal(await db.businessLineageMap.count({ where: { sourceAssetId: mdmSource.id, targetAssetId: mdmCandidate.id } }), 0);

  const integrations = new IntegrationsService(db as any, audit, scope);
  const queued = await db.integrationEvent.create({ data: { code: prefix, dedupeKey: prefix, adapterType: 'webhook_json', eventType: 'synthetic.received', payloadJson: {}, maxAttempts: 3 } });
  await Promise.all([(integrations as any).processIntegrationEvent(queued.id, reviewer.email), (integrations as any).processIntegrationEvent(queued.id, other.email)]);
  assert.equal((await db.integrationEvent.findUniqueOrThrow({ where: { id: queued.id } })).attempts, 1);
  assert.equal(await db.integrationReconciliationReport.count({ where: { eventId: queued.id } }), 1);
  const rolledBack = await db.integrationEvent.create({ data: { code: prefix + '-ROLLBACK', dedupeKey: prefix + '-ROLLBACK', adapterType: 'webhook_json', eventType: 'synthetic.received', payloadJson: {} } });
  await assert.rejects(() => (new IntegrationsService(db as any, failingAudit, scope) as any).processIntegrationEvent(rolledBack.id, reviewer.email), /audit outage/);
  assert.equal((await db.integrationEvent.findUniqueOrThrow({ where: { id: rolledBack.id } })).attempts, 0);
  assert.equal(await db.integrationReconciliationReport.count({ where: { eventId: rolledBack.id } }), 0);
  await integrations.retryEvent(['system_admin'], rolledBack.id, { reason: 'Recover interrupted queued processing' }, reviewer.email);
  assert.equal((await db.integrationEvent.findUniqueOrThrow({ where: { id: rolledBack.id } })).status, 'succeeded');
  const invalid = await db.integrationEvent.create({ data: { code: prefix + '-INVALID', dedupeKey: prefix + '-INVALID', adapterType: 'mock_data_quality', eventType: 'dq.issue.detected', payloadJson: {}, maxAttempts: 10 } });
  for (let index = 0; index < 4; index++) await integrations.retryEvent(['system_admin'], invalid.id, { reason: 'Synthetic bounded recovery check' }, reviewer.email);
  const exhausted = await db.integrationEvent.findUniqueOrThrow({ where: { id: invalid.id } });
  assert.equal(exhausted.attempts, 3);
  assert.equal(exhausted.status, 'dead_letter');

  const sharing = new DataSharingService(db as any, audit, scope);
  const sharingRequest = await db.dataSharingRequest.create({ data: { requestNumber: prefix, requesterOrg: 'Synthetic requester', recipientOrg: 'Approved recipient', purpose: 'Approved purpose', status: 'approved', assetId: asset.id, createdBy: creator.email } });
  await assert.rejects(() => sharing.saveReview(['system_admin'], sharingRequest.id, { step: 'owner', decision: 'approved' }, creator.email), /creators cannot/);
  await assert.rejects(() => sharing.createAgreement(['system_admin'], { requestId: sharingRequest.id, recipientOrg: 'Different recipient', purpose: 'Approved purpose' }, reviewer.email), /terms must match/);
  await assert.rejects(() => sharing.createAgreement(['system_admin'], { recipientOrg: 'Recipient', purpose: 'Purpose', status: 'active' }, reviewer.email), /approved request/);
  const agreement = await sharing.createAgreement(['system_admin'], { requestId: sharingRequest.id, recipientOrg: sharingRequest.recipientOrg, purpose: sharingRequest.purpose }, reviewer.email);
  assert.equal(agreement.status, 'active');
  assert.equal(agreement.assetId, asset.id);
  const agreementBefore = await db.dataSharingAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
  await assert.rejects(() => new DataSharingService(db as any, failingAudit, scope).updateAgreement(['system_admin'], agreement.id, { agreementUrl: 'https://example.test/uncommitted-proof' }, reviewer.email), /audit outage/);
  const agreementAfter = await db.dataSharingAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
  assert.equal(agreementAfter.agreementUrl, agreementBefore.agreementUrl);
  assert.equal(agreementAfter.updatedAt.toISOString(), agreementBefore.updatedAt.toISOString());

  const foi = new FoiService(db as any, audit, scope);
  const foiRequest = await db.foiRequest.create({ data: { requestNumber: prefix, requesterName: 'Synthetic requester', requesterEmail: 'requester@example.test', subject: 'Synthetic FOI request', description: 'Synthetic request details', dueAt: new Date(Date.now() + 86400000), identityValidated: true, contactValidated: true, assignedOfficerPersonId: person.id, createdBy: creator.email } });
  await assert.rejects(() => foi.update(['system_admin'], foiRequest.id, { status: 'approved' }, creator.email), /status is controlled/);
  await assert.rejects(() => foi.saveDecision(['foi_officer'], foiRequest.id, { outcome: 'approved', summary: 'Release', justification: 'Public' }, reviewer.email), /Complete classification/);
  await db.foiRequest.update({ where: { id: foiRequest.id }, data: { status: 'approved' } });
  await assert.rejects(() => foi.createDisclosure(['foi_officer'], foiRequest.id, { recipient: 'requester@example.test', summary: 'Release proof' }, reviewer.email), /latest recorded approval/);

  const privacyPermission = await db.permission.upsert({ where: { resource_action: { resource: 'privacy_operations', action: 'edit' } }, update: {}, create: { resource: 'privacy_operations', action: 'edit', descriptionEn: 'Privacy edit', descriptionAr: 'تعديل الخصوصية' } });
  const privacyRole = await db.role.upsert({ where: { code: 'privacy_officer' }, update: { isActive: true, deletedAt: null }, create: { code: 'privacy_officer', nameEn: 'Privacy officer', nameAr: 'مسؤول الخصوصية' } });
  await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: privacyRole.id, permissionId: privacyPermission.id } }, update: {}, create: { roleId: privacyRole.id, permissionId: privacyPermission.id } });
  const dpia = await db.privacyDpia.create({ data: { code: prefix, title: 'Synthetic DPIA', assetId: asset.id, reviewerPersonId: person.id, riskLevel: 'high', residualRiskScore: 75, createdBy: creator.email, gates: { create: [{ phase: 'requirements', reviewerPersonId: person.id, createdBy: creator.email }] } } });
  const privacy = new PrivacyService(db as any, audit, scope);
  await assert.rejects(() => privacy.saveGate(['privacy_officer'], dpia.id, { phase: 'requirements', status: 'approved', note: 'Control assessment' }, other.email), /currently assigned/);
  await assert.rejects(() => privacy.saveGate(['privacy_officer'], dpia.id, { phase: 'requirements', status: 'not_required' }, reviewer.email), /documented control/);
  await privacy.saveGate(['privacy_officer'], dpia.id, { phase: 'requirements', status: 'approved', note: 'Synthetic control assessment and proof reference' }, reviewer.email);
  assert.equal((await db.privacyDpia.findUniqueOrThrow({ where: { id: dpia.id } })).status, 'under_review', 'All five gate outcomes are required');
  await assert.rejects(() => privacy.saveGate(['privacy_officer'], dpia.id, { phase: 'requirements', reviewerPersonId: person.id }, reviewer.email), /immutable/);
  assert.equal((await db.privacyGate.findUniqueOrThrow({ where: { dpiaId_phase: { dpiaId: dpia.id, phase: 'requirements' } } })).reviewerPersonId, person.id);
  const updatedDpia = await privacy.updateDpia(['privacy_officer'], dpia.id, { residualRiskScore: 10, decisionSummary: 'Synthetic verified mitigation justification' }, reviewer.email);
  assert.equal(updatedDpia.gates[0].status, 'pending', 'The response must expose the reset review state');
  assert.equal((await db.privacyDpia.findUniqueOrThrow({ where: { id: dpia.id } })).riskLevel, 'low');

  const open = new OpenDataService(db as any, audit, scope);
  await db.ndiSpecification.upsert({ where: { code: 'OD.1.1' }, update: {}, create: { code: 'OD.1.1', domainId: ndiDomain.id, nameEn: 'Open Data proof', nameAr: 'دليل البيانات المفتوحة' } });
  const openCandidate: any = await db.openDataCandidate.create({ data: { code: prefix, titleEn: 'Synthetic open dataset', titleAr: 'بيانات تجريبية', assetId: asset.id, status: 'approved', eligibilityScore: 100, eligibilityJson: { overallSignal: 'ready', classificationRank: 1 }, createdBy: creator.email }, include: { asset: { include: { classification: true } } } });
  const generatedId: string = await db.$transaction((tx) => (open as any).createOpenDataSystemEvidence(tx, openCandidate, reviewer.email, 'publication', { syncStatus: 'simulated' }));
  assert.equal((await db.ndiEvidence.findUniqueOrThrow({ where: { id: generatedId } })).provenance, 'generated_simulation');
  await assert.rejects(() => (open as any).assertApprovalAuthority(['system_admin'], openCandidate, { step: 'odiao' }, creator.email), /own Open Data/);
  await assert.rejects(() => open.publish(['system_admin'], openCandidate.id, {}, reviewer.email), /eligibility must be ready/);

  // Verify complete population and the actual PDF container past the old limits.
  const reportAssets = await db.dataAsset.createManyAndReturn({ data: Array.from({ length: 501 }, (_, index) => ({ code: prefix + '-R' + index, nameEn: 'Synthetic report asset', nameAr: 'أصل التقرير' })), select: { id: true } });
  await db.openDataCandidate.createMany({ data: reportAssets.map((row, index) => ({ code: prefix + '-R' + index, titleEn: 'Synthetic report row ' + index, titleAr: 'صف تجريبي', assetId: row.id, createdBy: creator.email })) });
  const report = await reports.run(actor, 'open-data-workload');
  assert.ok(report.rows.length >= 502);
  assert.equal(report.summary.total, report.rows.length);
  const pdf = await toSimplePdf({ id: 'regression', title: 'Complete EN/AR report', generatedAt: new Date().toISOString(), summary: { total: 51 }, columns: [{ key: 'marker', label: 'Marker' }], rows: Array.from({ length: 51 }, (_, index) => ({ marker: 'SYNTHETIC_ROW_' + index + ' صف تجريبي' })) });
  assert.ok(pdf.toString('latin1').includes('SYNTHETIC_ROW_50'));
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length > 1);
  assert.ok(pdf.toString('latin1').includes('/ToUnicode'));
  assert.ok(!pdf.toString('latin1').includes(' <> '), 'Font decoration glyphs must not create invalid Unicode maps');
  assert.ok(pdf.toString('latin1').includes('/ActualText'), 'Accessible text preserves logical EN/AR values');
  console.log('Functional governance regressions passed: independent decisions, required state sequence, approval lineage, atomic audit rollback, real concurrent conflicts, retained proof, current operational credit, sharing terms, FOI prerequisites, DPIA assignment/risk consistency, simulated provenance, saved MDM controls and 501+ row/multi-page exports.');
}
