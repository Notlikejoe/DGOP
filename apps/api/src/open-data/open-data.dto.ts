import {
  OpenDataCandidateStatus,
  OpenDataPersonalDataAssessment,
  OpenDataPublicationFormat,
  OpenDataPublicationFrequency,
} from '@prisma/client';
import {
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
