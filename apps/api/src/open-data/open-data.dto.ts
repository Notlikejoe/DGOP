import {
  OpenDataApprovalDecision,
  OpenDataCandidateStatus,
  OpenDataPersonalDataAssessment,
  OpenDataPublicationFormat,
  OpenDataPublicationFrequency,
  OpenDataReviewDecision,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class CreateOpenDataCandidateDto {
  @IsString() @IsNotEmpty() assetId!: string;
  @IsOptional() @IsString() @IsNotEmpty() titleEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() titleAr?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(OpenDataPublicationFrequency) publicationFrequency?: OpenDataPublicationFrequency;
  @IsOptional() @IsEnum(OpenDataPublicationFormat) publicationFormat?: OpenDataPublicationFormat;
  @IsOptional() @IsUrl({ require_tld: false }) portalUrl?: string | null;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsString() stewardPersonId?: string | null;
  @IsOptional() @IsString() odiaoReviewerPersonId?: string | null;
  @IsOptional() @IsEnum(OpenDataPersonalDataAssessment) personalDataAssessment?: OpenDataPersonalDataAssessment;
  @IsOptional() @IsInt() @Min(0) @Max(100) publicationValueScore?: number;
  @IsOptional() @IsString() decisionNote?: string | null;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
}

export class CreateOpenDataCandidateFromAssetDto {
  @IsOptional() @IsString() @IsNotEmpty() titleEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() titleAr?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(OpenDataPublicationFrequency) publicationFrequency?: OpenDataPublicationFrequency;
  @IsOptional() @IsEnum(OpenDataPublicationFormat) publicationFormat?: OpenDataPublicationFormat;
  @IsOptional() @IsUrl({ require_tld: false }) portalUrl?: string | null;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsString() stewardPersonId?: string | null;
  @IsOptional() @IsString() odiaoReviewerPersonId?: string | null;
  @IsOptional() @IsEnum(OpenDataPersonalDataAssessment) personalDataAssessment?: OpenDataPersonalDataAssessment;
  @IsOptional() @IsInt() @Min(0) @Max(100) publicationValueScore?: number;
  @IsOptional() @IsString() decisionNote?: string | null;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
}

export class UpdateOpenDataCandidateDto {
  @IsOptional() @IsString() @IsNotEmpty() titleEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() titleAr?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(OpenDataPublicationFrequency) publicationFrequency?: OpenDataPublicationFrequency;
  @IsOptional() @IsEnum(OpenDataPublicationFormat) publicationFormat?: OpenDataPublicationFormat;
  @IsOptional() @IsUrl({ require_tld: false }) portalUrl?: string | null;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsString() stewardPersonId?: string | null;
  @IsOptional() @IsString() odiaoReviewerPersonId?: string | null;
  @IsOptional() @IsEnum(OpenDataPersonalDataAssessment) personalDataAssessment?: OpenDataPersonalDataAssessment;
  @IsOptional() @IsInt() @Min(0) @Max(100) publicationValueScore?: number;
  @IsOptional() @IsString() decisionNote?: string | null;
  @IsOptional() @IsDateString() publishedAt?: string | null;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
}

export class UpdateOpenDataStatusDto {
  @IsEnum(OpenDataCandidateStatus) status!: OpenDataCandidateStatus;
  @IsOptional() @IsString() decisionNote?: string | null;
  @IsOptional() @IsDateString() publishedAt?: string | null;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
}

export class SaveOpenDataAssessmentDto {
  @IsOptional() @IsBoolean() complete?: boolean;
  @IsBoolean() publicClassification!: boolean;
  @IsBoolean() restrictedInformation!: boolean;
  @IsBoolean() aggregationApplied!: boolean;
  @IsBoolean() anonymizationApplied!: boolean;
  @IsBoolean() dqAcceptable!: boolean;
  @IsBoolean() metadataComplete!: boolean;
  @IsBoolean() privacyReviewComplete!: boolean;
  @IsBoolean() legalReviewComplete!: boolean;
  @IsOptional() @IsString() note?: string | null;
}

export class UpdateOpenDataApprovalDto {
  @IsEnum(OpenDataApprovalDecision) decision!: OpenDataApprovalDecision;
  @IsOptional() @IsString() note?: string | null;
}

export class PublishOpenDataCandidateDto {
  @IsOptional() @IsUrl({ require_tld: false }) portalUrl?: string | null;
  @IsOptional() @IsString() portalRecordId?: string | null;
  @IsOptional() @IsString() note?: string | null;
  @IsOptional() @IsDateString() publishedAt?: string | null;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
}

export class CreateOpenDataReviewDto {
  @IsEnum(OpenDataReviewDecision) decision!: OpenDataReviewDecision;
  @IsOptional() @IsString() note?: string | null;
  @IsOptional() @IsDateString() reviewDate?: string | null;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
}

export class CreateOpenDataUsageMetricDto {
  @IsOptional() @IsDateString() metricDate?: string | null;
  @IsOptional() @IsInt() @Min(0) downloads?: number;
  @IsOptional() @IsInt() @Min(0) apiCalls?: number;
  @IsOptional() @IsInt() @Min(0) uniqueUsers?: number;
  @IsOptional() @IsString() source?: string;
}
