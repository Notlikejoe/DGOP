import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  BusinessGlossaryStatus,
  BusinessImpactLevel,
  BusinessLineageStatus,
  DataValueStatus,
  LifecycleDecisionStatus,
  RetentionDecision,
} from '@prisma/client';

export class CreateGlossaryTermDto {
  @IsString() termEn!: string;
  @IsOptional() @IsString() termAr?: string;
  @IsString() definition!: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() domainId?: string;
  @IsOptional() @IsString() reviewDueAt?: string;
}

export class DecideGlossaryTermDto {
  @IsIn(Object.values(BusinessGlossaryStatus))
  status!: BusinessGlossaryStatus;
  @IsOptional() @IsString() definition?: string;
}

export class CreateBusinessLineageDto {
  @IsString() processName!: string;
  @IsOptional() @IsString() businessProcess?: string;
  @IsOptional() @IsString() technicalBridge?: string;
  @IsOptional() @IsString() sourceAssetId?: string;
  @IsOptional() @IsString() targetAssetId?: string;
  @IsOptional() @IsString() domainId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) impactScore?: number;
  @IsOptional() @IsIn(Object.values(BusinessImpactLevel)) impactLevel?: BusinessImpactLevel;
}

export class UpdateBusinessLineageDto {
  @IsOptional() @IsIn(Object.values(BusinessLineageStatus)) status?: BusinessLineageStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) impactScore?: number;
  @IsOptional() @IsIn(Object.values(BusinessImpactLevel)) impactLevel?: BusinessImpactLevel;
}

export class CreateDataAssetValuationDto {
  @IsString() assetId!: string;
  @IsString() useCase!: string;
  @IsOptional() @IsString() valueDriver?: string;
  @IsOptional() @Type(() => Number) @IsNumber() annualValue?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) roiPercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) adoptionScore?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) surveyScore?: number;
  @IsOptional() @IsString() ownerName?: string;
}

export class CreateDataUserSurveyDto {
  @IsOptional() @IsString() valuationId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() respondent?: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) score!: number;
  @IsOptional() @IsString() feedback?: string;
}

export class CreateLifecycleDecisionDto {
  @IsString() assetId!: string;
  @IsString() proposedStatus!: string;
  @IsOptional() @IsIn(Object.values(RetentionDecision)) retentionDecision?: RetentionDecision;
  @IsOptional() @IsString() retentionBasis?: string;
  @IsOptional() @IsString() disposalDueAt?: string;
}

export class DecideLifecycleDecisionDto {
  @IsIn(Object.values(LifecycleDecisionStatus))
  status!: LifecycleDecisionStatus;
}

export class CreateBusinessImpactAssessmentDto {
  @IsString() processName!: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() domainId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) impactScore?: number;
  @IsOptional() @IsIn(Object.values(BusinessImpactLevel)) impactLevel?: BusinessImpactLevel;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) rtoHours?: number;
  @IsOptional() @Type(() => Number) @IsNumber() revenueImpact?: number;
  @IsOptional() @IsString() citizenImpact?: string;
  @IsOptional() @IsString() operationalImpact?: string;
}

export class CreateDataValueKpiDto {
  @IsString() name!: string;
  @IsString() valueType!: string;
  @IsString() period!: string;
  @IsOptional() @Type(() => Number) @IsNumber() targetValue?: number;
  @IsOptional() @Type(() => Number) @IsNumber() actualValue?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() useCase?: string;
  @IsOptional() @IsString() ownerName?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() domainId?: string;
  @IsOptional() @IsIn(Object.values(DataValueStatus)) status?: DataValueStatus;
}
