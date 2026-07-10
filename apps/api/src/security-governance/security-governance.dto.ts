import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const MASKING_TECHNIQUES = [
  'static_masking',
  'dynamic_masking',
  'tokenization',
  'anonymization',
  'pseudonymization',
  'redaction',
] as const;
export const ACCESS_REVIEW_DECISIONS = ['pending', 'certified', 'revoke', 'exception', 'escalated'] as const;
export const DLP_STATUSES = ['new', 'triaged', 'under_review', 'contained', 'closed', 'false_positive'] as const;
export const SECURITY_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export class CreateMaskingPolicyDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsIn(MASKING_TECHNIQUES) technique!: (typeof MASKING_TECHNIQUES)[number];
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
  @IsOptional() @IsBoolean() appliesToPersonalData?: boolean;
  @IsOptional() @IsObject() fieldsJson?: Record<string, unknown> | null;
  @IsOptional() @IsString() previewBefore?: string | null;
  @IsOptional() @IsString() previewAfter?: string | null;
}

export class CreateRoleDataAccessMapDto {
  @IsString() @IsNotEmpty() roleId!: string;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
  @IsOptional() @IsString() maskingPolicyId?: string | null;
  @IsOptional() @IsBoolean() personalDataAllowed?: boolean;
  @IsOptional() @IsBoolean() approvalRequired?: boolean;
  @IsOptional() @IsString() businessJustification?: string | null;
  @IsOptional() @IsInt() @Min(1) reviewCadenceDays?: number;
}

export class AccessReviewItemDraftDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() roleId!: string;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
}

export class CreateAccessReviewDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() ownerUserId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => AccessReviewItemDraftDto)
  items!: AccessReviewItemDraftDto[];
}

export class UpdateAccessReviewItemDto {
  @IsIn(ACCESS_REVIEW_DECISIONS) decision!: (typeof ACCESS_REVIEW_DECISIONS)[number];
  @IsOptional() @IsString() justification?: string | null;
}

export class CreateDlpIncidentDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(SECURITY_SEVERITIES) severity?: (typeof SECURITY_SEVERITIES)[number];
  @IsOptional() @IsIn(DLP_STATUSES) status?: (typeof DLP_STATUSES)[number];
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
  @IsOptional() @IsString() assignedPersonId?: string | null;
  @IsOptional() @IsString() detectionSource?: string;
}

export class CreateClassificationChangeRequestDto {
  @IsString() @IsNotEmpty() assetId!: string;
  @IsString() @IsNotEmpty() toClassificationId!: string;
  @IsString() @IsNotEmpty() reason!: string;
}

export class SimulateAccessDecisionDto {
  @IsString() @IsNotEmpty() roleId!: string;
  @IsString() @IsNotEmpty() assetId!: string;
  @IsOptional() @IsString() requestedAction?: string;
  @IsOptional() @IsBoolean() personalDataRequested?: boolean;
}

