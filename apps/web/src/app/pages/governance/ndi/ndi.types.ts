import { StatusKind } from '../../../shared/status-chip';

export interface NdiDomainRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface NdiDomainCount extends NdiDomainRef {
  sortOrder: number;
  specCount: number;
}

export interface PersonRef {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  email?: string | null;
}

export interface NdiSpec {
  id: string;
  code: string;
  domainId: string;
  criterion?: string | null;
  type: string;
  maturityLevel: string;
  nameEn: string;
  nameAr: string;
  descriptionEn?: string | null;
  descriptionAr?: string | null;
  acceptanceCriteria?: string | null;
  reference?: string | null;
  ownerPersonId?: string | null;
  isActive: boolean;
  sortOrder: number;
  domain: NdiDomainRef;
  owner?: PersonRef | null;
}

export type EvidenceStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'revoked';

export interface NdiEvidence {
  id: string;
  specId: string;
  title: string;
  descriptionEn?: string | null;
  status: EvidenceStatus;
  effectiveStatus: EvidenceStatus;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  submittedBy: string;
  submittedAt?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewComment?: string | null;
  expiryDate?: string | null;
  createdAt: string;
}

export const EVIDENCE_STATUS_KIND: Record<EvidenceStatus, StatusKind> = {
  draft: 'muted',
  submitted: 'info',
  under_review: 'info',
  approved: 'success',
  rejected: 'danger',
  expired: 'warning',
  revoked: 'danger',
};

export const SPEC_TYPES = ['policy', 'standard', 'control', 'procedure', 'guideline'] as const;
export const MATURITY_LEVELS = ['level_1', 'level_2', 'level_3', 'level_4', 'level_5'] as const;

export const SPEC_TYPE_KIND: Record<string, StatusKind> = {
  policy: 'info',
  standard: 'info',
  control: 'warning',
  procedure: 'muted',
  guideline: 'muted',
};
