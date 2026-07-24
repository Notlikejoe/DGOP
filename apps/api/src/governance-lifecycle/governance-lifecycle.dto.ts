import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  GovernanceCouncilMemberRole,
  GovernanceEscalationLevel,
  GovernanceLifecycleStatus,
  GovernanceMaturityDimension,
  GovernancePolicyLevel,
} from '@prisma/client';

export class CreateGovernanceCharterDto {
  @IsString() @IsNotEmpty() @MaxLength(80) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(220) nameEn!: string;
  @IsOptional() @IsString() @MaxLength(220) nameAr?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(2000) purpose!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) scope!: string;
  @IsObject() eightElementsJson!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(80) sponsorRoleCode?: string | null;
  @IsOptional() @IsString() @MaxLength(80) ownerRoleCode?: string | null;
  @IsOptional() @IsEnum(GovernanceLifecycleStatus) status?: GovernanceLifecycleStatus;
  @IsOptional() @IsDateString() reviewDueAt?: string | null;
}

export class CreateGovernancePolicyDto {
  @IsString() @IsNotEmpty() @MaxLength(80) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(220) titleEn!: string;
  @IsOptional() @IsString() @MaxLength(220) titleAr?: string | null;
  @IsEnum(GovernancePolicyLevel) level!: GovernancePolicyLevel;
  @IsOptional() @IsString() @MaxLength(80) parentCode?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() @MaxLength(80) ownerRoleCode?: string | null;
  @IsOptional() @IsString() @MaxLength(40) version?: string;
  @IsOptional() @IsEnum(GovernanceLifecycleStatus) status?: GovernanceLifecycleStatus;
  @IsOptional() @IsDateString() effectiveAt?: string | null;
  @IsOptional() @IsDateString() reviewDueAt?: string | null;
  @IsOptional() @IsString() body?: string | null;
  @IsOptional() @IsObject() controlsJson?: Record<string, unknown> | null;
  @IsOptional() @IsString() approvalCaseId?: string | null;
}

export class CreateDomainCouncilMemberDto {
  @IsOptional() @IsString() @MaxLength(180) personEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(80) roleCode?: string | null;
  @IsEnum(GovernanceCouncilMemberRole) memberRole!: GovernanceCouncilMemberRole;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) votingWeight?: number;
}

export class CreateDomainCouncilDto {
  @IsString() @IsNotEmpty() @MaxLength(80) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(220) nameEn!: string;
  @IsOptional() @IsString() @MaxLength(220) nameAr?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() @MaxLength(80) leadStewardRoleCode?: string | null;
  @IsOptional() @IsString() @MaxLength(80) cadence?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) quorum?: number;
  @IsOptional() @IsEnum(GovernanceLifecycleStatus) status?: GovernanceLifecycleStatus;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateDomainCouncilMemberDto)
  members?: CreateDomainCouncilMemberDto[];
}

export class CreateDecisionRightDto {
  @IsString() @IsNotEmpty() @MaxLength(80) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) decisionArea!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) decisionType!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) ownerRoleCode!: string;
  @IsOptional() @IsObject() consultedRoleCodesJson?: Record<string, unknown> | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) timeframeBusinessDays?: number;
  @IsOptional() @IsEnum(GovernanceEscalationLevel) escalationLevel?: GovernanceEscalationLevel;
  @IsOptional() @IsObject() evidenceRequiredJson?: Record<string, unknown> | null;
  @IsOptional() @IsEnum(GovernanceLifecycleStatus) status?: GovernanceLifecycleStatus;
}

export class CreateMaturityDimensionDto {
  @IsEnum(GovernanceMaturityDimension) dimension!: GovernanceMaturityDimension;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) score!: number;
  @IsOptional() @IsObject() evidenceJson?: Record<string, unknown> | null;
  @IsOptional() @IsObject() gapsJson?: Record<string, unknown> | null;
  @IsOptional() @IsObject() actionsJson?: Record<string, unknown> | null;
}

export class CreateMaturityAssessmentDto {
  @IsString() @IsNotEmpty() @MaxLength(80) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(220) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) scopeType!: string;
  @IsOptional() @IsString() scopeId?: string | null;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsEnum(GovernanceLifecycleStatus) status?: GovernanceLifecycleStatus;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateMaturityDimensionDto)
  dimensions!: CreateMaturityDimensionDto[];
}

export class CreateImprovementItemDto {
  @IsString() @IsNotEmpty() @MaxLength(80) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(220) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) sourceType!: string;
  @IsOptional() @IsString() sourceId?: string | null;
  @IsOptional() @IsString() maturityAssessmentId?: string | null;
  @IsOptional() @IsString() @MaxLength(80) ownerRoleCode?: string | null;
  @IsOptional() @IsString() @MaxLength(40) priority?: string;
  @IsOptional() @IsEnum(GovernanceLifecycleStatus) status?: GovernanceLifecycleStatus;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsObject() evidenceJson?: Record<string, unknown> | null;
}
