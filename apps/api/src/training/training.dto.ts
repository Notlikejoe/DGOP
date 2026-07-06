import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const TRAINING_STATUSES = ['assigned', 'in_progress', 'completed', 'expired', 'waived'] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];
export const TRAINING_TIERS = ['tier_1', 'tier_2', 'tier_3', 'tier_4'] as const;
export type TrainingTierValue = (typeof TRAINING_TIERS)[number];
export const CERTIFICATION_LEVELS = ['cds', 'sds', 'mds'] as const;
export type CertificationLevelValue = (typeof CERTIFICATION_LEVELS)[number];
export const CERTIFICATION_STATUSES = ['in_progress', 'passed', 'failed', 'expired', 'revoked'] as const;
export type CertificationStatusValue = (typeof CERTIFICATION_STATUSES)[number];
export const MENTORSHIP_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const;
export type MentorshipStatusValue = (typeof MENTORSHIP_STATUSES)[number];

export class CreateTrainingCourseDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() titleEn!: string;
  @IsString() @IsNotEmpty() titleAr!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsIn(TRAINING_TIERS) tier?: TrainingTierValue;
  @IsOptional() @IsString() deliveryMethod?: string;
  @IsOptional() @IsString() prerequisiteCourseId?: string | null;
  @IsOptional() @IsInt() @Min(5) @Max(1440) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) validityMonths?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateTrainingCourseDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() titleEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() titleAr?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsIn(TRAINING_TIERS) tier?: TrainingTierValue;
  @IsOptional() @IsString() deliveryMethod?: string;
  @IsOptional() @IsString() prerequisiteCourseId?: string | null;
  @IsOptional() @IsInt() @Min(5) @Max(1440) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) validityMonths?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpsertTrainingRequirementDto {
  @IsString() @IsNotEmpty() courseId!: string;
  @IsString() @IsNotEmpty() roleId!: string;
  @IsOptional() @IsBoolean() mandatory?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(365) dueDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) validityMonths?: number | null;
}

export class CreateTrainingAssignmentDto {
  @IsString() @IsNotEmpty() courseId!: string;
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() personId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() source?: string;
}

export class CompleteTrainingAssignmentDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) score?: number | null;
  @IsOptional() @IsString() evidenceNote?: string | null;
}

export class UpdateTrainingAssignmentDto {
  @IsOptional() @IsIn(TRAINING_STATUSES) status?: TrainingStatus;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() evidenceNote?: string | null;
}

export class CreateCertificationTrackDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsIn(CERTIFICATION_LEVELS) level!: CertificationLevelValue;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(TRAINING_TIERS) requiredTier?: TrainingTierValue;
  @IsOptional() @IsInt() @Min(0) @Max(240) requiredCeHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) validityMonths?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) passScore?: number;
  @IsOptional() @IsString() privileges?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCertificationTrackDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsIn(CERTIFICATION_LEVELS) level?: CertificationLevelValue;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(TRAINING_TIERS) requiredTier?: TrainingTierValue;
  @IsOptional() @IsInt() @Min(0) @Max(240) requiredCeHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) validityMonths?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) passScore?: number;
  @IsOptional() @IsString() privileges?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateCertificationAttemptDto {
  @IsString() @IsNotEmpty() trackId!: string;
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() personId?: string | null;
  @IsOptional() @IsIn(CERTIFICATION_STATUSES) status?: CertificationStatusValue;
  @IsOptional() @IsInt() @Min(0) @Max(100) examScore?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) caseStudyScore?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) peerReviewScore?: number | null;
  @IsOptional() @IsDateString() issuedAt?: string | null;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsString() evidenceNote?: string | null;
  @IsOptional() @IsString() assessor?: string | null;
}

export class CreateContinuingEducationDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() personId?: string | null;
  @IsString() @IsNotEmpty() titleEn!: string;
  @IsOptional() @IsString() titleAr?: string | null;
  @IsOptional() @IsString() activityType?: string;
  @IsInt() @Min(1) @Max(240) hours!: number;
  @IsOptional() @IsDateString() activityDate?: string;
  @IsOptional() @IsString() evidenceNote?: string | null;
}

export class CreateCommunityArticleDto {
  @IsString() @IsNotEmpty() titleEn!: string;
  @IsString() @IsNotEmpty() titleAr!: string;
  @IsOptional() @IsString() summaryEn?: string | null;
  @IsOptional() @IsString() summaryAr?: string | null;
  @IsOptional() @IsString() content?: string | null;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() authorPersonId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(10000) contributionPoints?: number;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
}

export class UpsertExpertProfileDto {
  @IsString() @IsNotEmpty() personId!: string;
  @IsString() @IsNotEmpty() expertiseArea!: string;
  @IsOptional() @IsString() bio?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(10000) contributionPoints?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) mentorshipCapacity?: number;
  @IsOptional() @IsBoolean() isMentor?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateMentorshipPairDto {
  @IsString() @IsNotEmpty() mentorPersonId!: string;
  @IsString() @IsNotEmpty() menteePersonId!: string;
  @IsOptional() @IsIn(MENTORSHIP_STATUSES) status?: MentorshipStatusValue;
  @IsOptional() @IsString() focusArea?: string | null;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() targetEndDate?: string | null;
  @IsOptional() @IsString() progressNote?: string | null;
}
