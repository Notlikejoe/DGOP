import {
  OpenDataCandidateStatus,
  OpenDataPersonalDataAssessment,
  OpenDataPublicationFrequency,
  OpenDataSignalStatus,
} from '@prisma/client';

export interface OpenDataSignalInput {
  classificationRank?: number | null;
  qualityScore?: number | null;
  personalDataAssessment: OpenDataPersonalDataAssessment;
  ownerPersonId?: string | null;
  stewardPersonId?: string | null;
  publicationValueScore?: number | null;
}

export interface OpenDataEligibility {
  classificationSignal: OpenDataSignalStatus;
  dataQualitySignal: OpenDataSignalStatus;
  personalDataSignal: OpenDataSignalStatus;
  ownershipSignal: OpenDataSignalStatus;
  publicationValueSignal: OpenDataSignalStatus;
  eligibilityScore: number;
  overallSignal: OpenDataSignalStatus;
  blockers: string[];
  reviewItems: string[];
}

export const OPEN_DATA_STATUSES: OpenDataCandidateStatus[] = [
  OpenDataCandidateStatus.draft,
  OpenDataCandidateStatus.assessment,
  OpenDataCandidateStatus.under_review,
  OpenDataCandidateStatus.approved,
  OpenDataCandidateStatus.published,
  OpenDataCandidateStatus.rejected,
  OpenDataCandidateStatus.retired,
];

const STATUS_TRANSITIONS: Record<OpenDataCandidateStatus, OpenDataCandidateStatus[]> = {
  [OpenDataCandidateStatus.draft]: [
    OpenDataCandidateStatus.assessment,
    OpenDataCandidateStatus.under_review,
    OpenDataCandidateStatus.rejected,
  ],
  [OpenDataCandidateStatus.assessment]: [
    OpenDataCandidateStatus.draft,
    OpenDataCandidateStatus.under_review,
    OpenDataCandidateStatus.rejected,
  ],
  [OpenDataCandidateStatus.under_review]: [
    OpenDataCandidateStatus.assessment,
    OpenDataCandidateStatus.approved,
    OpenDataCandidateStatus.rejected,
  ],
  [OpenDataCandidateStatus.approved]: [
    OpenDataCandidateStatus.under_review,
    OpenDataCandidateStatus.published,
    OpenDataCandidateStatus.retired,
  ],
  [OpenDataCandidateStatus.published]: [
    OpenDataCandidateStatus.under_review,
    OpenDataCandidateStatus.retired,
  ],
  [OpenDataCandidateStatus.rejected]: [
    OpenDataCandidateStatus.draft,
    OpenDataCandidateStatus.assessment,
  ],
  [OpenDataCandidateStatus.retired]: [],
};

function clampScore(score: number | null | undefined): number {
  if (score === null || score === undefined || Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function signalPoints(signal: OpenDataSignalStatus): number {
  if (signal === OpenDataSignalStatus.ready) return 100;
  if (signal === OpenDataSignalStatus.needs_review) return 60;
  return 0;
}

export function classificationSignal(rank?: number | null): OpenDataSignalStatus {
  if (rank === null || rank === undefined) return OpenDataSignalStatus.needs_review;
  if (rank <= 1) return OpenDataSignalStatus.ready;
  if (rank === 2) return OpenDataSignalStatus.needs_review;
  return OpenDataSignalStatus.blocked;
}

export function dataQualitySignal(score?: number | null): OpenDataSignalStatus {
  if (score === null || score === undefined) return OpenDataSignalStatus.needs_review;
  if (score >= 85) return OpenDataSignalStatus.ready;
  if (score >= 70) return OpenDataSignalStatus.needs_review;
  return OpenDataSignalStatus.blocked;
}

export function personalDataSignal(
  assessment: OpenDataPersonalDataAssessment,
): OpenDataSignalStatus {
  if (
    assessment === OpenDataPersonalDataAssessment.none ||
    assessment === OpenDataPersonalDataAssessment.aggregated
  ) {
    return OpenDataSignalStatus.ready;
  }
  if (assessment === OpenDataPersonalDataAssessment.unknown) {
    return OpenDataSignalStatus.needs_review;
  }
  return OpenDataSignalStatus.blocked;
}

export function ownershipSignal(
  ownerPersonId?: string | null,
  stewardPersonId?: string | null,
): OpenDataSignalStatus {
  if (ownerPersonId && stewardPersonId) return OpenDataSignalStatus.ready;
  if (ownerPersonId || stewardPersonId) return OpenDataSignalStatus.needs_review;
  return OpenDataSignalStatus.blocked;
}

export function publicationValueSignal(score?: number | null): OpenDataSignalStatus {
  const value = clampScore(score);
  if (value >= 70) return OpenDataSignalStatus.ready;
  if (value >= 40) return OpenDataSignalStatus.needs_review;
  return OpenDataSignalStatus.blocked;
}

export function scoreOpenDataEligibility(input: OpenDataSignalInput): OpenDataEligibility {
  const signals = {
    classificationSignal: classificationSignal(input.classificationRank),
    dataQualitySignal: dataQualitySignal(input.qualityScore),
    personalDataSignal: personalDataSignal(input.personalDataAssessment),
    ownershipSignal: ownershipSignal(input.ownerPersonId, input.stewardPersonId),
    publicationValueSignal: publicationValueSignal(input.publicationValueScore),
  };
  const blockers: string[] = [];
  const reviewItems: string[] = [];
  for (const [key, value] of Object.entries(signals)) {
    if (value === OpenDataSignalStatus.blocked) blockers.push(key);
    if (value === OpenDataSignalStatus.needs_review) reviewItems.push(key);
  }
  const eligibilityScore = Math.round(
    Object.values(signals).reduce((sum, signal) => sum + signalPoints(signal), 0) /
      Object.values(signals).length,
  );
  const overallSignal = blockers.length
    ? OpenDataSignalStatus.blocked
    : reviewItems.length
      ? OpenDataSignalStatus.needs_review
      : OpenDataSignalStatus.ready;
  return { ...signals, eligibilityScore, overallSignal, blockers, reviewItems };
}

export function canTransitionOpenDataStatus(
  from: OpenDataCandidateStatus,
  to: OpenDataCandidateStatus,
): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

export function nextOpenDataReviewDate(
  from: Date,
  frequency: OpenDataPublicationFrequency,
): Date | null {
  const next = new Date(from);
  if (frequency === OpenDataPublicationFrequency.one_time) return null;
  if (frequency === OpenDataPublicationFrequency.daily) next.setDate(next.getDate() + 1);
  else if (frequency === OpenDataPublicationFrequency.weekly) next.setDate(next.getDate() + 7);
  else if (frequency === OpenDataPublicationFrequency.monthly) next.setMonth(next.getMonth() + 1);
  else if (frequency === OpenDataPublicationFrequency.quarterly) next.setMonth(next.getMonth() + 3);
  else if (frequency === OpenDataPublicationFrequency.semiannual) next.setMonth(next.getMonth() + 6);
  else if (frequency === OpenDataPublicationFrequency.annual) next.setFullYear(next.getFullYear() + 1);
  else return null;
  return next;
}
