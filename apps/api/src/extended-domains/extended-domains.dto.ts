import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  ArchitectureReviewDecision,
  MdmGoldenRecordStatus,
  MdmMatchStatus,
  MdmResolutionStep,
  MetadataCertificationStatus,
} from '@prisma/client';

export class CreateMdmMatchDto {
  @IsString() sourceAssetId!: string;
  @IsString() candidateAssetId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) matchScore?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) sourceTrustRank?: number;
  @IsOptional() @IsObject() survivorshipRulesJson?: Record<string, unknown>;
  @IsOptional() @IsObject() proposedGoldenRecordJson?: Record<string, unknown>;
  @IsOptional() @IsString() evidenceId?: string;
}

export class RunMdmMatchingDto {
  @IsOptional() @IsString() sourceAssetId?: string;
  @IsOptional() @IsString() domainId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) candidateAssetIds?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(100) threshold?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsBoolean() persist?: boolean;
}

export class ResolveMdmMatchDto {
  @IsOptional() @IsIn(Object.values(MdmMatchStatus)) status?: MdmMatchStatus;
  @IsOptional() @IsIn(Object.values(MdmResolutionStep)) resolutionStep?: MdmResolutionStep;
  @IsOptional() @IsString() resolutionNote?: string;
  @IsOptional() @IsObject() survivorshipRulesJson?: Record<string, unknown>;
  @IsOptional() @IsObject() proposedGoldenRecordJson?: Record<string, unknown>;
  @IsOptional() @IsString() evidenceId?: string;
}

export class UpsertMdmMatchRuleDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() domainId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(100) thresholdScore?: number;
  @IsObject() blockingJson!: Record<string, unknown>;
  @IsObject() weightsJson!: Record<string, unknown>;
  @IsOptional() @IsObject() survivorshipJson?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateMdmGoldenRecordDto {
  @IsOptional() @IsIn(Object.values(MdmGoldenRecordStatus)) status?: MdmGoldenRecordStatus;
  @IsOptional() @IsObject() masteredRecordJson?: Record<string, unknown>;
  @IsOptional() @IsObject() survivorshipRulesJson?: Record<string, unknown>;
  @IsOptional() @IsString() reason?: string;
}

export class CreateReferenceVersionDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() version!: string;
  @IsOptional() @IsString() domainId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() changeSummary?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) sourceTrustRank?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) valuesCount?: number;
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsString() effectiveTo?: string;
  @IsOptional() @IsString() evidenceId?: string;
}

export class ReferenceDecisionDto {
  @IsIn(['submit', 'approve', 'reject', 'activate', 'retire'])
  decision!: 'submit' | 'approve' | 'reject' | 'activate' | 'retire';
}

export class CreateMetadataCertificationDto {
  @IsString() assetId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) qualityScore?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) completenessScore?: number;
  @IsOptional() @IsBoolean() ownerConfirmed?: boolean;
  @IsOptional() @IsBoolean() glossaryAligned?: boolean;
  @IsOptional() @IsBoolean() lineageReviewed?: boolean;
  @IsOptional() @IsString() certificationNote?: string;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() evidenceId?: string;
}

export class SaveMetadataCertificationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) qualityScore?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) completenessScore?: number;
  @IsOptional() @IsBoolean() ownerConfirmed?: boolean;
  @IsOptional() @IsBoolean() glossaryAligned?: boolean;
  @IsOptional() @IsBoolean() lineageReviewed?: boolean;
  @IsOptional() @IsString() certificationNote?: string;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() evidenceId?: string;
  @IsOptional() @IsIn(Object.values(MetadataCertificationStatus)) status?: MetadataCertificationStatus;
}

export class CreateArchitectureReviewDto {
  @IsString() assetId!: string;
  @IsOptional() @IsString() reviewType?: string;
  @IsString() title!: string;
  @IsOptional() @IsString() architectureDecision?: string;
  @IsOptional() @IsString() lineageImpact?: string;
  @IsOptional() @IsString() riskLevel?: string;
  @IsOptional() @IsObject() conditionsJson?: Record<string, unknown>;
  @IsOptional() @IsString() evidenceId?: string;
}

export class DecideArchitectureReviewDto {
  @IsIn(Object.values(ArchitectureReviewDecision))
  decision!: ArchitectureReviewDecision;
  @IsOptional() @IsString() architectureDecision?: string;
  @IsOptional() @IsString() lineageImpact?: string;
  @IsOptional() @IsObject() conditionsJson?: Record<string, unknown>;
  @IsOptional() @IsString() evidenceId?: string;
}
