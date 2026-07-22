import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AssignmentTargetType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  OWNERSHIP_DESCRIPTION_MAX,
  OWNERSHIP_JUSTIFICATION_MAX,
  OWNERSHIP_NAME_MAX,
  OWNERSHIP_PRIORITY_MAX,
  normalizeOwnershipText,
} from './assignments.logic';

// Rules cannot target an individual asset (asset-level is a direct assignment).
const RULE_SCOPES: AssignmentTargetType[] = [
  AssignmentTargetType.domain,
  AssignmentTargetType.capability,
  AssignmentTargetType.subject,
  AssignmentTargetType.org_unit,
  AssignmentTargetType.system,
];

export class CreateAssignmentDto {
  @IsEnum(AssignmentTargetType) targetType!: AssignmentTargetType;
  @IsUUID('4') targetId!: string;
  @IsUUID('4') roleTypeId!: string;
  @IsUUID('4') personId!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsDateString() effectiveDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string | null;
  @Transform(({ value }) => normalizeOwnershipText(value))
  @IsOptional() @IsString() @MaxLength(OWNERSHIP_JUSTIFICATION_MAX)
  justification?: string | null;
  /** When creating a primary that collides with an existing one, demote the existing to backup. */
  @IsOptional() @IsBoolean() demoteExisting?: boolean;
}

export class UpdateAssignmentDto {
  @IsOptional() @IsUUID('4') personId?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsDateString() effectiveDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string | null;
  @Transform(({ value }) => normalizeOwnershipText(value))
  @IsOptional() @IsString() @MaxLength(OWNERSHIP_JUSTIFICATION_MAX)
  justification?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateRuleDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @IsNotEmpty() @MaxLength(OWNERSHIP_NAME_MAX)
  nameEn!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @IsNotEmpty() @MaxLength(OWNERSHIP_NAME_MAX)
  nameAr!: string;
  @Transform(({ value }) => normalizeOwnershipText(value))
  @IsOptional() @IsString() @MaxLength(OWNERSHIP_DESCRIPTION_MAX)
  description?: string | null;
  @IsEnum(AssignmentTargetType)
  @IsNotEmpty()
  scopeType!: AssignmentTargetType;
  @IsUUID('4') refId!: string;
  @IsUUID('4') roleTypeId!: string;
  @IsUUID('4') personId!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(OWNERSHIP_PRIORITY_MAX) priority?: number;
}

export class UpdateRuleDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(OWNERSHIP_NAME_MAX)
  nameEn?: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(OWNERSHIP_NAME_MAX)
  nameAr?: string;
  @Transform(({ value }) => normalizeOwnershipText(value))
  @IsOptional() @IsString() @MaxLength(OWNERSHIP_DESCRIPTION_MAX)
  description?: string | null;
  @IsOptional() @IsEnum(AssignmentTargetType) scopeType?: AssignmentTargetType;
  @IsOptional() @IsUUID('4') refId?: string;
  @IsOptional() @IsUUID('4') roleTypeId?: string;
  @IsOptional() @IsUUID('4') personId?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(OWNERSHIP_PRIORITY_MAX) priority?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ApplyRecommendationDto {
  @IsUUID('4') assetId!: string;
  @IsUUID('4') roleTypeId!: string;
  @Transform(({ value }) => normalizeOwnershipText(value))
  @IsOptional() @IsString() @MaxLength(OWNERSHIP_JUSTIFICATION_MAX)
  justification?: string | null;
}

export class RecommendationFeedbackDto {
  @IsIn(['accepted', 'rejected', 'override'])
  decision!: 'accepted' | 'rejected' | 'override';
  @Transform(({ value }) => normalizeOwnershipText(value))
  @IsOptional() @IsString() @MaxLength(OWNERSHIP_JUSTIFICATION_MAX)
  comment?: string | null;
  @IsOptional() @IsUUID('4') selectedPersonId?: string | null;
}

export { RULE_SCOPES };
