import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DataScopeType } from '@prisma/client';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'code must be snake_case' })
  code!: string;

  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional()
  @ValidateIf((o) => o.maxClassificationRank !== null)
  @IsInt()
  @Min(1)
  maxClassificationRank?: number | null;
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional()
  @ValidateIf((o) => o.maxClassificationRank !== null)
  @IsInt()
  @Min(1)
  maxClassificationRank?: number | null;
}

export class SetRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-z_]+\.[a-z_]+$/, { each: true, message: 'each permission must be resource.action' })
  permissions!: string[];
}

export class ScopeEntryDto {
  @IsEnum(DataScopeType) scopeType!: DataScopeType;
  @IsString() @IsNotEmpty() refId!: string;
  @IsOptional() @IsBoolean() includeDescendants?: boolean;
}

export class SetRoleScopesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScopeEntryDto)
  scopes!: ScopeEntryDto[];

  @IsOptional()
  @ValidateIf((o) => o.maxClassificationRank !== null)
  @IsInt()
  @Min(1)
  maxClassificationRank?: number | null;
}
