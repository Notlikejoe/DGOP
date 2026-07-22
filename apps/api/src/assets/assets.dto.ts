import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  ASSET_CODE_MAX,
  ASSET_CODE_PATTERN,
  ASSET_DESCRIPTION_MAX,
  ASSET_NAME_MAX,
  ASSET_OWNER_MAX,
  LIFECYCLE_STATUSES,
  OWNER_STATUSES,
  RELATIONSHIP_TYPES,
  normalizeAssetCode,
  normalizeOptionalText,
} from './assets.logic';

export { LIFECYCLE_STATUSES, OWNER_STATUSES, RELATIONSHIP_TYPES } from './assets.logic';

// ---------- Data Assets ----------
export class CreateAssetDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizeAssetCode(value) : value))
  @IsString() @IsNotEmpty() @MaxLength(ASSET_CODE_MAX) @Matches(ASSET_CODE_PATTERN)
  code!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @IsNotEmpty() @MaxLength(ASSET_NAME_MAX)
  nameEn!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @IsNotEmpty() @MaxLength(ASSET_NAME_MAX)
  nameAr!: string;
  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional() @IsString() @MaxLength(ASSET_DESCRIPTION_MAX)
  description?: string | null;
  @IsOptional() @IsIn(LIFECYCLE_STATUSES) lifecycleStatus?: string;
  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional() @IsString() @MaxLength(ASSET_OWNER_MAX)
  ownerName?: string | null;
  @IsOptional() @IsUUID('4') domainId?: string | null;
  @IsOptional() @IsUUID('4') orgUnitId?: string | null;
  @IsOptional() @IsUUID('4') systemId?: string | null;
  @IsOptional() @IsUUID('4') capabilityId?: string | null;
  @IsOptional() @IsUUID('4') classificationId?: string | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) subjectIds?: string[];
}

export class UpdateAssetDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(ASSET_NAME_MAX)
  nameEn?: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(ASSET_NAME_MAX)
  nameAr?: string;
  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional() @IsString() @MaxLength(ASSET_DESCRIPTION_MAX)
  description?: string | null;
  @IsOptional() @IsIn(LIFECYCLE_STATUSES) lifecycleStatus?: string;
  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional() @IsString() @MaxLength(ASSET_OWNER_MAX)
  ownerName?: string | null;
  @IsOptional() @IsUUID('4') domainId?: string | null;
  @IsOptional() @IsUUID('4') orgUnitId?: string | null;
  @IsOptional() @IsUUID('4') systemId?: string | null;
  @IsOptional() @IsUUID('4') capabilityId?: string | null;
  @IsOptional() @IsUUID('4') classificationId?: string | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) subjectIds?: string[];
}

// ---------- Asset Relationships ----------
export class CreateAssetRelationshipDto {
  @IsUUID('4') targetAssetId!: string;
  @IsIn(RELATIONSHIP_TYPES) type!: string;
  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional() @IsString() @MaxLength(ASSET_DESCRIPTION_MAX)
  description?: string | null;
}

// ---------- CSV Import ----------
export class ImportAssetsDto {
  @IsString() @IsNotEmpty() csv!: string;
}
