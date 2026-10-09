import { createHash } from 'node:crypto';
import { EffectiveScope } from '../access/scope.service';
import { AI_PERMISSIONS, AiPermission, aiRoleMayHold } from '../ai-governance/ai-permissions';

export interface AiCapabilities {
  administratorOversight: boolean;
  readMode: 'governance' | 'audit' | 'executive' | 'own' | 'none';
  /** Eligible role grants. Record-specific eligibility and independence remain authoritative. */
  permissions: string[];
  screens: { useCases: boolean; risks: boolean; review: boolean; reviewOperations: boolean; dashboard: boolean; migration: boolean };
  panels: { triage: boolean; classification: boolean; classificationVerification: boolean; specialist: boolean; decision: boolean; registration: boolean };
}

/** Mirrors this version's native read policies without invoking audited authorization denials. */
export function aiCapabilities(roles: string[], grants: { role: { code: string }; permission: { resource: string; action: string } }[], scope: EffectiveScope): AiCapabilities {
  const admin = roles.includes('system_admin'), auditor = roles.includes('auditor');
  const permissions = [...new Set(grants.filter(g => {
    const code = `${g.permission.resource}.${g.permission.action}` as AiPermission;
    return roles.includes(g.role.code) && AI_PERMISSIONS.includes(code) && aiRoleMayHold(g.role.code, code)
      && (code.startsWith('case.view.') || code.startsWith('dashboard.view.') || g.role.code !== 'system_admin' && !auditor);
  }).map(g => `${g.permission.resource}.${g.permission.action}`))].sort();
  if (admin) for (const code of AI_PERMISSIONS) if (code.startsWith('case.view.') || code.startsWith('dashboard.view.')) if (!permissions.includes(code)) permissions.push(code);
  permissions.sort();
  const has = (code: string) => permissions.includes(code);
  const useCases = admin || ['own', 'org', 'all'].some(s => has(`case.view.aiuc.${s}`));
  const risks = admin || ['own', 'org', 'all'].some(s => has(`case.view.airs.${s}`));
  const reportGrant = admin || ['dashboard.view.aiuc', 'dashboard.view.airs', 'dashboard.view.exec.ai', 'case.view.airs.all'].some(has);
  const governance = admin || has('case.view.airs.all') && !has('dashboard.view.exec.ai') || has('dashboard.view.aiuc')
    || has('dashboard.view.airs') && roles.some(r => ['AI_WORKING_GROUP', 'AI_GOVERNANCE_OFFICER', 'AI_COMPLIANCE_OFFICER'].includes(r));
  const executive = !governance && !auditor && has('dashboard.view.exec.ai');
  const report = reportGrant && (executive || risks && (auditor || governance || roles.includes('AI_RISK_OWNER') && has('dashboard.view.airs')));
  const classificationVerification = (admin || has('aiuc.classify.assess')) && roles.includes('AI_GOVERNANCE_OFFICER');
  const classification = admin || has('aiuc.classify.assess');
  const specialist = (admin || has('case.view.aiuc.org')) && roles.some(r => ['privacy_officer','security_reviewer','AI_ETHICS_COMMITTEE'].includes(r));
  const decision = admin || has('case.approve.aiuc');
  const registration = admin || has('aiuc.asset.register') || has('aiuc.asset.approve');
  return {
    administratorOversight: admin,
    readMode: report ? executive ? 'executive' : auditor ? 'audit' : governance ? 'governance' : 'own' : useCases || risks ? 'own' : 'none',
    permissions,
    screens: { useCases, risks, review: classification || specialist || decision || registration,
      reviewOperations: report, dashboard: report,
      migration: risks && (admin || roles.some(r => ['AI_GOVERNANCE_OFFICER', 'dmo_admin', 'auditor'].includes(r)))
        && scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank === null },
    panels: { triage: classification, classification, classificationVerification, specialist, decision, registration },
  };
}

export function accessRevision(roles: string[], permissions: string[], scopes: EffectiveScope, ai: AiCapabilities): string {
  const sorted = (v: string[]) => [...new Set(v)].sort();
  return createHash('sha256').update(JSON.stringify({ roles: sorted(roles), permissions: sorted(permissions),
    scopes: { orgUnits: scopes.orgUnits === 'all' ? 'all' : sorted(scopes.orgUnits),
      domains: scopes.domains === 'all' ? 'all' : sorted(scopes.domains), maxClassRank: scopes.maxClassRank }, ai })).digest('hex');
}
