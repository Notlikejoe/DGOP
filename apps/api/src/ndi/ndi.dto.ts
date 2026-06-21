import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const SPEC_TYPES = ['policy', 'standard', 'control', 'procedure', 'guideline'] as const;
export const MATURITY_LEVELS = ['level_1', 'level_2', 'level_3', 'level_4', 'level_5'] as const;

export type SpecType = (typeof SPEC_TYPES)[number];
export type MaturityLevel = (typeof MATURITY_LEVELS)[number];

export class CreateNdiSpecDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() domainId!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() criterion?: string | null;
  @IsOptional() @IsIn(SPEC_TYPES) type?: SpecType;
  @IsOptional() @IsIn(MATURITY_LEVELS) maturityLevel?: MaturityLevel;
  @IsOptional() @IsString() descriptionEn?: string | null;
  @IsOptional() @IsString() descriptionAr?: string | null;
  @IsOptional() @IsString() acceptanceCriteria?: string | null;
  @IsOptional() @IsString() reference?: string | null;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
}

export class UpdateNdiSpecDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() domainId?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() criterion?: string | null;
  @IsOptional() @IsIn(SPEC_TYPES) type?: SpecType;
  @IsOptional() @IsIn(MATURITY_LEVELS) maturityLevel?: MaturityLevel;
  @IsOptional() @IsString() descriptionEn?: string | null;
  @IsOptional() @IsString() descriptionAr?: string | null;
  @IsOptional() @IsString() acceptanceCriteria?: string | null;
  @IsOptional() @IsString() reference?: string | null;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
}

export class ImportNdiSpecsDto {
  @IsString() @IsNotEmpty() csv!: string;
}
