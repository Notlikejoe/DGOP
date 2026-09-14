// FD §3/§9: new codes are exact; existing roles map to DGOP's installed names.
export const AI_EXISTING_ROLES = {
  DATA_OWNER: 'data_owner', BUSINESS_STEWARD: 'business_steward',
  PRIVACY_STEWARD: 'privacy_officer', SECURITY_STEWARD: 'security_reviewer',
  TECHNICAL_STEWARD: 'technical_steward', AUDITOR: 'auditor',
  EXECUTIVE: 'executive', DMO_ADMIN: 'dmo_admin',
} as const;
export const AI_NEW_ROLES = [
  ['AI_USECASE_OWNER', 'AI Use-Case Owner', 'مالك حالة الاستخدام'],
  ['AI_RISK_OWNER', 'AI Risk Owner', 'مالك الخطر'],
  ['AI_MODEL_OWNER', 'AI Model Owner', 'مالك نموذج الذكاء الاصطناعي'],
  ['AI_MLOPS_LEAD', 'MLOps & Platforms Team', 'فريق عمليات النماذج والمنصات'],
  ['AI_WORKING_GROUP', 'AI Governance Working Group', 'مجموعة عمل حوكمة الذكاء الاصطناعي'],
  ['AI_GOVERNANCE_OFFICER', 'Responsible AI Officer', 'مسؤول حوكمة الذكاء الاصطناعي'],
  ['AI_COMPLIANCE_OFFICER', 'Data & AI Compliance Office', 'مكتب امتثال البيانات والذكاء الاصطناعي'],
  ['AI_ETHICS_COMMITTEE', 'AI Ethics & Risk Review Committee', 'لجنة مراجعة أخلاقيات ومخاطر الذكاء الاصطناعي'],
  ['AI_EXECUTIVE_TEAM', 'Data & AI Executive Team', 'الفريق التنفيذي للبيانات والذكاء الاصطناعي'],
  ['STEERING_COMMITTEE', 'Data & AI Steering Committee', 'اللجنة التوجيهية للبيانات والذكاء الاصطناعي'],
] as const;
const UO='AI_USECASE_OWNER', RO='AI_RISK_OWNER', MO='AI_MODEL_OWNER', ML='AI_MLOPS_LEAD';
const WG='AI_WORKING_GROUP', RAIO='AI_GOVERNANCE_OFFICER', CO='AI_COMPLIANCE_OFFICER';
const EC='AI_ETHICS_COMMITTEE', ET='AI_EXECUTIVE_TEAM', SC='STEERING_COMMITTEE';
const org=[WG,RAIO,CO,'privacy_officer','security_reviewer',EC];
const all=['auditor','dmo_admin',ET,SC];
// "authenticated" is materialized as role grants during explicit catalog sync.
// AUDITOR and EXECUTIVE exceptions override the broad requester wording.
export const AI_PERMISSION_ROLES = {
  'case.create.aiuc': ['authenticated'],
  'case.create.airs': [RO,WG],
  'case.view.aiuc.own': ['authenticated'],
  'case.view.aiuc.org': org,
  'case.view.aiuc.all': all,
  'case.view.airs.own': [UO,RO,MO,ML,'business_steward'],
  'case.view.airs.org': [...org,'technical_steward'],
  'case.view.airs.all': all,
  'case.approve.aiuc': [RAIO,ET,SC],
  'aiuc.asset.register': [WG],
  'aiuc.asset.approve': ['data_owner'],
  'case.approve.airs': [RAIO,SC],
  'aiuc.classify.assess': [WG,RAIO],
  'aiuc.classify.override': [RAIO,ET,SC],
  'aiuc.tier.unacceptable': [RAIO,EC],
  'airs.risk.assess': [RO,MO,ML,'security_reviewer','privacy_officer','technical_steward','business_steward',UO],
  'airs.risk.accept.low': [UO],
  'airs.risk.accept.medium': [UO,RAIO],
  'airs.risk.accept.high': [ET],
  'airs.library.import': ['dmo_admin'],
  'airs.cadence.manage': [WG,RAIO],
  // Purpose-specific decisions; case visibility alone never grants write authority.
  'airs.risk.reverse': [RAIO,EC,ET,SC],
  'airs.strategy.decide': [RAIO,EC,ET,SC],
  'airs.severity.override': [RAIO,EC,ET,SC],
  'refdata.propose.ai': [RAIO],
  'refdata.approve.ai': [EC],
  'refdata.publish': ['dmo_admin'],
  'dashboard.view.aiuc': [WG,RAIO,CO],
  'dashboard.view.airs': [WG,RAIO,CO,RO],
  'dashboard.view.exec.ai': ['executive',ET,SC],
} as const;
export type AiPermission = keyof typeof AI_PERMISSION_ROLES;
export const AI_PERMISSIONS = Object.keys(AI_PERMISSION_ROLES) as AiPermission[];
export function aiRoleMayHold(role: string, permission: AiPermission): boolean {
  if (role === 'executive') return permission === 'dashboard.view.exec.ai';
  if (role === 'auditor') return permission === 'case.view.aiuc.all' || permission === 'case.view.airs.all';
  const roles: readonly string[] = AI_PERMISSION_ROLES[permission];
  return roles.includes(role) || roles.includes('authenticated');
}
export function splitAiPermission(code: AiPermission) {
  const at=code.lastIndexOf('.');
  return {resource:code.slice(0,at),action:code.slice(at+1)};
}
