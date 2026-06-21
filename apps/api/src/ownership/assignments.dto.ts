import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { AssignmentTargetType } from '@prisma/client';

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
  @IsString() @IsNotEmpty() targetId!: string;
  @IsString() @IsNotEmpty() roleTypeId!: string;
  @IsString() @IsNotEmpty() personId!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsDateString() effectiveDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string | null;
  @IsOptional() @IsString() justification?: string | null;
  /** When creating a primary that collides with an existing one, demote the existing to backup. */
  @IsOptional() @IsBoolean() demoteExisting?: boolean;
}

export class UpdateAssignmentDto {
  @IsOptional() @IsString() @IsNotEmpty() personId?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsDateString() effectiveDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string | null;
  @IsOptional() @IsString() justification?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateRuleDto {
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsEnum(AssignmentTargetType)
  @IsNotEmpty()
  scopeType!: AssignmentTargetType;
  @IsString() @IsNotEmpty() refId!: string;
  @IsString() @IsNotEmpty() roleTypeId!: string;
  @IsString() @IsNotEmpty() personId!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsInt() @Min(1) priority?: number;
}

export class UpdateRuleDto {
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(AssignmentTargetType) scopeType?: AssignmentTargetType;
  @IsOptional() @IsString() @IsNotEmpty() refId?: string;
  @IsOptional() @IsString() @IsNotEmpty() roleTypeId?: string;
  @IsOptional() @IsString() @IsNotEmpty() personId?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsInt() @Min(1) priority?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ApplyRecommendationDto {
  @IsString() @IsNotEmpty() assetId!: string;
  @IsString() @IsNotEmpty() roleTypeId!: string;
  @IsOptional() @IsString() justification?: string | null;
}

export { RULE_SCOPES };
