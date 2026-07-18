export type V5DomainModelStatus = 'ready' | 'watch' | 'blocked';

export type V5DomainModelDefinition = {
  code: string;
  name: string;
  purpose: string;
  ndiDomainCodes: string[];
  lifecycle: string[];
  workflowTypes: string[];
  requiredEvidence: string[];
  route: string;
};

export type V5DomainModelInput = {
  specCount: number;
  approvedEvidenceCount: number;
  evidenceCount: number;
  expiredEvidenceCount: number;
  rejectedEvidenceCount: number;
  pendingEvidenceCount: number;
  operationalRecordCount: number;
  workflowCaseCount: number;
};

export const V5_DOMAIN_MODEL_DEFINITIONS: V5DomainModelDefinition[] = [
  {
    code: 'DG',
    name: 'Data Governance',
    purpose: 'Charters, policies, decision rights, councils, and operating evidence.',
    ndiDomainCodes: ['data_strategy'],
    lifecycle: ['charter', 'policy', 'decision', 'evidence', 'review'],
    workflowTypes: ['charter_approval', 'policy_lifecycle', 'governance_exception'],
    requiredEvidence: ['approved charter', 'policy approval', 'decision register'],
    route: '/governance/operations',
  },
  {
    code: 'MCM',
    name: 'Master Customer / Master Data',
    purpose: 'Match candidates, survivorship decisions, golden record evidence, and resolution workflow.',
    ndiDomainCodes: ['reference_master_data'],
    lifecycle: ['identify', 'compare', 'survivorship', 'approval', 'publish'],
    workflowTypes: ['mdm_match_resolution'],
    requiredEvidence: ['match score', 'survivorship decision', 'golden record proof'],
    route: '/governance/extended-domains',
  },
  {
    code: 'RMD',
    name: 'Reference Master Data',
    purpose: 'Reference code sets, version control, source trust, approval, and activation evidence.',
    ndiDomainCodes: ['reference_master_data'],
    lifecycle: ['draft', 'review', 'approve', 'activate', 'retire'],
    workflowTypes: ['reference_data_version'],
    requiredEvidence: ['version change summary', 'approval evidence', 'activation record'],
    route: '/governance/extended-domains',
  },
  {
    code: 'DAM',
    name: 'Data Architecture Management',
    purpose: 'Architecture reviews, lineage impact, risk decisions, and implementation conditions.',
    ndiDomainCodes: ['data_architecture'],
    lifecycle: ['intake', 'impact review', 'decision', 'conditions', 'closure'],
    workflowTypes: ['architecture_review'],
    requiredEvidence: ['architecture decision', 'lineage impact', 'risk conditions'],
    route: '/governance/extended-domains',
  },
  {
    code: 'DCM',
    name: 'Data Catalog and Metadata',
    purpose: 'Metadata certification, glossary alignment, lineage review, and catalog evidence.',
    ndiDomainCodes: ['data_catalog'],
    lifecycle: ['discover', 'certify', 'remediate', 'approve', 'expire'],
    workflowTypes: ['metadata_certification', 'glossary_term_approval'],
    requiredEvidence: ['metadata certification', 'glossary approval', 'lineage review'],
    route: '/governance/extended-domains',
  },
  {
    code: 'BIA',
    name: 'Business Impact Analysis',
    purpose: 'Impact scoring, RTO, citizen/revenue impact, and domain prioritization.',
    ndiDomainCodes: ['data_strategy'],
    lifecycle: ['assess', 'score', 'review', 'approve', 'refresh'],
    workflowTypes: ['business_impact_assessment'],
    requiredEvidence: ['impact assessment', 'review decision', 'refresh record'],
    route: '/governance/business-value',
  },
  {
    code: 'DVR',
    name: 'Data Value Realization',
    purpose: 'Asset valuation, value KPIs, adoption signals, and realized benefit evidence.',
    ndiDomainCodes: ['data_strategy'],
    lifecycle: ['plan', 'measure', 'track', 'realize', 'improve'],
    workflowTypes: ['data_value_review'],
    requiredEvidence: ['valuation record', 'value KPI', 'user feedback'],
    route: '/governance/business-value',
  },
];

export function evidenceQualityScore(input: Pick<
  V5DomainModelInput,
  'approvedEvidenceCount' | 'evidenceCount' | 'expiredEvidenceCount' | 'rejectedEvidenceCount' | 'pendingEvidenceCount'
>): number {
  if (input.evidenceCount <= 0) return 0;
  const approvedRatio = input.approvedEvidenceCount / input.evidenceCount;
  const negativeRatio = (input.expiredEvidenceCount + input.rejectedEvidenceCount) / input.evidenceCount;
  const pendingRatio = input.pendingEvidenceCount / input.evidenceCount;
  return Math.max(0, Math.min(100, Math.round(approvedRatio * 100 - negativeRatio * 25 - pendingRatio * 10)));
}

export function domainModelStatus(input: V5DomainModelInput): V5DomainModelStatus {
  const evidenceScore = evidenceQualityScore(input);
  if (input.specCount > 0 && input.operationalRecordCount > 0 && evidenceScore >= 70) return 'ready';
  if (input.specCount > 0 || input.operationalRecordCount > 0 || input.workflowCaseCount > 0 || input.evidenceCount > 0) {
    return 'watch';
  }
  return 'blocked';
}

export function domainModelGapCount(input: V5DomainModelInput): number {
  let gaps = 0;
  if (input.specCount <= 0) gaps++;
  if (input.operationalRecordCount <= 0) gaps++;
  if (input.evidenceCount <= 0 || input.approvedEvidenceCount <= 0) gaps++;
  if (input.expiredEvidenceCount > 0) gaps++;
  if (input.rejectedEvidenceCount > 0) gaps++;
  if (input.pendingEvidenceCount > 0) gaps++;
  return gaps;
}
