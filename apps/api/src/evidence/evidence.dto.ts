import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const EVIDENCE_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'expired',
  'revoked',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const REVIEW_DECISIONS = ['approve', 'reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** Metadata that accompanies a multipart file upload. */
export class CreateEvidenceDto {
  @IsString() @IsNotEmpty() specId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() descriptionEn?: string | null;
  /** ISO date string; optional expiry for the evidence. */
  @IsOptional() @IsDateString() expiryDate?: string | null;
  /** When 'true', the evidence is submitted for review immediately after upload. */
  @IsOptional() @IsString() submit?: string;
}

export class ReviewEvidenceDto {
  @IsIn(REVIEW_DECISIONS) decision!: ReviewDecision;
  @IsOptional() @IsString() comment?: string | null;
}
