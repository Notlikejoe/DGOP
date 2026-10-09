import assert from 'node:assert/strict';
import { aiCapabilities, accessRevision } from '../src/auth/access-snapshot';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
const scope = { orgUnits: 'all' as const, domains: 'all' as const, maxClassRank: null };
const grant = (role: string, code: string) => ({ role: { code: role }, permission: { resource: code.slice(0, code.lastIndexOf('.')), action: code.slice(code.lastIndexOf('.') + 1) } });
async function main() {
  const none = aiCapabilities(['owner'], [], scope);
  assert(!Object.values(none.screens).some(Boolean));
  const own = aiCapabilities(['custom'], [grant('custom', 'case.view.aiuc.own'), grant('custom', 'dashboard.view.aiuc')], scope);
  assert(own.screens.useCases); assert(!own.screens.dashboard); assert.deepEqual(own.permissions, ['case.view.aiuc.own']);
  const officer = aiCapabilities(['AI_GOVERNANCE_OFFICER'], ['case.view.aiuc.org', 'case.view.airs.org', 'dashboard.view.aiuc', 'aiuc.classify.assess'].map(p => grant('AI_GOVERNANCE_OFFICER', p)), scope);
  assert(officer.screens.dashboard && officer.screens.migration && officer.panels.classificationVerification);
  assert(!officer.panels.registration);
  assert(officer.panels.triage && officer.panels.classification && !officer.panels.specialist);
  const specialist = aiCapabilities(['privacy_officer'], [grant('privacy_officer','case.view.aiuc.org')], scope);
  assert(specialist.screens.review && specialist.panels.specialist && !specialist.panels.classification);
  const executive = aiCapabilities(['executive'], [grant('executive','dashboard.view.exec.ai')], scope);
  assert(executive.screens.reviewOperations && !executive.screens.review);
  const partial = aiCapabilities(['AI_GOVERNANCE_OFFICER'], [grant('AI_GOVERNANCE_OFFICER', 'case.view.airs.org')], { ...scope, orgUnits: ['finance'] });
  assert(!partial.screens.migration);
  const adminOnly = aiCapabilities(['system_admin'], [], scope);
  assert(adminOnly.screens.dashboard && !adminOnly.panels.classificationVerification);
  const mixed = aiCapabilities(['auditor', 'AI_GOVERNANCE_OFFICER'], [grant('AI_GOVERNANCE_OFFICER', 'aiuc.classify.assess')], scope);
  assert(!mixed.panels.classificationVerification);
  const revision = accessRevision(['b', 'a'], ['edit', 'read'], { orgUnits: ['2','1'], domains: [], maxClassRank: 2 }, none);
  assert.equal(revision, accessRevision(['a','b'], ['read','edit','read'], { orgUnits: ['1','2'], domains: [], maxClassRank: 2 }, none));
  assert.notEqual(revision, accessRevision(['a','b'], ['read'], { orgUnits: ['1','2'], domains: [], maxClassRank: 2 }, none));
  assert.notEqual(revision, accessRevision(['a','b'], ['edit','read'], { orgUnits: ['1','2'], domains: [], maxClassRank: 3 }, none));
  const service = new AuthService({} as never, { verify: () => ({ sub:'id', tokenVersion:1 }) } as never, {} as never, {} as never, {} as never,
    { $transaction: async () => { throw Error('database unavailable'); } } as never);
  await assert.rejects(service.sessionFromToken('token'), /database unavailable/);
  assert.equal(await service.sessionFromToken(null), null);
  const guard = new JwtAuthGuard({getAllAndOverride:()=>false} as never, {verify:()=>({sub:'id',tokenVersion:1})} as never,
    {user:{findUnique:async()=>{throw Error('database unavailable');}}} as never);
  await assert.rejects(guard.canActivate({getHandler:()=>null,getClass:()=>null,switchToHttp:()=>({getRequest:()=>({headers:{authorization:'Bearer token'}})})} as never), /database unavailable/);
  console.log('PASS access snapshot: eligible AI grants, native panel/report policy, deterministic revisions, transport failure semantics');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
