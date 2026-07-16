export type WorkflowStageSeed = {
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string;
  kind: string;
  taskType: string;
  assigneeRoleCode?: string;
  dueDays: number;
  isStart?: boolean;
  isDecision?: boolean;
  isFinal?: boolean;
};

export type WorkflowTransitionSeed = {
  from: string;
  to: string;
  labelEn: string;
  labelAr: string;
  decision?: string;
  isHappyPath?: boolean;
};

export type WorkflowTemplateSeed = {
  code: string;
  caseType: string;
  trigger: string;
  nameEn: string;
  nameAr: string;
  description: string;
  defaultSlaDays: number;
  stages: WorkflowStageSeed[];
  transitions: WorkflowTransitionSeed[];
};

export type WorkflowRouteInput = {
  caseType?: string | null;
  domainId?: string | null;
  templateId?: string | null;
};

export type WorkflowRouteCandidate = {
  id: string;
  code: string;
  caseType: string;
  domainId?: string | null;
  isActive: boolean;
};

export type WorkflowStageRouteNode = {
  id: string;
  sortOrder: number;
  dueDays: number;
  isStart: boolean;
  isFinal: boolean;
  isActive: boolean;
  assigneeRoleCode?: string | null;
};

export type WorkflowTransitionRouteEdge = {
  id?: string;
  fromStageId: string;
  toStageId: string;
  decision?: string | null;
  isHappyPath: boolean;
  sortOrder: number;
  toStage?: { id: string; code?: string | null } | null;
};

export const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplateSeed[] = [
  {
    code: 'WF-GEN-GOV-REVIEW',
    caseType: 'general',
    trigger: 'manual',
    nameEn: 'Governance review route',
    nameAr: 'مسار مراجعة الحوكمة',
    description: 'General intake, review, decision, and closure route for governance work.',
    defaultSlaDays: 5,
    stages: [
      stage('intake', 'Intake', 'استلام', 'Capture the request and linked data context.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('review', 'Review', 'مراجعة', 'Steward reviews the impact and evidence needed.', 'review', 'review', 'data_steward', 3),
      stage('decision', 'Decision', 'قرار', 'Decision owner approves, rejects, or asks for more information.', 'decision', 'approval', 'data_owner', 2, { isDecision: true }),
      stage('closure', 'Closure', 'إغلاق', 'Close the loop and leave an auditable decision trail.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('intake', 'review', 'Ready for review', 'جاهز للمراجعة'),
      link('review', 'decision', 'Ready for decision', 'جاهز للقرار'),
      link('decision', 'closure', 'Decision recorded', 'تم تسجيل القرار', 'approved'),
      link('decision', 'review', 'More information', 'معلومات إضافية', 'rejected', false),
    ],
  },
  {
    code: 'WF-OWN-APPROVAL',
    caseType: 'owner_assignment_approval',
    trigger: 'owner_assignment',
    nameEn: 'Ownership approval route',
    nameAr: 'مسار اعتماد الملكية',
    description: 'Routes owner changes through steward review, decision, and asset update.',
    defaultSlaDays: 4,
    stages: [
      stage('proposal', 'Assignment proposal', 'اقتراح الإسناد', 'Confirm the proposed owner and affected asset.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('steward-check', 'Steward check', 'تحقق الأمين', 'Check conflicts, active windows, and accountability coverage.', 'review', 'review', 'data_steward', 2),
      stage('owner-decision', 'Owner decision', 'قرار المالك', 'Approve or reject the proposed accountable owner.', 'approval', 'approval', 'data_owner', 2, { isDecision: true }),
      stage('asset-sync', 'Asset accountability update', 'تحديث مساءلة الأصل', 'Apply the approved owner and update the case trail.', 'implementation', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('proposal', 'steward-check', 'Check proposal', 'تحقق من الاقتراح'),
      link('steward-check', 'owner-decision', 'Ready for approval', 'جاهز للاعتماد'),
      link('owner-decision', 'asset-sync', 'Approved', 'معتمد', 'approved'),
      link('owner-decision', 'steward-check', 'Needs correction', 'يحتاج تصحيحاً', 'rejected', false),
    ],
  },
  {
    code: 'WF-STW-APPROVAL',
    caseType: 'steward_assignment_approval',
    trigger: 'steward_assignment',
    nameEn: 'Stewardship approval route',
    nameAr: 'مسار اعتماد الأمانة',
    description: 'Routes steward changes through responsibility review and decision.',
    defaultSlaDays: 4,
    stages: [
      stage('proposal', 'Steward proposal', 'اقتراح الأمين', 'Confirm who will act on quality, policy, and issue work.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('coverage-check', 'Coverage check', 'تحقق التغطية', 'Review role fit, gaps, and affected domains.', 'review', 'review', 'data_owner', 2),
      stage('approval', 'Approval decision', 'قرار الاعتماد', 'Approve or reject the steward assignment.', 'approval', 'approval', 'dmo_admin', 2, { isDecision: true }),
      stage('activation', 'Activation', 'تفعيل', 'Activate the assignment and update the operating record.', 'implementation', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('proposal', 'coverage-check', 'Check coverage', 'تحقق من التغطية'),
      link('coverage-check', 'approval', 'Ready for decision', 'جاهز للقرار'),
      link('approval', 'activation', 'Approved', 'معتمد', 'approved'),
      link('approval', 'coverage-check', 'Revise assignment', 'تعديل الإسناد', 'rejected', false),
    ],
  },
  {
    code: 'WF-DQ-REMEDIATION',
    caseType: 'data_quality_issue',
    trigger: 'data_quality_issue',
    nameEn: 'Quality remediation route',
    nameAr: 'مسار معالجة الجودة',
    description: 'Turns quality issues into triage, root cause, remediation, validation, and closure.',
    defaultSlaDays: 7,
    stages: [
      stage('issue-intake', 'Issue intake', 'استلام المشكلة', 'Register severity, asset, owner, and SLA.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('triage', 'Triage', 'فرز', 'Prioritize impact and confirm accountable steward.', 'triage', 'review', 'dq_steward', 1),
      stage('rca', 'Root cause', 'سبب جذري', 'Record why the quality issue happened.', 'analysis', 'review', 'dq_steward', 2),
      stage('remediate', 'Remediate', 'معالجة', 'Fix the issue and provide evidence.', 'implementation', 'review', 'data_steward', 3),
      stage('validate', 'Validate', 'تحقق', 'Confirm the quality signal is acceptable.', 'validation', 'approval', 'data_owner', 1, { isDecision: true }),
      stage('close', 'Close', 'إغلاق', 'Close the case and keep the evidence trail.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('issue-intake', 'triage', 'Triage issue', 'فرز المشكلة'),
      link('triage', 'rca', 'Analyze cause', 'تحليل السبب'),
      link('rca', 'remediate', 'Fix issue', 'معالجة المشكلة'),
      link('remediate', 'validate', 'Validate fix', 'تحقق من المعالجة'),
      link('validate', 'close', 'Accepted', 'مقبول', 'approved'),
      link('validate', 'remediate', 'Needs more work', 'يحتاج عملاً إضافياً', 'rejected', false),
    ],
  },
  {
    code: 'WF-DLP-INCIDENT',
    caseType: 'dlp_incident',
    trigger: 'dlp_incident',
    nameEn: 'Protection incident route',
    nameAr: 'مسار حادثة الحماية',
    description: 'Routes DLP incidents from detection through containment and closure.',
    defaultSlaDays: 3,
    stages: [
      stage('detect', 'Detect', 'اكتشاف', 'Capture incident source, asset, and severity.', 'intake', 'information', undefined, 0, { isStart: true }),
      stage('contain', 'Contain', 'احتواء', 'Reduce exposure and assign the incident owner.', 'implementation', 'review', 'security_reviewer', 1),
      stage('review', 'Risk review', 'مراجعة المخاطر', 'Review classification, personal data, and policy impact.', 'review', 'review', 'security_reviewer', 1),
      stage('decision', 'Decision', 'قرار', 'Decide whether to close, escalate, or mark false positive.', 'decision', 'approval', 'dmo_admin', 1, { isDecision: true }),
      stage('close', 'Closure evidence', 'دليل الإغلاق', 'Record containment summary and close the case.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('detect', 'contain', 'Contain now', 'احتواء الآن'),
      link('contain', 'review', 'Review risk', 'مراجعة المخاطر'),
      link('review', 'decision', 'Decision needed', 'يحتاج قراراً'),
      link('decision', 'close', 'Close incident', 'إغلاق الحادثة', 'approved'),
      link('decision', 'contain', 'Escalate containment', 'تصعيد الاحتواء', 'rejected', false),
    ],
  },
  {
    code: 'WF-CLS-CHANGE',
    caseType: 'classification_change_request',
    trigger: 'classification_change',
    nameEn: 'Classification change route',
    nameAr: 'مسار تغيير التصنيف',
    description: 'Routes classification changes through impact review and controlled implementation.',
    defaultSlaDays: 5,
    stages: [
      stage('request', 'Change request', 'طلب تغيير', 'Capture requested classification and reason.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('impact', 'Impact review', 'مراجعة الأثر', 'Check access, masking, open data, and evidence impact.', 'review', 'review', 'security_reviewer', 2),
      stage('decision', 'Classification decision', 'قرار التصنيف', 'Approve or reject the new classification.', 'approval', 'approval', 'dmo_admin', 2, { isDecision: true }),
      stage('implement', 'Implement change', 'تنفيذ التغيير', 'Apply classification and notify affected operations.', 'implementation', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('request', 'impact', 'Review impact', 'مراجعة الأثر'),
      link('impact', 'decision', 'Ready for decision', 'جاهز للقرار'),
      link('decision', 'implement', 'Approved', 'معتمد', 'approved'),
      link('decision', 'impact', 'Needs reassessment', 'يحتاج إعادة تقييم', 'rejected', false),
    ],
  },
  {
    code: 'WF-FOI-REQUEST',
    caseType: 'foi_request',
    trigger: 'foi_request',
    nameEn: 'FOI request route',
    nameAr: 'مسار طلب حرية المعلومات',
    description: 'Routes FOI requests through intake, legal/privacy review, decision, disclosure, and closure.',
    defaultSlaDays: 20,
    stages: [
      stage('intake', 'Intake validation', 'تحقق الاستلام', 'Validate identity, contact details, channel, and request scope.', 'intake', 'information', 'foi_officer', 1, { isStart: true }),
      stage('classification', 'Classification and exemption review', 'مراجعة التصنيف والاستثناءات', 'Check information classification, exemptions, privacy, and legal risk.', 'review', 'review', 'privacy_officer', 5),
      stage('decision', 'Disclosure decision', 'قرار الإفصاح', 'Approve, partially approve, reject, or extend the request with justification.', 'decision', 'approval', 'foi_officer', 3, { isDecision: true }),
      stage('disclosure', 'Response and disclosure', 'الرد والإفصاح', 'Prepare the response package and record release evidence.', 'implementation', 'review', 'foi_officer', 3),
      stage('closure', 'Closure and evidence', 'الإغلاق والأدلة', 'Close the request with audit-ready evidence and appeal readiness.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('intake', 'classification', 'Ready for review', 'جاهز للمراجعة'),
      link('classification', 'decision', 'Ready for decision', 'جاهز للقرار'),
      link('decision', 'disclosure', 'Disclose response', 'الإفصاح عن الرد', 'approved'),
      link('decision', 'closure', 'No disclosure', 'لا يوجد إفصاح', 'rejected', false),
      link('disclosure', 'closure', 'Disclosure complete', 'اكتمل الإفصاح'),
    ],
  },
  {
    code: 'WF-FOI-APPEAL',
    caseType: 'foi_appeal',
    trigger: 'foi_appeal',
    nameEn: 'FOI appeal route',
    nameAr: 'مسار تظلم حرية المعلومات',
    description: 'Routes FOI appeals through independent review, decision, and closure.',
    defaultSlaDays: 10,
    stages: [
      stage('appeal-intake', 'Appeal intake', 'استلام التظلم', 'Capture appeal reason and link it to the original request.', 'intake', 'information', 'foi_officer', 1, { isStart: true }),
      stage('independent-review', 'Independent review', 'مراجعة مستقلة', 'Review original decision, exemption evidence, and disclosure package.', 'review', 'review', 'dmo_admin', 5),
      stage('appeal-decision', 'Appeal decision', 'قرار التظلم', 'Uphold or overturn the original FOI decision with rationale.', 'decision', 'approval', 'dmo_admin', 2, { isDecision: true }),
      stage('appeal-closure', 'Appeal closure', 'إغلاق التظلم', 'Close appeal and update the request record.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('appeal-intake', 'independent-review', 'Review appeal', 'مراجعة التظلم'),
      link('independent-review', 'appeal-decision', 'Ready for decision', 'جاهز للقرار'),
      link('appeal-decision', 'appeal-closure', 'Decision recorded', 'تم تسجيل القرار', 'approved'),
      link('appeal-decision', 'independent-review', 'Needs more review', 'يحتاج مراجعة إضافية', 'rejected', false),
    ],
  },
  {
    code: 'WF-PDP-DPIA',
    caseType: 'privacy_dpia',
    trigger: 'privacy_dpia',
    nameEn: 'DPIA and privacy-by-design route',
    nameAr: 'مسار تقييم أثر الخصوصية',
    description: 'Routes DPIA work through requirements, design, development, testing, deployment gates, and DPO decision.',
    defaultSlaDays: 10,
    stages: [
      stage('requirements', 'Requirements gate', 'بوابة المتطلبات', 'Confirm purpose, lawful basis, data subjects, and minimum data needed.', 'review', 'review', 'privacy_officer', 2, { isStart: true }),
      stage('design', 'Design gate', 'بوابة التصميم', 'Review controls, masking, consent, retention, and cross-border transfer risk.', 'review', 'review', 'privacy_officer', 2),
      stage('development', 'Development gate', 'بوابة التطوير', 'Check implementation evidence before testing.', 'implementation', 'review', 'technical_steward', 2),
      stage('testing', 'Testing gate', 'بوابة الاختبار', 'Validate controls and residual risk.', 'validation', 'review', 'security_reviewer', 2),
      stage('deployment', 'Deployment decision', 'قرار الإطلاق', 'Approve, block, or request corrective actions before launch.', 'decision', 'approval', 'privacy_officer', 2, { isDecision: true, isFinal: true }),
    ],
    transitions: [
      link('requirements', 'design', 'Purpose accepted', 'تم قبول الغرض'),
      link('design', 'development', 'Controls accepted', 'تم قبول الضوابط'),
      link('development', 'testing', 'Ready to test', 'جاهز للاختبار'),
      link('testing', 'deployment', 'Ready for decision', 'جاهز للقرار'),
      link('deployment', 'testing', 'Needs remediation', 'يحتاج معالجة', 'rejected', false),
    ],
  },
  {
    code: 'WF-PDP-DSR',
    caseType: 'privacy_dsr',
    trigger: 'privacy_dsr',
    nameEn: 'Data subject request route',
    nameAr: 'مسار طلب صاحب البيانات',
    description: 'Routes DSR work through identity validation, data owner response, fulfillment, and closure.',
    defaultSlaDays: 20,
    stages: [
      stage('intake', 'Identity validation', 'التحقق من الهوية', 'Validate requester identity and request type.', 'intake', 'information', 'privacy_officer', 2, { isStart: true }),
      stage('owner-response', 'Owner response', 'رد مالك البيانات', 'Collect records or correction decision from responsible owner.', 'review', 'review', 'data_owner', 8),
      stage('fulfillment', 'Fulfillment package', 'حزمة التنفيذ', 'Prepare response, rejection reason, or correction evidence.', 'implementation', 'review', 'privacy_officer', 6),
      stage('closure', 'DSR closure', 'إغلاق الطلب', 'Close the request with evidence and decision summary.', 'closure', 'approval', 'privacy_officer', 2, { isDecision: true, isFinal: true }),
    ],
    transitions: [
      link('intake', 'owner-response', 'Validated', 'تم التحقق'),
      link('owner-response', 'fulfillment', 'Response ready', 'الرد جاهز'),
      link('fulfillment', 'closure', 'Fulfilled', 'تم التنفيذ', 'approved'),
      link('closure', 'owner-response', 'Needs correction', 'يحتاج تصحيح', 'rejected', false),
    ],
  },
  {
    code: 'WF-PDP-BREACH',
    caseType: 'privacy_breach',
    trigger: 'privacy_breach',
    nameEn: 'Privacy breach escalation route',
    nameAr: 'مسار تصعيد حادثة الخصوصية',
    description: 'Routes breach work through triage, containment, 72-hour notification, and closure.',
    defaultSlaDays: 3,
    stages: [
      stage('triage', 'Breach triage', 'فرز الحادثة', 'Confirm severity, impacted asset, subjects, and notification clock.', 'triage', 'information', 'privacy_officer', 0, { isStart: true }),
      stage('containment', 'Containment', 'الاحتواء', 'Contain exposure and coordinate security response.', 'implementation', 'review', 'security_reviewer', 1),
      stage('notification', 'Notification decision', 'قرار الإشعار', 'Decide regulator and subject notification before the 72-hour deadline.', 'decision', 'approval', 'privacy_officer', 1, { isDecision: true }),
      stage('closure', 'Breach closure', 'إغلاق الحادثة', 'Record evidence, lessons learned, and closure notes.', 'closure', 'review', undefined, 1, { isFinal: true }),
    ],
    transitions: [
      link('triage', 'containment', 'Contain exposure', 'احتواء التعرض'),
      link('containment', 'notification', 'Ready for notification decision', 'جاهز لقرار الإشعار'),
      link('notification', 'closure', 'Notification recorded', 'تم تسجيل الإشعار', 'approved'),
      link('notification', 'containment', 'Containment incomplete', 'الاحتواء غير مكتمل', 'rejected', false),
    ],
  },
  {
    code: 'WF-DSI-SHARING',
    caseType: 'data_sharing_request',
    trigger: 'data_sharing_request',
    nameEn: 'Data sharing agreement route',
    nameAr: 'مسار اتفاقية مشاركة البيانات',
    description: 'Routes sharing requests through owner, privacy, security, technical review, agreement activation, and renewal planning.',
    defaultSlaDays: 8,
    stages: [
      stage('intake', 'Sharing intake', 'استلام طلب المشاركة', 'Capture purpose, recipient, asset, legal basis, and required controls.', 'intake', 'information', undefined, 1, { isStart: true }),
      stage('owner-review', 'Owner review', 'مراجعة المالك', 'Confirm purpose, necessity, and accountability.', 'review', 'review', 'data_owner', 2),
      stage('privacy-security-review', 'Privacy and security review', 'مراجعة الخصوصية والأمن', 'Validate consent/legal basis, classification, masking, and access controls.', 'review', 'review', 'security_reviewer', 3),
      stage('technical-review', 'Technical review', 'مراجعة تقنية', 'Confirm integration method, logging, and monitoring approach.', 'review', 'review', 'technical_steward', 2),
      stage('agreement', 'Agreement activation', 'تفعيل الاتفاقية', 'Store agreement, renewal date, and usage monitoring baseline.', 'implementation', 'approval', 'dmo_admin', 1, { isDecision: true, isFinal: true }),
    ],
    transitions: [
      link('intake', 'owner-review', 'Owner review', 'مراجعة المالك'),
      link('owner-review', 'privacy-security-review', 'Controls review', 'مراجعة الضوابط'),
      link('privacy-security-review', 'technical-review', 'Technical review', 'مراجعة تقنية'),
      link('technical-review', 'agreement', 'Activate agreement', 'تفعيل الاتفاقية', 'approved'),
      link('agreement', 'privacy-security-review', 'Needs revision', 'يحتاج تعديل', 'rejected', false),
    ],
  },
];

export const WORKFLOW_CASE_TYPES = Array.from(
  new Set([
    ...DEFAULT_WORKFLOW_TEMPLATES.map((template) => template.caseType),
    'open_data_publication_approval',
    'metadata_certification',
    'architecture_review',
    'business_glossary_term',
    'asset_lifecycle_decision',
    'business_impact_assessment',
    'compliance_calendar',
  ]),
) as readonly string[];

export const WORKFLOW_TASK_TYPES = ['approval', 'review', 'information'] as const;

function stage(
  code: string,
  nameEn: string,
  nameAr: string,
  description: string,
  kind: string,
  taskType: string,
  assigneeRoleCode: string | undefined,
  dueDays: number,
  flags: Pick<WorkflowStageSeed, 'isStart' | 'isDecision' | 'isFinal'> = {},
): WorkflowStageSeed {
  return { code, nameEn, nameAr, description, kind, taskType, assigneeRoleCode, dueDays, ...flags };
}

function link(
  from: string,
  to: string,
  labelEn: string,
  labelAr: string,
  decision?: string,
  isHappyPath = true,
): WorkflowTransitionSeed {
  return { from, to, labelEn, labelAr, decision, isHappyPath };
}

export function selectWorkflowTemplate(
  input: WorkflowRouteInput,
  candidates: WorkflowRouteCandidate[],
): WorkflowRouteCandidate | null {
  const active = candidates.filter((candidate) => candidate.isActive);
  if (input.templateId) {
    return active.find((candidate) => candidate.id === input.templateId) ?? null;
  }
  const caseType = input.caseType || 'general';
  const sameType = active.filter((candidate) => candidate.caseType === caseType);
  if (input.domainId) {
    const domainSpecific = sameType.find((candidate) => candidate.domainId === input.domainId);
    if (domainSpecific) return domainSpecific;
  }
  return sameType.find((candidate) => !candidate.domainId) ??
    active.find((candidate) => candidate.caseType === 'general' && !candidate.domainId) ??
    null;
}

export function workflowHealth(openCases: number, overdueTasks: number): 'healthy' | 'review' | 'critical' {
  if (overdueTasks > 0) return 'critical';
  if (openCases > 0) return 'review';
  return 'healthy';
}

export type WorkflowRouteGateResult = {
  allowed: boolean;
  reason?: string;
};

export function routeGateForOpenStagePeers(openPeerTasks: number): WorkflowRouteGateResult {
  if (openPeerTasks > 0) {
    return {
      allowed: false,
      reason: 'Complete all active tasks in this workflow stage before advancing the route',
    };
  }
  return { allowed: true };
}

export function isActionableWorkflowStage(stage: WorkflowStageRouteNode): boolean {
  if (!stage.isActive) return false;
  if (stage.isFinal) return Boolean(stage.assigneeRoleCode);
  if (stage.isStart && !stage.assigneeRoleCode) return false;
  return true;
}

export function firstActionableWorkflowStage<TStage extends WorkflowStageRouteNode>(
  stages: TStage[],
): TStage | null {
  return [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .find((stage) => isActionableWorkflowStage(stage)) ?? null;
}

export function selectWorkflowTransitionForDecision<TEdge extends WorkflowTransitionRouteEdge>(
  transitions: TEdge[],
  fromStageId: string,
  decision?: string | null,
): TEdge | null {
  const outgoing = transitions
    .filter((transition) => transition.fromStageId === fromStageId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (outgoing.length === 0) return null;
  if (decision === 'rejected') {
    return outgoing.find((transition) => transition.decision === 'rejected') ??
      outgoing.find((transition) => !transition.isHappyPath) ??
      null;
  }
  if (decision === 'approved') {
    return outgoing.find((transition) => transition.decision === 'approved') ??
      outgoing.find((transition) => transition.decision == null && transition.isHappyPath) ??
      outgoing.find((transition) => transition.isHappyPath) ??
      null;
  }
  return outgoing.find((transition) => transition.decision == null) ??
    outgoing.find((transition) => transition.isHappyPath) ??
    outgoing[0] ??
    null;
}
