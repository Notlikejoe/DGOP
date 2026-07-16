import {
  DataSharingAgreementStatus,
  DataSharingRequestStatus,
  DataSharingReviewDecision,
  DataSharingReviewStep,
  DataSharingUsageStatus,
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
  Min,
} from 'class-validator';

export class CreateDataSharingRequestDto {
  @IsString() @IsNotEmpty() requesterOrg!: string;
  @IsString() @IsNotEmpty() recipientOrg!: string;
  @IsString() @IsNotEmpty() purpose!: string;
  @IsOptional() @IsString() legalBasisId?: string | null;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
  @IsOptional() @IsString() maskingPolicyId?: string | null;
  @IsOptional() @IsString() roleDataAccessMapId?: string | null;
  @IsOptional() @IsBoolean() consentRequired?: boolean;
  @IsOptional() @IsBoolean() crossBorderTransfer?: boolean;
}

export class UpdateDataSharingRequestDto {
  @IsOptional() @IsEnum(DataSharingRequestStatus) status?: DataSharingRequestStatus;
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsInt() @Min(0) riskScore?: number;
}

export class SaveDataSharingReviewDto {
  @IsEnum(DataSharingReviewStep) step!: DataSharingReviewStep;
  @IsOptional() @IsEnum(DataSharingReviewDecision) decision?: DataSharingReviewDecision;
  @IsOptional() @IsString() reviewerPersonId?: string | null;
  @IsOptional() @IsString() note?: string | null;
}

export class CreateDataSharingAgreementDto {
  @IsOptional() @IsString() requestId?: string | null;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsString() @IsNotEmpty() recipientOrg!: string;
  @IsString() @IsNotEmpty() purpose!: string;
  @IsOptional() @IsEnum(DataSharingAgreementStatus) status?: DataSharingAgreementStatus;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsUrl({ require_tld: false }) agreementUrl?: string | null;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsOptional() @IsDateString() endAt?: string | null;
  @IsOptional() @IsDateString() renewalDueAt?: string | null;
}

export class UpdateDataSharingAgreementDto {
  @IsOptional() @IsEnum(DataSharingAgreementStatus) status?: DataSharingAgreementStatus;
  @IsOptional() @IsUrl({ require_tld: false }) agreementUrl?: string | null;
  @IsOptional() @IsDateString() renewalDueAt?: string | null;
  @IsOptional() @IsDateString() retiredAt?: string | null;
}

export class CreateDataSharingUsageMetricDto {
  @IsOptional() @IsDateString() metricDate?: string | null;
  @IsOptional() @IsInt() @Min(0) recordsShared?: number;
  @IsOptional() @IsInt() @Min(0) apiCalls?: number;
  @IsOptional() @IsInt() @Min(0) incidents?: number;
  @IsOptional() @IsEnum(DataSharingUsageStatus) status?: DataSharingUsageStatus;
  @IsOptional() @IsString() note?: string | null;
}
